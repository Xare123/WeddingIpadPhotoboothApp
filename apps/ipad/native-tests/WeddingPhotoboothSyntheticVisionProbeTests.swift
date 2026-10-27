import XCTest
import Foundation
import Vision
import CoreImage
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers
import CryptoKit

/// Private, owner-armed, bundled-fictional-image probe. No application launch or external data access.
final class WeddingPhotoboothSyntheticVisionProbeTests: XCTestCase {
  private let fixtureSHA = "c6b6c5015df9b172731f021dde939300ebec6bf624818d63c4bda4a1854a3165"
  private let queue = DispatchQueue(label: "wedding.synthetic.physical.vision", qos: .userInitiated)
  private let stateLock = NSLock(), inFlight = DispatchGroup()
  private var armed = false, stopped = false, acknowledgement = true, drainAttempted = false
  private var activeRequest: VNRequest?
  private var deadline = 0.0
  private enum Stop: Error { case notArmed, unsupportedRuntime, runnerMismatch, fixtureMismatch, timedOut, stopped, nativeFailure }
  private final class Box<Value>: @unchecked Sendable {
    let lock = NSLock()
    private var value: Result<Value, Error>?
    func set(_ result: Result<Value, Error>) { lock.lock(); value = result; lock.unlock() }
    func get() -> Result<Value, Error>? { lock.lock(); defer { lock.unlock() }; return value }
  }
  private struct Sample {
    let name: String, detected: Int, anchors: [FaceAnchors], obstructions: [UnitRect], faces: [[String: Any]]
    let cpuOnly: Bool
  }
  override func setUpWithError() throws {
    continueAfterFailure = true
    #if !os(iOS) || targetEnvironment(simulator)
    throw Stop.unsupportedRuntime
    #else
    let environment = ProcessInfo.processInfo.environment
    guard environment["PHOTOBOOTH_SYNTHETIC_VISION_PROBE"] == "OWNER_READY" else {
      throw Stop.notArmed
    }
    guard let expected = environment["PHOTOBOOTH_SYNTHETIC_VISION_RUNNER_BUNDLE_ID"],
      expected.utf8.count <= 255, expected.hasSuffix(".physicaltests.xctrunner"),
      !expected.hasPrefix("com.example."), !expected.hasPrefix("org.fixture."), expected.range(of: "^[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)+$", options: .regularExpression) != nil,
      Bundle.main.bundleIdentifier == expected else { throw Stop.runnerMismatch }
    stateLock.lock(); armed = true; deadline = ProcessInfo.processInfo.systemUptime + 150; stateLock.unlock()
    #endif
  }
  override func tearDownWithError() throws {
    stopAndDrain()
    XCTAssertTrue(acknowledgement, "Native work did not acknowledge stop within5s; no subsequent samples may run.")
    stateLock.lock(); armed = false; stateLock.unlock()
  }
  private func checkpoint() throws {
    stateLock.lock(); let shouldStop = stopped || !armed; let limit = deadline; stateLock.unlock()
    guard !shouldStop else { throw Stop.stopped }
    guard ProcessInfo.processInfo.systemUptime < limit else { throw Stop.timedOut }
  }
  private func stop() {
    stateLock.lock(); stopped = true; let request = activeRequest; stateLock.unlock(); request?.cancel()
  }
  private func stopAndDrain() {
    stop()
    if !drainAttempted {
      drainAttempted = true
      acknowledgement = inFlight.wait(timeout: .now() + 5) == .success
    } else if !acknowledgement {
      acknowledgement = inFlight.wait(timeout: .now()) == .success
    }
  }
  /// One physical operation at a time. Cancellation cannot forcibly interrupt a running native call.
  private func step<Value>(seconds: Double, _ operation: @escaping () throws -> Value) throws -> Value {
    try checkpoint()
    stateLock.lock(); let limit = deadline; stateLock.unlock()
    let stepEnd = min(limit, ProcessInfo.processInfo.systemUptime + seconds)
    let box = Box<Value>(), finished = XCTestExpectation(description: "bounded synthetic native step")
    inFlight.enter()
    queue.async { [self] in
      defer { inFlight.leave() }
      let result: Result<Value, Error>
      do { try checkpoint(); let value = try autoreleasepool(invoking: operation); try checkpoint(); result = .success(value) }
      catch { result = .failure(error) }
      // Admission and fulfillment share the same lock as stop/disarm. A late operation cannot fulfill a timed-out step.
      stateLock.lock()
      if armed && !stopped && ProcessInfo.processInfo.systemUptime < stepEnd { box.set(result); finished.fulfill() }
      stateLock.unlock()
    }
    let budget = max(0, stepEnd - ProcessInfo.processInfo.systemUptime)
    // Pump XCTest's waiter/run loop instead of parking the runner's main thread for a Vision request.
    guard XCTWaiter().wait(for: [finished], timeout: budget) == .completed else {
      stopAndDrain(); throw Stop.timedOut
    }
    return try XCTUnwrap(box.get()).get()
  }
  private func sha(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
  private func jpeg(_ image: CGImage, quality: Double) throws -> Data {
    let data = NSMutableData()
    guard let destination = CGImageDestinationCreateWithData(data as CFMutableData, UTType.jpeg.identifier as CFString, 1, nil) else { throw Stop.nativeFailure }
    CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: quality, kCGImagePropertyOrientation: 1] as CFDictionary)
    guard CGImageDestinationFinalize(destination) else { throw Stop.nativeFailure }; return data as Data
  }
  /// Independent sRGB scan of the ACTUAL encoded B&W-crown diagnostic, bounded to the pinned frame size.
  private func goldPixels(_ bytes: Data) throws -> Int {
    guard let source = CGImageSourceCreateWithData(bytes as CFData, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil), image.width == 1122, image.height == 1402 else { throw Stop.nativeFailure }
    guard let colorSpace = CGColorSpace(name: CGColorSpace.sRGB) else { throw Stop.nativeFailure }
    var rgba = [UInt8](repeating: 0, count: 1122 * 1402 * 4)
    try rgba.withUnsafeMutableBytes {
      guard let base = $0.baseAddress,
        let context = CGContext(data: base, width: 1122, height: 1402, bitsPerComponent: 8, bytesPerRow: 1122 * 4,
        space: colorSpace, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { throw Stop.nativeFailure }
      context.draw(image, in: CGRect(x: 0, y: 0, width: 1122, height: 1402))
    }
    var count = 0
    for offset in stride(from: 0, to: rgba.count, by: 4) {
      if Int(rgba[offset]) > Int(rgba[offset + 2]) + 50 && rgba[offset] > 130 { count += 1 }
    }
    return count
  }
  private func sample(_ image: CGImage, name: String) throws -> Sample {
    try checkpoint()
    guard VNDetectFaceLandmarksRequest.supportedRevisions.contains(3) else { throw Stop.nativeFailure }
    let request = VNDetectFaceLandmarksRequest(); request.revision = 3; request.usesCPUOnly = true
    stateLock.lock()
    if stopped { stateLock.unlock(); throw Stop.stopped }
    activeRequest = request; stateLock.unlock()
    defer { stateLock.lock(); activeRequest = nil; stateLock.unlock() }
    let handler = VNImageRequestHandler(cgImage: image, orientation: .up, options: [:])
    try handler.perform([request]); try checkpoint()
    let observations = request.results ?? []
    guard observations.count <= 8 else { throw Stop.nativeFailure }
    var anchors = [FaceAnchors](), obstructions = [UnitRect](), rows = [[String: Any]]()
    for (index, observation) in observations.enumerated() {
      let b = observation.boundingBox
      let box = UnitRect(x: Double(b.minX), y: Double(b.minY), width: Double(b.width), height: Double(b.height))
      let top = UnitRect(x: box.x, y: 1 - box.y - box.height, width: box.width, height: box.height)
      let landmarks = observation.landmarks
      var row: [String: Any] = ["anonymousIndex": index, "boundsTopLeft": [top.x,top.y,top.width,top.height],
        "confidence": Double(observation.confidence), "landmarkConfidence": landmarks.map { Double($0.confidence) as Any } ?? NSNull()]
      if let left = landmarks?.leftEye, let right = landmarks?.rightEye,
        left.pointCount > 0, right.pointCount > 0, left.pointCount <= 128, right.pointCount <= 128 {
        // Own immutable value arrays while handler/request/regions are alive. No repeated per-point getter.
        let ls = left.normalizedPoints.map { UnitPoint(x: Double($0.x), y: Double($0.y)) }
        let rs = right.normalizedPoints.map { UnitPoint(x: Double($0.x), y: Double($0.y)) }
        if let face = FaceGeometry.fromVision(bounds: box, leftEye: ls, rightEye: rs, confidence: Double(observation.confidence)) {
          anchors.append(face)
          row["eyesTopLeft"] = [[face.leftEye.x,face.leftEye.y],[face.rightEye.x,face.rightEye.y]]
          let first = face.leftEye.x <= face.rightEye.x ? face.leftEye : face.rightEye
          let second = face.leftEye.x <= face.rightEye.x ? face.rightEye : face.leftEye
          let dx = (second.x - first.x) * Double(image.width), dy = (second.y - first.y) * Double(image.height)
          row["interocularPixels"] = hypot(dx,dy); row["rollDegrees"] = atan2(dy,dx) * 180 / .pi
        } else if top.valid { obstructions.append(top); row["eyesTopLeft"] = NSNull() }
      } else if top.valid { obstructions.append(top); row["eyesTopLeft"] = NSNull() }
      rows.append(row)
      withExtendedLifetime(landmarks) {}
    }
    withExtendedLifetime((handler,request,observations)) {}
    return Sample(name: name, detected: observations.count, anchors: anchors, obstructions: obstructions, faces: rows, cpuOnly: request.usesCPUOnly)
  }
  private func placements(_ sample: Sample, image: CGImage, accessory: FaceAccessory) -> [AccessoryPlacement] {
    FaceGeometry.placements(faces: sample.anchors, image: ImageSize(width: Double(image.width), height: Double(image.height)),
      accessory: accessory, obstructingBounds: sample.obstructions)
  }
  private func encodePlacement(_ value: AccessoryPlacement) -> [String: Any] {
    ["centerTopLeft": [value.center.x,value.center.y], "width": value.width, "height": value.height,
      "rollDegrees": value.rotation * 180 / .pi, "excludedBoundsTopLeft": value.excludedFaceBounds.map { [$0.x,$0.y,$0.width,$0.height] }]
  }
  private func checkEyes(_ values: [AccessoryPlacement]) {
    let sorted = values.sorted { $0.center.x < $1.center.x }
    guard sorted.count == 2 else { return } // Count assertion is retained separately after all attachments.
    let windows = [[CGRect(x: 216,y: 482,width: 34,height: 36), CGRect(x: 309,y: 497,width: 36,height: 36)],
      [CGRect(x: 786,y: 454,width: 38,height: 38), CGRect(x: 881,y: 439,width: 38,height: 38)]]
    for index in 0..<2 {
      let value = sorted[index], distance = value.width * 1122 / 2
      let cx = value.center.x * 1122, cy = value.center.y * 1402
      let ex = cos(value.rotation) * distance / 2, ey = sin(value.rotation) * distance / 2
      let eyes = [CGPoint(x: CGFloat(cx - ex), y: CGFloat(cy - ey)), CGPoint(x: CGFloat(cx + ex), y: CGFloat(cy + ey))]
      XCTAssertTrue(windows[index][0].contains(eyes[0]), "Actual inferred lens center must lie in independent source-eye window.")
      XCTAssertTrue(windows[index][1].contains(eyes[1]), "Both actual inferred lens centers must align.")
      XCTAssertTrue((75...115).contains(distance), "Source-eye spacing must match the independent reference.")
      let degrees = value.rotation * 180 / .pi
      let expectedRoll: ClosedRange<Double> = index == 0 ? 3...16 : -16 ... -3
      XCTAssertTrue(expectedRoll.contains(degrees), "Left/right source-eye tilt must retain the correct sign and magnitude.")
    }
  }
  func testOwnerArmedSyntheticVisionOnPhysicalIPad() throws {
    stateLock.lock(); let ready = armed && !stopped; stateLock.unlock()
    guard ready else { throw Stop.notArmed }
    var samples = [Sample](), renderRows = [[String: Any]](), failure: [String: Any]?, rootJPEGHash: String?
    defer {
      let rows = samples.map { ["name": $0.name, "detected": $0.detected, "landmarked": $0.anchors.count,
        "cpuOnly": $0.cpuOnly, "faces": $0.faces] as [String: Any] }
      let report: [String: Any] = ["scope": "PRIVATE_OWNER_ARMED_SYNTHETIC_FIXTURE_ONLY_NOT_WEDDING_DATA", "fixtureSHA": fixtureSHA,
        "size": [1122,1402], "rootJpegSHA": rootJPEGHash as Any? ?? NSNull(), "recipeVersion": FaceGeometry.recipeVersion,
        "requestRevision": 3, "requestOrientation": "up", "requestOrder": ["warm1","warm2","bw"],
        "samples": rows, "renders": renderRows, "stopError": failure as Any? ?? NSNull(),
        "nativeStopAcknowledged": acknowledgement, "acceptanceFailuresSeeXCTest": testRun?.failureCount ?? 0]
      if let bytes = try? JSONSerialization.data(withJSONObject: report, options: [.sortedKeys]), bytes.count <= 48 * 1024 {
        let attachment = XCTAttachment(data: bytes, uniformTypeIdentifier: UTType.json.identifier)
        attachment.name = "synthetic-physical-vision-probe"; attachment.lifetime = .keepAlways; add(attachment)
      } else { XCTFail("Synthetic diagnostic JSON was invalid or exceeded its48KiB bound.") }
    }
    do {
      let resource = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "separated-portrait", withExtension: "png"))
      let source = try Data(contentsOf: resource)
      guard source.count == 2_150_366, sha(source) == fixtureSHA else { throw Stop.fixtureMismatch }
      let prepared: (CGImage, CIImage, Data) = try step(seconds: 15) { [self] in
        guard let input = CGImageSourceCreateWithData(source as CFData, nil),
          let raw = CGImageSourceCreateImageAtIndex(input, 0, [kCGImageSourceShouldCache: false] as CFDictionary), raw.width == 1122, raw.height == 1402 else { throw Stop.fixtureMismatch }
        let bytes = try jpeg(raw, quality: 1)
        guard let encoded = CGImageSourceCreateWithData(bytes as CFData, nil), let decoded = CGImageSourceCreateImageAtIndex(encoded, 0, [kCGImageSourceShouldCache: false] as CFDictionary) else { throw Stop.nativeFailure }
        let original = CIImage(cgImage: decoded)
        let warm: CGImage = try PhotoEffectsEngine.queue.sync {
          let pixels = PhotoEffectsEngine.lookPixels(original, preset: "warm", intensity: 0.4)
          guard let image = PhotoEffectsEngine.context.createCGImage(pixels, from: pixels.extent, format: .RGBA8, colorSpace: PhotoEffectsEngine.sRGB) else { throw Stop.nativeFailure }
          return image
        }
        return (warm,original,bytes)
      }
      rootJPEGHash = sha(prepared.2)
      // No CGContext read, rendering or hash of Warm pixels between these two fresh requests on the SAME object.
      samples.append(try step(seconds: 40) { [self] in try sample(prepared.0, name: "warm1") })
      samples.append(try step(seconds: 40) { [self] in try sample(prepared.0, name: "warm2") })
      let bw: CGImage = try step(seconds: 15) {
        try PhotoEffectsEngine.queue.sync {
          let pixels = PhotoEffectsEngine.lookPixels(prepared.1, preset: "bw", intensity: 1)
          guard let image = PhotoEffectsEngine.context.createCGImage(pixels, from: pixels.extent, format: .RGBA8, colorSpace: PhotoEffectsEngine.sRGB) else { throw Stop.nativeFailure }
          return image
        }
      }
      samples.append(try step(seconds: 40) { [self] in try sample(bw, name: "bw") })
      var glassPlacements = [[AccessoryPlacement]]()
      for sample in samples {
        let image = sample.name == "bw" ? bw : prepared.0
        let accessories: [FaceAccessory] = sample.name == "bw" ? [.crown] : [.glasses,.crown,.hearts]
        for accessory in accessories {
          let values = placements(sample, image: image, accessory: accessory)
          let rendered: (Data, Int?) = try step(seconds: 15) { [self] in
            let result = try AppleFaceEffectsWorker.renderPlacements(uprightImage: image, placements: values)
            let bytes: Data
            if let data = result.jpegData { bytes = data } else { bytes = try jpeg(result.image, quality: 0.95) }
            let gold: Int?
            if sample.name == "bw" && accessory == .crown { gold = try goldPixels(bytes) } else { gold = nil }
            return (bytes,gold)
          }
          let bytes = rendered.0
          let name = "synthetic-probe-" + sample.name + "-" + accessory.rawValue
          let allowed = ["synthetic-probe-warm1-glasses","synthetic-probe-warm1-crown","synthetic-probe-warm1-hearts",
            "synthetic-probe-warm2-glasses","synthetic-probe-warm2-crown","synthetic-probe-warm2-hearts","synthetic-probe-bw-crown"]
          guard allowed.contains(name) else { throw Stop.nativeFailure }
          let attachment = XCTAttachment(data: bytes, uniformTypeIdentifier: UTType.jpeg.identifier)
          attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
          renderRows.append(["name": name, "decorated": values.count, "noEffectFallback": values.isEmpty,
            "placements": values.map(encodePlacement), "jpegSHA": sha(bytes), "size": [image.width,image.height],
            "goldPixelCount": rendered.1.map { $0 as Any } ?? NSNull()])
          if accessory == .glasses { glassPlacements.append(values) }
        }
      }
      // All observations and all seven artifacts exist BEFORE any alignment/coverage acceptance assertion.
      XCTAssertEqual(samples.count, 3); XCTAssertEqual(renderRows.count, 7)
      for value in samples { XCTAssertEqual(value.detected, 2, value.name); XCTAssertEqual(value.anchors.count, 2, value.name) }
      for row in renderRows { XCTAssertEqual(row["decorated"] as? Int, 2, "Two safe placements are required; omission remains an honest failure.") }
      for values in glassPlacements { checkEyes(values) }
      let gold = renderRows.first { $0["name"] as? String == "synthetic-probe-bw-crown" }?["goldPixelCount"] as? Int
      XCTAssertNotNil(gold, "Actual encoded B&W-crown output requires an independent sRGB scan.")
      XCTAssertGreaterThan(gold ?? 0, 12, "Held native vector-color acceptance requires more than12 gold pixels after B&W.")
      XCTAssertEqual(sha(source), fixtureSHA)
    } catch {
      stopAndDrain()
      let native = error as NSError
      let code: Any = Int32(exactly: native.code).map { Int($0) as Any } ?? NSNull()
      let reason: String
      switch error as? Stop {
      case .timedOut: reason = "timeout"
      case .stopped: reason = "stopped"
      case .fixtureMismatch: reason = "fixture-mismatch"
      case .notArmed: reason = "not-armed"
      case .unsupportedRuntime: reason = "unsupported-runtime"
      case .runnerMismatch: reason = "runner-mismatch"
      case .nativeFailure: reason = "native-failure"
      case nil: reason = "native-error"
      }
      failure = ["reason": reason, "domain": native.domain == VNErrorDomain ? "vision" : "other", "code": code]
      XCTFail("Synthetic probe stopped; no further sample is admitted. Inspect the private bounded attachment.")
    }
  }
}
