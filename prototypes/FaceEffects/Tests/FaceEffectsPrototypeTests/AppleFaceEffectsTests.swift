#if canImport(Vision) && canImport(CoreGraphics)
import XCTest
import CoreGraphics
import CoreImage
import ImageIO
import UniformTypeIdentifiers
import CryptoKit
@testable import FaceEffectsPrototype

final class AppleFaceEffectsTests: XCTestCase {
  func portraitURL() throws -> URL {
    try XCTUnwrap(Bundle.module.url(forResource: "portrait", withExtension: "jpg", subdirectory: "Fixtures"))
  }
  func decode(_ data: Data) throws -> CGImage {
    let source = try XCTUnwrap(CGImageSourceCreateWithData(data as CFData, nil))
    return try XCTUnwrap(CGImageSourceCreateImageAtIndex(source, 0, nil))
  }
  func blank(width: Int = 320, height: Int = 240) throws -> CGImage {
    let context = try XCTUnwrap(CGContext(data: nil, width: width, height: height, bitsPerComponent: 8,
      bytesPerRow: width * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
    context.setFillColor(CGColor(gray: 1, alpha: 1))
    context.fill(CGRect(x: 0, y: 0, width: CGFloat(width), height: CGFloat(height)))
    return try XCTUnwrap(context.makeImage())
  }
  func process(_ image: CGImage, _ accessory: FaceAccessory,
               worker: AppleFaceEffectsWorker = AppleFaceEffectsWorker()) throws -> AppleFaceEffectsOutput {
    let done = expectation(description: "bounded native still work completes")
    var result: Result<AppleFaceEffectsOutput, AppleFaceEffectsError>?
    worker.process(uprightImage: image, accessory: accessory) { result = $0; done.fulfill() }
    wait(for: [done], timeout: 45)
    return try XCTUnwrap(result).get()
  }
  func pixels(_ image: CGImage) throws -> [UInt8] {
    var bytes = [UInt8](repeating: 0, count: image.width * image.height * 4)
    try bytes.withUnsafeMutableBytes {
      let context = try XCTUnwrap(CGContext(data: $0.baseAddress!, width: image.width, height: image.height,
        bitsPerComponent: 8, bytesPerRow: image.width * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
      context.draw(image, in: CGRect(x: 0, y: 0, width: CGFloat(image.width), height: CGFloat(image.height)))
    }; return bytes
  }
  func evidence(_ data: Data, accessory: FaceAccessory) throws {
    guard let directory = ProcessInfo.processInfo.environment["FACE_EFFECTS_EVIDENCE_DIR"] else { return }
    // Only these three synthetic fixture derivatives can be written; no arbitrary filename/input path.
    let name: String
    switch accessory {
    case .glasses: name = "portrait-glasses.jpg"
    case .crown: name = "portrait-crown.jpg"
    case .hearts: name = "portrait-hearts.jpg"
    case .none: throw AppleFaceEffectsError.invalidImage
    }
    let root = URL(fileURLWithPath: directory, isDirectory: true)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    try data.write(to: root.appendingPathComponent(name), options: .withoutOverwriting)
  }
  func testActualVisionPortraitDetectsUsableFacesAndRendersAllThreeOriginalVectors() throws {
    let url = try portraitURL(), source = try Data(contentsOf: url), originalHash = SHA256.hash(data: source)
    let image = try decode(source)
    XCTAssertEqual(image.width, 960); XCTAssertEqual(image.height, 1200)
    let before = try pixels(image)
    var derivatives = Set<String>()
    var coverage = [[String: Any]]()
    let initialFailures = testRun?.failureCount ?? 0
    for accessory in [FaceAccessory.glasses, .crown, .hearts] {
      let output = try process(image, accessory)
      let label = accessory.rawValue
      XCTAssertFalse(output.unchanged, "\(label): usable portrait effect must produce a derivative")
      XCTAssertEqual(output.visionRevision, 3, "\(label): pinned detector revision")
      XCTAssertGreaterThanOrEqual(output.placements.count, 1, "\(label): actual Vision must produce a usable face; identity/count is not fixed")
      XCTAssertLessThanOrEqual(output.placements.count, 2, "\(label): known two-person touching fixture")
      XCTAssertNotNil(output.detectedFaceCount, "\(label): actual detection count")
      XCTAssertNotNil(output.landmarkedFaceCount, "\(label): actual converted landmark count")
      if let detected = output.detectedFaceCount, let landmarked = output.landmarkedFaceCount {
        XCTAssertGreaterThanOrEqual(detected, landmarked, "\(label): counts remain ordered")
        XCTAssertGreaterThanOrEqual(landmarked, output.placements.count, "\(label): decorations cannot exceed usable landmarks")
        coverage.append(coverageRow(accessory, detected: detected, landmarked: landmarked, decorated: output.placements.count))
      }
      XCTAssertTrue(output.placements.allSatisfy { $0.accessory == accessory && $0.finite }, "\(label): valid matching placements")
      XCTAssertNotEqual(try pixels(output.image), before, "\(label): accessory must change actual image pixels")
      XCTAssertNotNil(output.jpegData, "\(label): a rendered JPEG is mandatory")
      guard let jpeg = output.jpegData else { continue } // Assertion failed above; still report every other style.
      let decoded = try decode(jpeg)
      XCTAssertEqual(decoded.width, 960, "\(label): full width"); XCTAssertEqual(decoded.height, 1200, "\(label): full height")
      let metadata = try XCTUnwrap(CGImageSourceCreateWithData(jpeg as CFData, nil), "\(label): readable JPEG")
      let props = try XCTUnwrap(CGImageSourceCopyPropertiesAtIndex(metadata, 0, nil) as? [String: Any], "\(label): JPEG properties")
      XCTAssertNil(props[kCGImagePropertyGPSDictionary as String], "\(label): no source GPS")
      XCTAssertEqual((props[kCGImagePropertyOrientation as String] as? NSNumber)?.intValue ?? 1, 1, "\(label): upright output")
      derivatives.insert(SHA256.hash(data: jpeg).map { String(format: "%02x", $0) }.joined())
      try evidence(jpeg, accessory: accessory)
    }
    XCTAssertEqual(derivatives.count, 3, "Accessories must not all render the same pixels")
    XCTAssertEqual(SHA256.hash(data: try Data(contentsOf: url)), originalHash)
    XCTAssertEqual(try Data(contentsOf: url), source)
    if (testRun?.failureCount ?? 0) == initialFailures { try coverageEvidence(scene: "touching", styles: coverage) }
  }
  func testBlankImageReturnsUntouchedInputWithoutEncodingOrFakeFace() throws {
    let image = try blank()
    let output = try process(image, .glasses)
    XCTAssertTrue(output.unchanged); XCTAssertNil(output.jpegData); XCTAssertTrue(output.image === image)
    XCTAssertTrue(output.placements.isEmpty); XCTAssertEqual(output.visionRevision, 3)
    XCTAssertEqual(output.detectedFaceCount, 0); XCTAssertEqual(output.landmarkedFaceCount, 0)
    XCTAssertEqual(coverageRow(.glasses, detected: 1, landmarked: 1, decorated: 1)["explanation"] as? String, "detector-miss",
      "a never-detected person must not be reported as landmark or placement protection")
  }
  func testNoneUnconditionallyBypassesDetectionAndEncoding() throws {
    let source = try Data(contentsOf: portraitURL()), image = try decode(source)
    let output = try process(image, .none)
    XCTAssertTrue(output.image === image); XCTAssertNil(output.jpegData)
    XCTAssertNil(output.visionRevision); XCTAssertTrue(output.placements.isEmpty)
    XCTAssertNil(output.detectedFaceCount); XCTAssertNil(output.landmarkedFaceCount)
    XCTAssertEqual(try Data(contentsOf: portraitURL()), source)
  }
  func testControlledAnchorsPlaceCrownAtExpectedPixelsAndKeepOuterPixels() throws {
    let image = try blank(width: 400, height: 400)
    let face = FaceAnchors(bounds: UnitRect(x: 0.2, y: 0.25, width: 0.6, height: 0.6),
      leftEye: UnitPoint(x: 0.4, y: 0.5), rightEye: UnitPoint(x: 0.6, y: 0.5), confidence: 1)
    let placements = FaceGeometry.placements(faces: [face], image: ImageSize(width: 400, height: 400), accessory: .crown)
    XCTAssertEqual(placements.count, 1)
    let done = expectation(description: "controlled geometry rendered off main")
    var rendered: Result<AppleFaceEffectsOutput, Error>?
    DispatchQueue.global(qos: .userInitiated).async {
      rendered = Result { try AppleFaceEffectsWorker.renderPlacements(uprightImage: image, placements: placements) }; done.fulfill()
    }
    wait(for: [done], timeout: 10)
    let output = try XCTUnwrap(rendered).get()
    // Top-left gold-band sample: crown center88px + baseband(.34*40px)=101.6px; sample opaque row101.
    let sample = try XCTUnwrap(output.image.cropping(to: CGRect(x: 200, y: 101, width: 1, height: 1)))
    let center = try pixels(sample)
    XCTAssertGreaterThan(Int(center[0]), 180); XCTAssertLessThan(Int(center[2]), 100)
    let corner = try XCTUnwrap(output.image.cropping(to: CGRect(x: 0, y: 0, width: 1, height: 1)))
    XCTAssertEqual(Array(try pixels(corner).prefix(3)), [255,255,255])
  }
  func testNormalizedExifInputDoesNotPropagateGpsOrOriginalOrientation() throws {
    let image = try blank(width: 180, height: 120), sourceBytes = NSMutableData()
    let destination = try XCTUnwrap(CGImageDestinationCreateWithData(sourceBytes as CFMutableData,
      UTType.jpeg.identifier as CFString, 1, nil))
    CGImageDestinationAddImage(destination, image, [kCGImagePropertyOrientation: 6,
      kCGImagePropertyGPSDictionary: [kCGImagePropertyGPSLatitude: 40.0, kCGImagePropertyGPSLatitudeRef: "N"],
      kCGImagePropertyExifDictionary: [kCGImagePropertyExifUserComment: "SYNTHETIC SOURCE ONLY"]] as CFDictionary)
    XCTAssertTrue(CGImageDestinationFinalize(destination))
    let saved = sourceBytes as Data, cg = try decode(saved)
    let oriented = CIImage(cgImage: cg).oriented(forExifOrientation: 6)
    let upright = try XCTUnwrap(CIContext().createCGImage(oriented, from: oriented.extent))
    XCTAssertEqual(upright.width, 120); XCTAssertEqual(upright.height, 180)
    let placement = AccessoryPlacement(accessory: .hearts, center: UnitPoint(x: 0.5, y: 0.4), width: 0.4, height: 0.2, rotation: 0)
    let done = expectation(description: "upright source rendered")
    var rendered: Result<AppleFaceEffectsOutput, Error>?
    DispatchQueue.global().async { rendered = Result { try AppleFaceEffectsWorker.renderPlacements(uprightImage: upright, placements: [placement]) }; done.fulfill() }
    wait(for: [done], timeout: 10)
    let output = try XCTUnwrap(rendered).get(), jpeg = try XCTUnwrap(output.jpegData)
    let result = try decode(jpeg)
    XCTAssertEqual(result.width, 120); XCTAssertEqual(result.height, 180)
    let outputSource = try XCTUnwrap(CGImageSourceCreateWithData(jpeg as CFData, nil))
    let props = try XCTUnwrap(CGImageSourceCopyPropertiesAtIndex(outputSource, 0, nil) as? [String: Any])
    XCTAssertNil(props[kCGImagePropertyGPSDictionary as String])
    XCTAssertEqual((props[kCGImagePropertyOrientation as String] as? NSNumber)?.intValue ?? 1, 1)
    XCTAssertNil((props[kCGImagePropertyExifDictionary as String] as? [String: Any])?[kCGImagePropertyExifUserComment as String])
    XCTAssertEqual(sourceBytes as Data, saved)
  }
  func testSingleFlightRejectsBacklogAndCancellationDoesNotBlockNone() throws {
    let image = try decode(Data(contentsOf: portraitURL()))
    let queue = DispatchQueue(label: "wedding.face.test.suspended")
    queue.suspend()
    var resumed = false
    defer { if !resumed { queue.resume() } }
    let worker = AppleFaceEffectsWorker(testQueue: queue)
    let first = expectation(description: "cancelled native job acknowledges completion")
    let second = expectation(description: "busy request is not queued")
    let none = expectation(description: "None bypass")
    let afterNone = expectation(description: "None does not release active native ownership")
    let id = UUID()
    worker.process(uprightImage: image, accessory: .glasses, requestID: id) { result in
      if case .failure(.cancelled) = result {} else { XCTFail("suspended job must acknowledge cancellation") }
      first.fulfill()
    }
    worker.process(uprightImage: image, accessory: .crown) { result in
      if case .failure(.busy) = result {} else { XCTFail("second native operation must not form a queue") }
      second.fulfill()
    }
    worker.cancel(id)
    worker.process(uprightImage: image, accessory: .none) { result in
      if case .success(let output) = result { XCTAssertTrue(output.unchanged); XCTAssertTrue(output.image === image) }
      else { XCTFail("None must remain unconditional") }
      none.fulfill()
    }
    worker.process(uprightImage: image, accessory: .hearts) { result in
      if case .failure(.busy) = result {} else { XCTFail("None must not admit work while old native job is pending") }
      afterNone.fulfill()
    }
    resumed = true; queue.resume()
    wait(for: [first, second, none, afterNone], timeout: 10)
  }
  // Raw pixels have independently identifiable top/right/bottom/left edges and TL/TR/BR/BL corners.
  // These are caller-contract fixtures, not an integrated EXIF adapter or a Vision identity fixture.
  private var asymmetricEdges: [[UInt8]] { [[240,220,20], [230,90,20], [20,210,220], [150,40,210]] }
  private var asymmetricCorners: [[UInt8]] { [[220,35,45], [40,190,60], [35,70,220], [210,35,185]] }
  private func asymmetricImage() throws -> CGImage {
    let width = 320, height = 200, edges = asymmetricEdges, corners = asymmetricCorners
    var data = [UInt8](repeating: 255, count: width * height * 4)
    for y in 0..<height { for x in 0..<width {
      var color: [UInt8] = [245,245,245]
      if y < 12 { color = edges[0] }
      else if x >= width - 12 { color = edges[1] }
      else if y >= height - 12 { color = edges[2] }
      else if x < 12 { color = edges[3] }
      if x < 32 && y < 32 { color = corners[0] }
      else if x >= width - 32 && y < 32 { color = corners[1] }
      else if x >= width - 32 && y >= height - 32 { color = corners[2] }
      else if x < 32 && y >= height - 32 { color = corners[3] }
      let offset = (y * width + x) * 4
      for channel in 0..<3 { data[offset + channel] = color[channel] }
    } }
    let provider = try XCTUnwrap(CGDataProvider(data: Data(data) as CFData))
    return try XCTUnwrap(CGImage(width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 32,
      bytesPerRow: width * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
      bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.noneSkipLast.rawValue), provider: provider,
      decode: nil, shouldInterpolate: false, intent: .defaultIntent))
  }
  private func color(_ image: CGImage, x: Int, y: Int) throws -> [UInt8] {
    let pixel = try XCTUnwrap(image.cropping(to: CGRect(x: CGFloat(x), y: CGFloat(y), width: 1, height: 1)))
    return Array(try pixels(pixel).prefix(3))
  }
  private func assertMarkers(_ image: CGImage, edges: [Int], corners: [Int], tolerance: Int,
                             file: StaticString = #filePath, line: UInt = #line) throws {
    let w = image.width, h = image.height
    let edgePoints = [(w / 2, 6), (w - 7, h / 2), (w / 2, h - 7), (6, h / 2)]
    let cornerPoints = [(16,16), (w - 17,16), (w - 17,h - 17), (16,h - 17)]
    for index in 0..<4 {
      let edge = try color(image, x: edgePoints[index].0, y: edgePoints[index].1)
      let corner = try color(image, x: cornerPoints[index].0, y: cornerPoints[index].1)
      for channel in 0..<3 {
        XCTAssertLessThanOrEqual(abs(Int(edge[channel]) - Int(asymmetricEdges[edges[index]][channel])), tolerance,
          "asymmetric edge must stay in the expected upright location", file: file, line: line)
        XCTAssertLessThanOrEqual(abs(Int(corner[channel]) - Int(asymmetricCorners[corners[index]][channel])), tolerance,
          "asymmetric corner must stay in the expected upright location", file: file, line: line)
      }
    }
  }
  private func renderForOrientationTest(_ image: CGImage, placements: [AccessoryPlacement]) throws -> AppleFaceEffectsOutput {
    let done = expectation(description: "asymmetric fixture rendered off main")
    var result: Result<AppleFaceEffectsOutput, Error>?
    DispatchQueue.global(qos: .userInitiated).async {
      result = Result { try AppleFaceEffectsWorker.renderPlacements(uprightImage: image, placements: placements) }
      done.fulfill()
    }
    wait(for: [done], timeout: 10)
    return try XCTUnwrap(result).get()
  }
  func testAsymmetricUprightImagePreservesMarkersAndAlignsRolledGlassesWithBothEyes() throws {
    let image = try asymmetricImage(), original = try pixels(image)
    try assertMarkers(image, edges: [0,1,2,3], corners: [0,1,2,3], tolerance: 0)
    let eyes = [UnitPoint(x: 0.38, y: 0.48), UnitPoint(x: 0.62, y: 0.56)]
    let face = FaceAnchors(bounds: UnitRect(x: 0.15, y: 0.2, width: 0.7, height: 0.65),
      leftEye: eyes[0], rightEye: eyes[1], confidence: 1)
    let placements = FaceGeometry.placements(faces: [face], image: ImageSize(width: 320, height: 200), accessory: .glasses)
    XCTAssertEqual(placements.count, 1)
    XCTAssertGreaterThan(try XCTUnwrap(placements.first).rotation, 0.15, "non-square fixture must exercise genuine roll")
    let output = try renderForOrientationTest(image, placements: placements)
    let jpeg = try decode(XCTUnwrap(output.jpegData))
    XCTAssertEqual(jpeg.width, 320); XCTAssertEqual(jpeg.height, 200)
    try assertMarkers(output.image, edges: [0,1,2,3], corners: [0,1,2,3], tolerance: 1)
    try assertMarkers(jpeg, edges: [0,1,2,3], corners: [0,1,2,3], tolerance: 22)
    // Independent expected outer lens rims: eye +/- 0.34*interocular vector.
    // Centers must remain on BOTH known eyes; a centered sticker alone cannot satisfy this.
    let dx = (eyes[1].x - eyes[0].x) * 320, dy = (eyes[1].y - eyes[0].y) * 200
    for index in 0..<2 {
      let sign = index == 0 ? -1.0 : 1.0
      let x = Int((eyes[index].x * 320 + sign * 0.34 * dx).rounded())
      let y = Int((eyes[index].y * 200 + sign * 0.34 * dy).rounded())
      for rendered in [output.image, jpeg] {
        var dark = 0
        for oy in -2...2 { for ox in -2...2 {
          let value = try color(rendered, x: x + ox, y: y + oy)
          if value.allSatisfy({ $0 < 110 }) { dark += 1 }
        } }
        XCTAssertGreaterThan(dark, 0, "expected rolled outer lens rim must align with each eye")
        let eye = try color(rendered, x: Int((eyes[index].x * 320).rounded()), y: Int((eyes[index].y * 200).rounded()))
        XCTAssertTrue(eye.allSatisfy({ $0 > 220 }), "eye centers remain clear inside the original vector frames")
      }
    }
    XCTAssertEqual(try pixels(image), original, "asymmetric source pixels remain immutable")
  }
  func testCallerNormalizesAllEightExifOrientationsOnceBeforeRendering() throws {
    let sourceImage = try asymmetricImage()
    // Independent EXIF permutations; neither table is computed with Core Image or renderer transforms.
    let edges = [[0,1,2,3], [0,3,2,1], [2,3,0,1], [2,1,0,3],
      [3,2,1,0], [3,0,1,2], [1,0,3,2], [1,2,3,0]]
    let corners = [[0,1,2,3], [1,0,3,2], [2,3,0,1], [3,2,1,0],
      [0,3,2,1], [3,0,1,2], [2,1,0,3], [1,2,3,0]]
    let context = CIContext(options: [.workingColorSpace: CGColorSpace(name: CGColorSpace.sRGB)!])
    for orientation in 1...8 {
      let bytes = NSMutableData()
      let destination = try XCTUnwrap(CGImageDestinationCreateWithData(bytes as CFMutableData, UTType.jpeg.identifier as CFString, 1, nil))
      CGImageDestinationAddImage(destination, sourceImage, [kCGImageDestinationLossyCompressionQuality: 1,
        kCGImagePropertyOrientation: orientation] as CFDictionary)
      XCTAssertTrue(CGImageDestinationFinalize(destination))
      let source = bytes as Data, raw = try decode(source)
      // This explicit normalization is CALLER code under test; the renderer accepts upright pixels only.
      let oriented = CIImage(cgImage: raw).oriented(forExifOrientation: Int32(orientation))
      let upright = try XCTUnwrap(context.createCGImage(oriented, from: oriented.extent))
      XCTAssertEqual(upright.width, orientation >= 5 ? 200 : 320)
      XCTAssertEqual(upright.height, orientation >= 5 ? 320 : 200)
      try assertMarkers(upright, edges: edges[orientation - 1], corners: corners[orientation - 1], tolerance: 22)
      let placement = AccessoryPlacement(accessory: .glasses, center: UnitPoint(x: 0.5, y: 0.5),
        width: 0.35, height: 0.14, rotation: 0)
      let output = try renderForOrientationTest(upright, placements: [placement]), jpeg = try XCTUnwrap(output.jpegData)
      let decoded = try decode(jpeg)
      XCTAssertEqual(decoded.width, upright.width); XCTAssertEqual(decoded.height, upright.height)
      try assertMarkers(output.image, edges: edges[orientation - 1], corners: corners[orientation - 1], tolerance: 22)
      try assertMarkers(decoded, edges: edges[orientation - 1], corners: corners[orientation - 1], tolerance: 26)
      let metadata = try XCTUnwrap(CGImageSourceCreateWithData(jpeg as CFData, nil))
      let props = try XCTUnwrap(CGImageSourceCopyPropertiesAtIndex(metadata, 0, nil) as? [String: Any])
      XCTAssertEqual((props[kCGImagePropertyOrientation as String] as? NSNumber)?.intValue ?? 1, 1)
      XCTAssertEqual(bytes as Data, source, "normalization/rendering never rewrites the EXIF-tagged source")
    }
  }

  private func controlledSafetyScenario(_ kind: String) throws -> (CGImage, [FaceAnchors], [UnitRect], UnitRect) {
    let far = FaceAnchors(bounds: UnitRect(x: 0.66, y: 0.60, width: 0.22, height: 0.28),
      leftEye: UnitPoint(x: 0.72, y: 0.72), rightEye: UnitPoint(x: 0.82, y: 0.72), confidence: 1)
    let primary: FaceAnchors, protected: UnitRect
    switch kind {
    case "rolled":
      primary = FaceAnchors(bounds: UnitRect(x: 0.08, y: 0.32, width: 0.30, height: 0.32),
        leftEye: UnitPoint(x: 0.16, y: 0.50), rightEye: UnitPoint(x: 0.30, y: 0.58), confidence: 1)
      // Tall unknown-face corridor blocks every bounded uplift/scale alternative; far face remains clear in x.
      protected = UnitRect(x: 0.34, y: 0.12, width: 0.22, height: 0.51)
    case "edge":
      primary = FaceAnchors(bounds: UnitRect(x: 0.005, y: 0.12, width: 0.18, height: 0.30),
        leftEye: UnitPoint(x: 0.015, y: 0.24), rightEye: UnitPoint(x: 0.085, y: 0.24), confidence: 1)
      protected = primary.bounds
    default:
      primary = FaceAnchors(bounds: UnitRect(x: 0.10, y: 0.30, width: 0.22, height: 0.28),
        leftEye: UnitPoint(x: 0.16, y: 0.42), rightEye: UnitPoint(x: 0.26, y: 0.42), confidence: 1)
      protected = UnitRect(x: 0.31, y: 0.24, width: 0.22, height: 0.30)
    }
    let width = 960, height = 1200
    var bytes = [UInt8](repeating: 255, count: width * height * 4)
    let rectangles = [primary.bounds, far.bounds] + (kind == "edge" ? [] : [protected])
    let colors: [[UInt8]] = [[224,193,164], [184,204,224], [207,188,220]]
    for (index, rect) in rectangles.enumerated() {
      let left = Int(rect.x * 960), top = Int(rect.y * 1200)
      let right = Int((rect.x + rect.width) * 960), bottom = Int((rect.y + rect.height) * 1200)
      for y in top..<bottom { for x in left..<right {
        let nx = (Double(x) - (rect.x + rect.width / 2) * 960) / (rect.width * 480)
        let ny = (Double(y) - (rect.y + rect.height / 2) * 1200) / (rect.height * 600)
        if nx * nx + ny * ny <= 1 || x - left < 2 || right - x <= 2 || y - top < 2 || bottom - y <= 2 {
          let offset = (y * width + x) * 4
          for channel in 0..<3 { bytes[offset + channel] = colors[index][channel] }
        }
      } }
    }
    // Eye crosses are controlled markers, not Vision observations or actual photographed people.
    for face in [primary, far] { for eye in [face.leftEye, face.rightEye] {
      let x = Int(eye.x * 960), y = Int(eye.y * 1200)
      for delta in -4...4 { for point in [(x + delta,y), (x,y + delta)] {
        let offset = (point.1 * width + point.0) * 4
        for channel in 0..<3 { bytes[offset + channel] = 25 }
      } }
    } }
    let provider = try XCTUnwrap(CGDataProvider(data: Data(bytes) as CFData))
    let image = try XCTUnwrap(CGImage(width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 32,
      bytesPerRow: width * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
      bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.noneSkipLast.rawValue), provider: provider,
      decode: nil, shouldInterpolate: false, intent: .defaultIntent))
    return (image, [primary, far], kind == "edge" ? [] : [protected], protected)
  }
  private func assertProtectedPixels(_ source: CGImage, _ result: CGImage, region: UnitRect,
                                      file: StaticString = #filePath, line: UInt = #line) throws {
    let rectangle = CGRect(x: CGFloat(floor(region.x * Double(source.width))), y: CGFloat(floor(region.y * Double(source.height))),
      width: CGFloat(floor(region.width * Double(source.width))), height: CGFloat(floor(region.height * Double(source.height))))
    let before = try XCTUnwrap(source.cropping(to: rectangle)), after = try XCTUnwrap(result.cropping(to: rectangle))
    XCTAssertEqual(try pixels(after), try pixels(before), "protected neighbor pixels must remain untouched in the native image", file: file, line: line)
  }
  private func assertProtectedJpegSamples(_ source: CGImage, _ decoded: CGImage, region: UnitRect,
                                          file: StaticString = #filePath, line: UInt = #line) throws {
    XCTAssertEqual(decoded.width, source.width, file: file, line: line)
    XCTAssertEqual(decoded.height, source.height, file: file, line: line)
    // Nine fixed face-interior samples avoid ellipse/box borders and controlled eye crosses.
    // JPEG0.95 quantizes chroma: <=18/255 per channel is allowed; CG pixels above remain EXACT.
    for fy in [0.25, 0.5, 0.75] { for fx in [0.25, 0.5, 0.75] {
      let x = Int(((region.x + region.width * fx) * Double(source.width)).rounded())
      let y = Int(((region.y + region.height * fy) * Double(source.height)).rounded())
      let expected = try color(source, x: x, y: y), actual = try color(decoded, x: x, y: y)
      for channel in 0..<3 {
        XCTAssertLessThanOrEqual(abs(Int(actual[channel]) - Int(expected[channel])), 18,
          "encoded JPEG must preserve protected face interiors within documented quantization tolerance", file: file, line: line)
      }
    } }
  }
  private func controlledEvidence(_ output: AppleFaceEffectsOutput, name: String) throws {
    guard let directory = ProcessInfo.processInfo.environment["FACE_EFFECTS_EVIDENCE_DIR"] else { return }
    guard ["close-faces.jpg", "rolled-faces.jpg", "edge-faces.jpg"].contains(name) else { throw AppleFaceEffectsError.invalidImage }
    let jpeg = try XCTUnwrap(output.jpegData), root = URL(fileURLWithPath: directory, isDirectory: true)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    try jpeg.write(to: root.appendingPathComponent(name), options: .withoutOverwriting)
  }
  func testCloseFaceAndRollFallbackPreservesProtectedNeighborPixels() throws {
    for kind in ["close", "rolled"] {
      let (image, faces, blockers, protected) = try controlledSafetyScenario(kind)
      let before = try pixels(image), size = ImageSize(width: 960, height: 1200)
      for accessory in [FaceAccessory.glasses, .crown, .hearts] {
        let placements = FaceGeometry.placements(faces: faces, image: size, accessory: accessory, obstructingBounds: blockers)
        XCTAssertGreaterThanOrEqual(placements.count, 1, "far safe face must still receive an accessory")
        if accessory == .glasses || kind == "rolled" {
          XCTAssertTrue(FaceGeometry.placements(faces: [faces[0]], image: size, accessory: accessory,
            obstructingBounds: blockers).isEmpty, "unsafe close/rolled accessory must be rejected, not drawn onto a neighbor")
          XCTAssertEqual(placements.count, 1)
        }
        let output = try renderForOrientationTest(image, placements: placements)
        XCTAssertNotEqual(try pixels(output.image), before, "safe accessory must actually render elsewhere")
        try assertProtectedPixels(image, output.image, region: protected)
        let decoded = try decode(XCTUnwrap(output.jpegData))
        try assertProtectedJpegSamples(image, decoded, region: protected)
      }
      XCTAssertEqual(try pixels(image), before)
    }
  }
  func testControlledCloseRollAndEdgeEvidenceUsesSafeFallback() throws {
    let cases: [(String, FaceAccessory, String)] = [("close", .glasses, "close-faces.jpg"),
      ("rolled", .crown, "rolled-faces.jpg"), ("edge", .hearts, "edge-faces.jpg")]
    for (kind, accessory, name) in cases {
      let (image, faces, blockers, protected) = try controlledSafetyScenario(kind)
      let before = try pixels(image), size = ImageSize(width: 960, height: 1200)
      XCTAssertTrue(FaceGeometry.placements(faces: [faces[0]], image: size, accessory: accessory,
        obstructingBounds: blockers).isEmpty, "unsafe target must use no-effect fallback")
      let placements = FaceGeometry.placements(faces: faces, image: size, accessory: accessory, obstructingBounds: blockers)
      XCTAssertEqual(placements.count, 1, "only the separate safe face receives art")
      let output = try renderForOrientationTest(image, placements: placements)
      try assertProtectedPixels(image, output.image, region: protected)
      let jpeg = try XCTUnwrap(output.jpegData), decoded = try decode(jpeg)
      XCTAssertEqual(decoded.width, 960); XCTAssertEqual(decoded.height, 1200)
      try assertProtectedJpegSamples(image, decoded, region: protected)
      XCTAssertEqual(try pixels(image), before)
      try controlledEvidence(output, name: name)
    }
  }

  func testReliableNeighborClippingPreservesLensCentersAndAllExcludedPixels() throws {
    let image = try blank(width: 960, height: 1200), before = try pixels(image)
    let primary = FaceAnchors(bounds: UnitRect(x: 0.10, y: 0.30, width: 0.30, height: 0.30),
      leftEye: UnitPoint(x: 0.20, y: 0.45), rightEye: UnitPoint(x: 0.30, y: 0.45), confidence: 1)
    let neighbor = FaceAnchors(bounds: UnitRect(x: 0.34, y: 0.30, width: 0.25, height: 0.30),
      leftEye: UnitPoint(x: 0.42, y: 0.45), rightEye: UnitPoint(x: 0.52, y: 0.45), confidence: 1)
    let placements = FaceGeometry.placements(faces: [primary, neighbor], image: ImageSize(width: 960, height: 1200), accessory: .glasses)
    XCTAssertEqual(placements.count, 1, "larger reliable face may keep its safe lenses while trimming its outer temple")
    let placement = try XCTUnwrap(placements.first)
    XCTAssertEqual(placement.excludedFaceBounds.count, 1)
    let weakPrimary = FaceAnchors(bounds: primary.bounds, leftEye: primary.leftEye, rightEye: primary.rightEye, confidence: 0.5)
    XCTAssertTrue(FaceGeometry.placements(faces: [weakPrimary, neighbor], image: ImageSize(width: 960, height: 1200),
      accessory: .glasses).isEmpty, "weak own or neighbor confidence must not admit a clipped accessory in either direction")
    let untrimmed = AccessoryPlacement(accessory: .glasses, center: placement.center, width: placement.width,
      height: placement.height, rotation: placement.rotation)
    let bare = try renderForOrientationTest(image, placements: [untrimmed])
    let rawZone = CGRect(x: CGFloat(neighbor.bounds.x * 960), y: CGFloat(neighbor.bounds.y * 1200),
      width: CGFloat(neighbor.bounds.width * 960), height: CGFloat(neighbor.bounds.height * 1200))
    XCTAssertNotEqual(try pixels(XCTUnwrap(bare.image.cropping(to: rawZone))), try pixels(XCTUnwrap(image.cropping(to: rawZone))),
      "negative control must actually paint into the protected neighbor without clipping")
    let clipped = try renderForOrientationTest(image, placements: placements), jpeg = try decode(XCTUnwrap(clipped.jpegData))
    try assertProtectedPixels(image, clipped.image, region: neighbor.bounds)
    try assertProtectedJpegSamples(image, jpeg, region: neighbor.bounds)
    for excluded in placement.excludedFaceBounds { try assertProtectedPixels(image, clipped.image, region: excluded) }
    for rendered in [clipped.image, jpeg] { for eye in [primary.leftEye, primary.rightEye] {
      let x = Int((eye.x * 960).rounded()), y = Int((eye.y * 1200).rounded())
      XCTAssertTrue(try color(rendered, x: x, y: y).allSatisfy { $0 > 220 }, "both reliable eye centers stay clear")
      var dark = 0
      for dy in -2...2 { for dx in -2...2 {
        if try color(rendered, x: x + dx, y: y - 26 + dy).allSatisfy({ $0 < 110 }) { dark += 1 }
      } }
      XCTAssertGreaterThan(dark, 0, "both top lens rims remain centered above the known eyes")
    } }
    // Deliberately overlapping holes cover real ink. One combined even-odd path would re-include their overlap.
    let first = UnitRect(x: 0.32, y: 0.42, width: 0.04, height: 0.06)
    let second = UnitRect(x: 0.33, y: 0.43, width: 0.04, height: 0.06)
    let overlap = UnitRect(x: 0.33, y: 0.43, width: 0.03, height: 0.05)
    let twoHoles = AccessoryPlacement(accessory: .glasses, center: placement.center, width: placement.width,
      height: placement.height, rotation: placement.rotation, excludedFaceBounds: [first, second])
    let output = try renderForOrientationTest(image, placements: [twoHoles])
    let encoded = try decode(XCTUnwrap(output.jpegData))
    let overlapPixels = CGRect(x: CGFloat(overlap.x * 960), y: CGFloat(overlap.y * 1200),
      width: CGFloat(overlap.width * 960), height: CGFloat(overlap.height * 1200))
    XCTAssertNotEqual(try pixels(XCTUnwrap(bare.image.cropping(to: overlapPixels))),
      try pixels(XCTUnwrap(image.cropping(to: overlapPixels))), "overlap negative control must contain actual accessory ink")
    for region in [first, second, overlap] {
      try assertProtectedPixels(image, output.image, region: region)
      try assertProtectedJpegSamples(image, encoded, region: region)
    }
    XCTAssertEqual(try pixels(image), before)
  }

  private func coverageRow(_ accessory: FaceAccessory, detected: Int, landmarked: Int, decorated: Int) -> [String: Any] {
    let explanation = decorated == 2 ? "none" : detected < 2 ? "detector-miss" : landmarked < 2 ? "landmarks-unusable" : "placement-protection"
    return ["accessory": accessory.rawValue, "detected": detected, "landmarked": landmarked,
      "decorated": decorated, "omitted": max(0, 2 - decorated), "explanation": explanation]
  }
  private func coverageEvidence(scene: String, styles: [[String: Any]]) throws {
    guard ["touching", "separated"].contains(scene), styles.count == 3 else { throw AppleFaceEffectsError.invalidImage }
    guard let directory = ProcessInfo.processInfo.environment["FACE_EFFECTS_EVIDENCE_DIR"] else { return }
    let root = URL(fileURLWithPath: directory, isDirectory: true)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    let bytes = try JSONSerialization.data(withJSONObject: ["scene": scene, "expectedPeople": 2, "styles": styles], options: [.sortedKeys, .prettyPrinted])
    try bytes.write(to: root.appendingPathComponent(scene == "touching" ? "touching-coverage.json" : "separated-coverage.json"), options: .withoutOverwriting)
  }
  private func separatedEvidence(_ data: Data, accessory: FaceAccessory) throws {
    let name: String
    switch accessory {
    case .glasses: name = "separated-glasses.jpg"
    case .crown: name = "separated-crown.jpg"
    case .hearts: name = "separated-hearts.jpg"
    case .none: throw AppleFaceEffectsError.invalidImage
    }
    guard let directory = ProcessInfo.processInfo.environment["FACE_EFFECTS_EVIDENCE_DIR"] else { return }
    let root = URL(fileURLWithPath: directory, isDirectory: true)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    try data.write(to: root.appendingPathComponent(name), options: .withoutOverwriting)
  }
  func testSeparatedPortraitDecoratesBothPeopleForEveryEffect() throws {
    let url = try XCTUnwrap(Bundle.module.url(forResource: "separated-portrait", withExtension: "png", subdirectory: "Fixtures"))
    let source = try Data(contentsOf: url), originalHash = SHA256.hash(data: source), image = try decode(source)
    XCTAssertEqual(originalHash.map { String(format: "%02x", $0) }.joined(), "c6b6c5015df9b172731f021dde939300ebec6bf624818d63c4bda4a1854a3165")
    XCTAssertEqual(image.width, 1122); XCTAssertEqual(image.height, 1402)
    let before = try pixels(image), initialFailures = testRun?.failureCount ?? 0
    var coverage = [[String: Any]](), derivatives = Set<String>()
    for accessory in [FaceAccessory.glasses, .crown, .hearts] {
      let label = accessory.rawValue, output = try process(image, accessory)
      XCTAssertEqual(output.detectedFaceCount, 2, "\(label): actual Vision must detect both separated people")
      XCTAssertEqual(output.landmarkedFaceCount, 2, "\(label): both people need usable landmarks")
      XCTAssertEqual(output.placements.count, 2, "\(label): both separated people must actually receive art")
      XCTAssertFalse(output.unchanged, "\(label): expected two-person derivative")
      XCTAssertEqual(output.visionRevision, 3, "\(label): pinned detector")
      XCTAssertNotNil(output.jpegData, "\(label): mandatory JPEG")
      guard let jpeg = output.jpegData else { continue }
      let decoded = try decode(jpeg)
      XCTAssertEqual(decoded.width, image.width, "\(label): original full width")
      XCTAssertEqual(decoded.height, image.height, "\(label): original full height")
      XCTAssertTrue(output.placements.allSatisfy { $0.accessory == accessory && $0.finite }, "\(label): valid placements")
      let sorted = output.placements.sorted { $0.center.x < $1.center.x }
      if sorted.count == 2 {
        XCTAssertLessThan(sorted[0].center.x, 0.5, "\(label): first person is on the left")
        XCTAssertGreaterThan(sorted[1].center.x, 0.5, "\(label): second person is on the right")
        XCTAssertGreaterThan(sorted[1].center.x - sorted[0].center.x, 0.20, "\(label): two distinct person regions")
        for placement in sorted {
          // Independently scan an envelope around EACH actual placement, not merely global image inequality.
          let c = abs(cos(placement.rotation)), t = abs(sin(placement.rotation))
          let halfW = (placement.width * Double(image.width) * c + placement.height * Double(image.height) * t) * 0.515
          let halfH = (placement.width * Double(image.width) * t + placement.height * Double(image.height) * c) * 0.515
          let x = max(0, Int(floor(placement.center.x * Double(image.width) - halfW)))
          let y = max(0, Int(floor(placement.center.y * Double(image.height) - halfH)))
          let w = min(image.width - x, Int(ceil(halfW * 2))), h = min(image.height - y, Int(ceil(halfH * 2)))
          XCTAssertGreaterThan(w, 0); XCTAssertGreaterThan(h, 0)
          let region = CGRect(x: CGFloat(x), y: CGFloat(y), width: CGFloat(w), height: CGFloat(h))
          let original = try pixels(XCTUnwrap(image.cropping(to: region)))
          let rendered = try pixels(XCTUnwrap(output.image.cropping(to: region)))
          let encoded = try pixels(XCTUnwrap(decoded.cropping(to: region)))
          XCTAssertNotEqual(rendered, original, "\(label): each person's native region must contain actual vector ink")
          let changed = original.indices.filter { index in
            index % 4 != 3 && abs(Int(rendered[index]) - Int(original[index])) > 45
              && abs(Int(encoded[index]) - Int(original[index])) > 30
          }.count
          XCTAssertGreaterThan(changed, 12, "\(label): each person's JPEG region must change beyond mild quantization noise")
        }
      }
      let jpegSource = try XCTUnwrap(CGImageSourceCreateWithData(jpeg as CFData, nil))
      let props = try XCTUnwrap(CGImageSourceCopyPropertiesAtIndex(jpegSource, 0, nil) as? [String: Any])
      XCTAssertEqual((props[kCGImagePropertyOrientation as String] as? NSNumber)?.intValue ?? 1, 1)
      XCTAssertNil(props[kCGImagePropertyGPSDictionary as String])
      XCTAssertNotEqual(try pixels(output.image), before)
      if let detected = output.detectedFaceCount, let landmarked = output.landmarkedFaceCount {
        coverage.append(coverageRow(accessory, detected: detected, landmarked: landmarked, decorated: output.placements.count))
      }
      derivatives.insert(SHA256.hash(data: jpeg).map { String(format: "%02x", $0) }.joined())
      try separatedEvidence(jpeg, accessory: accessory)
    }
    XCTAssertEqual(derivatives.count, 3)
    XCTAssertEqual(SHA256.hash(data: try Data(contentsOf: url)), originalHash)
    XCTAssertEqual(try Data(contentsOf: url), source)
    if (testRun?.failureCount ?? 0) == initialFailures { try coverageEvidence(scene: "separated", styles: coverage) }
  }

  func testTiaraPearlsRemainPhysicallyRoundOnNonsquareCanvas() throws {
    let image = try blank(width: 400, height: 200), original = try pixels(image)
    // Physical accessory scale is240x100px, not the normalized.6x.5 ratio.
    // The center pearl is at(200,67), radius3.8px; its cream fill is distinct from white and gold arch ink.
    let placement = AccessoryPlacement(accessory: .crown, center: UnitPoint(x: 0.5, y: 0.5),
      width: 0.6, height: 0.5, rotation: 0)
    let output = try renderForOrientationTest(image, placements: [placement])
    let seed = try color(output.image, x: 200, y: 67)
    // Independent opaque swatch uses the same public source color and destination format,
    // accounting for native color conversion instead of assuming literal 8-bit RGB values.
    let swatch = try XCTUnwrap(CGContext(data: nil, width: 8, height: 8, bitsPerComponent: 8, bytesPerRow: 8 * 4,
      space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
    swatch.setFillColor(CGColor(red: 0.97, green: 0.94, blue: 0.85, alpha: 1))
    swatch.fill(CGRect(x: 0, y: 0, width: 8, height: 8))
    let reference = try color(XCTUnwrap(swatch.makeImage()), x: 4, y: 4)
    for channel in 0..<3 {
      XCTAssertLessThanOrEqual(abs(Int(seed[channel]) - Int(reference[channel])), 2,
        "central opaque seed must match independent cream swatch, seed=\(seed), reference=\(reference)")
    }
    // Gold/white antialias can satisfy a broad cream range; isolate the connected true-fill component.
    var matching = Set<Int>()
    for y in 58...76 { for x in 188...212 {
      let rgb = try color(output.image, x: x, y: y)
      if (0..<3).allSatisfy({ abs(Int(rgb[$0]) - Int(seed[$0])) <= 2 }) { matching.insert(y * 400 + x) }
    } }
    var pending = [67 * 400 + 200], component = Set<Int>()
    while let point = pending.popLast() {
      guard matching.contains(point), component.insert(point).inserted else { continue }
      pending.append(contentsOf: [point - 1, point + 1, point - 400, point + 400])
    }
    XCTAssertFalse(component.isEmpty, "actual physical pearl seed component must render, seed=\(seed)")
    let left = try XCTUnwrap(component.map { $0 % 400 }.min()), right = try XCTUnwrap(component.map { $0 % 400 }.max())
    let top = try XCTUnwrap(component.map { $0 / 400 }.min()), bottom = try XCTUnwrap(component.map { $0 / 400 }.max())
    let physicalWidth = right - left + 1, physicalHeight = bottom - top + 1
    // Tight matching measures the OPAQUE FILL CORE:7.6px outer diameter minus1.6px stroke,
    // then roughly1px antialias margin on each side yields about4px, not the full7.6px outline.
    let diagnostic = "opaque-core W=\(physicalWidth), H=\(physicalHeight), seed=\(seed), reference=\(reference)"
    XCTAssertLessThanOrEqual(abs(physicalWidth - physicalHeight), 1, "equal physical pearl diameters: " + diagnostic)
    XCTAssertTrue((4...6).contains(physicalWidth), "expected4...6px horizontal opaque core, not outer outline; " + diagnostic)
    XCTAssertTrue((4...6).contains(physicalHeight), "expected4...6px vertical opaque core, not outer outline; " + diagnostic)
    XCTAssertEqual(Double(left + right) / 2 + 0.5, 200, accuracy: 1, diagnostic)
    XCTAssertEqual(Double(top + bottom) / 2 + 0.5, 67, accuracy: 1, diagnostic)
    for point in [(198,67), (202,67), (200,65), (200,69)] {
      let rgb = try color(output.image, x: point.0, y: point.1)
      XCTAssertTrue(rgb[0] > 230 && rgb[1] > 220 && (195...235).contains(Int(rgb[2])),
        "both physical axes retain cream interior away from arch; rgb=\(rgb); " + diagnostic)
    }
    XCTAssertEqual(try pixels(image), original)
  }

}
#endif
