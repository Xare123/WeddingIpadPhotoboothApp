import XCTest
import Foundation
import CoreImage
import ImageIO
import UniformTypeIdentifiers
import CryptoKit
import Vision

/// Compiled alongside pure engine sources in the unhosted iOS target; no Expo dependency.
final class NativePhotoTreatmentEngineTests: XCTestCase {
  var root: URL!, originals: URL!, cache: URL!, engine: PhotoTreatmentEngine!
  override func setUpWithError() throws {
    root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    originals = root.appendingPathComponent("Documents/photobooth", isDirectory: true)
    cache = root.appendingPathComponent("Treatments", isDirectory: true)
    try FileManager.default.createDirectory(at: originals, withIntermediateDirectories: true)
    engine = PhotoTreatmentEngine(cacheDirectory: cache, originalsDirectory: originals)
  }
  override func tearDownWithError() throws { try FileManager.default.removeItem(at: root) }
  func recipe(_ preset: String = "original", _ intensity: Double = 0, _ face: String = "none") throws -> String {
    let object: [String: Any] = ["version": PhotoTreatmentEngine.version, "order": "look-then-face",
      "look": ["preset": preset, "intensity": intensity, "version": PhotoEffectsEngine.recipeVersion],
      "face": ["accessory": face, "version": FaceGeometry.recipeVersion]]
    return String(data: try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]), encoding: .utf8)!
  }
  func render(_ source: URL, _ json: String, id: UUID = UUID(), on renderer: PhotoTreatmentEngine? = nil) throws -> PhotoTreatmentEngine.Output {
    let done = expectation(description: "single full-resolution treatment finishes")
    var output: Result<PhotoTreatmentEngine.Output, PhotoTreatmentEngine.Failure>?
    (renderer ?? engine).render(source: source, recipeJSON: json, id: id) { output = $0; done.fulfill() }
    wait(for: [done], timeout: 90)
    return try XCTUnwrap(output).get()
  }
  func image(_ data: Data) throws -> CGImage {
    let source = try XCTUnwrap(CGImageSourceCreateWithData(data as CFData, nil))
    return try XCTUnwrap(CGImageSourceCreateImageAtIndex(source, 0, nil))
  }
  func jpeg(_ cg: CGImage, orientation: Int = 1, name: String = "original") throws -> URL {
    let data = NSMutableData()
    let destination = try XCTUnwrap(CGImageDestinationCreateWithData(data as CFMutableData, UTType.jpeg.identifier as CFString, 1, nil))
    CGImageDestinationAddImage(destination, cg, [kCGImageDestinationLossyCompressionQuality: 1,
      kCGImagePropertyOrientation: orientation, kCGImagePropertyGPSDictionary: [kCGImagePropertyGPSLatitude: 42.5],
      kCGImagePropertyExifDictionary: [kCGImagePropertyExifUserComment: "SYNTHETIC ROOT"]] as CFDictionary)
    XCTAssertTrue(CGImageDestinationFinalize(destination))
    let url = originals.appendingPathComponent(name + ".jpg"); try (data as Data).write(to: url); return url
  }
  func blank() throws -> CGImage {
    let context = try XCTUnwrap(CGContext(data: nil, width: 320, height: 200, bitsPerComponent: 8, bytesPerRow: 320 * 4,
      space: PhotoEffectsEngine.sRGB, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
    context.setFillColor(CGColor(red: 0.55, green: 0.45, blue: 0.35, alpha: 1)); context.fill(CGRect(x: 0, y: 0, width: 320, height: 200))
    context.setFillColor(CGColor(red: 0.1, green: 0.7, blue: 0.2, alpha: 1)); context.fill(CGRect(x: 0, y: 0, width: 24, height: 24))
    context.setFillColor(CGColor(red: 0.8, green: 0.1, blue: 0.3, alpha: 1)); context.fill(CGRect(x: 296, y: 176, width: 24, height: 24))
    return try XCTUnwrap(context.makeImage())
  }
  func separated() throws -> URL {
    let resource = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "separated-portrait", withExtension: "png"))
    let data = try Data(contentsOf: resource)
    let digest = sha(data)
    XCTAssertEqual(digest, "c6b6c5015df9b172731f021dde939300ebec6bf624818d63c4bda4a1854a3165")
    guard digest == "c6b6c5015df9b172731f021dde939300ebec6bf624818d63c4bda4a1854a3165" else { throw PhotoTreatmentEngine.Failure.invalidInput }
    return try jpeg(image(data))
  }
  func sha(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
  func pixels(_ cg: CGImage) throws -> [UInt8] {
    var bytes = [UInt8](repeating: 0, count: cg.width * cg.height * 4)
    try bytes.withUnsafeMutableBytes {
      let context = try XCTUnwrap(CGContext(data: $0.baseAddress!, width: cg.width, height: cg.height, bitsPerComponent: 8,
        bytesPerRow: cg.width * 4, space: PhotoEffectsEngine.sRGB, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
      context.draw(cg, in: CGRect(x: 0, y: 0, width: CGFloat(cg.width), height: CGFloat(cg.height)))
    }; return bytes
  }
  func data(_ output: PhotoTreatmentEngine.Output) throws -> Data { try Data(contentsOf: XCTUnwrap(URL(string: output.uri))) }
  func properties(_ data: Data) throws -> [String: Any] {
    let input = try XCTUnwrap(CGImageSourceCreateWithData(data as CFData, nil))
    return try XCTUnwrap(CGImageSourceCopyPropertiesAtIndex(input, 0, nil) as? [String: Any])
  }
  func testIdentityAndNonePreserveExactOriginalBytesAndNeverRunDetection() throws {
    let source = try jpeg(blank(), orientation: 6), original = try Data(contentsOf: source)
    let result = try render(source, recipe("warm", 0))
    XCTAssertTrue(result.isOriginal); XCTAssertEqual(result.uri, source.absoluteString)
    XCTAssertEqual(try data(result), original); XCTAssertEqual(result.originalSha256, sha(original)); XCTAssertEqual(result.outputSha256, sha(original))
    XCTAssertEqual(result.width, 200); XCTAssertEqual(result.height, 320)
    XCTAssertNil(result.detectedFaceCount); XCTAssertNil(result.landmarkedFaceCount); XCTAssertEqual(result.decoratedFaceCount, 0)
    XCTAssertEqual(result.recipe.look.preset, "original"); XCTAssertEqual(result.recipe.face.accessory, "none")
    XCTAssertThrowsError(try engine.release(source)); XCTAssertEqual(try Data(contentsOf: source), original)
  }
  func testActualSeparatedPortraitDecoratesBothPeopleAfterLookWithoutReencodingIntermediate() throws {
    let source = try separated(), original = try Data(contentsOf: source)
    for face in ["glasses", "crown", "hearts"] {
      let result = try render(source, recipe("warm", 0.4, face)), bytes = try data(result)
      if face == "glasses" {
        do { try attachSyntheticPlacementDiagnostics(source: source, receipt: result) }
        catch { XCTFail("Generated-fixture placement diagnostics could not complete; production acceptance assertions remain required") }
      }
      XCTAssertEqual(result.detectedFaceCount, 2, face); XCTAssertEqual(result.landmarkedFaceCount, 2, face)
      XCTAssertEqual(result.decoratedFaceCount, 2, face); XCTAssertEqual(result.fallbackReason, "none", face)
      XCTAssertFalse(result.isOriginal); XCTAssertEqual(result.recipe.face.accessory, face)
      XCTAssertEqual(result.width, 1122); XCTAssertEqual(result.height, 1402)
      XCTAssertEqual(result.originalSha256, sha(original)); XCTAssertEqual(result.outputSha256, sha(bytes))
      let props = try properties(bytes)
      XCTAssertNil(props[kCGImagePropertyGPSDictionary as String]); XCTAssertEqual((props[kCGImagePropertyOrientation as String] as? NSNumber)?.intValue ?? 1, 1)
      let attachment = XCTAttachment(data: bytes, uniformTypeIdentifier: UTType.jpeg.identifier)
      attachment.name = "treatment-separated-" + face; attachment.lifetime = .keepAlways; add(attachment)
      if let directory = ProcessInfo.processInfo.environment["TREATMENT_EVIDENCE_DIR"] {
        let allowed = ["glasses": "treatment-separated-glasses.jpg", "crown": "treatment-separated-crown.jpg", "hearts": "treatment-separated-hearts.jpg"]
        let name = try XCTUnwrap(allowed[face]), folder = URL(fileURLWithPath: directory, isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try bytes.write(to: folder.appendingPathComponent(name), options: .withoutOverwriting)
      }
    }
    XCTAssertEqual(try Data(contentsOf: source), original)
  }
  func testBlankFaceFallbackRetainsLookAndIdentityFallbackReturnsOriginal() throws {
    let source = try jpeg(blank()), original = try Data(contentsOf: source)
    let identity = try render(source, recipe("original", 0, "hearts"))
    XCTAssertTrue(identity.isOriginal); XCTAssertEqual(try data(identity), original)
    XCTAssertEqual(identity.fallbackReason, "no-face"); XCTAssertEqual(identity.recipe.face.accessory, "none")
    XCTAssertEqual(identity.detectedFaceCount, 0); XCTAssertEqual(identity.landmarkedFaceCount, 0)
    let looked = try render(source, recipe("warm", 0.8, "glasses"))
    XCTAssertFalse(looked.isOriginal); XCTAssertEqual(looked.recipe.look.preset, "warm")
    XCTAssertEqual(looked.recipe.face.accessory, "none"); XCTAssertEqual(looked.fallbackReason, "no-face")
    XCTAssertNotEqual(try pixels(image(data(looked))), try pixels(image(original)))
    XCTAssertEqual(try Data(contentsOf: source), original)
  }
  func testLookNoneMatchesExistingEnginePixelsAndRecipeOrderKeepsVectorColors() throws {
    let source = try separated(), input = try image(Data(contentsOf: source))
    let old = PhotoEffectsEngine(cacheDirectory: root.appendingPathComponent("old"))
    let legacy = try old.render(source: source, preset: "bw", intensity: 1, preview: false, id: UUID())
    let onlyLook = try render(source, recipe("bw", 1))
    let treatmentLookBytes = try data(onlyLook), legacyLookBytes = try Data(contentsOf: URL(string: legacy.uri)!)
    let legacyLookByteEqual = treatmentLookBytes == legacyLookBytes
    XCTAssertEqual(treatmentLookBytes, legacyLookBytes)
    let treatment = try render(source, recipe("bw", 1, "crown")), output = try pixels(image(data(treatment)))
    let original = CIImage(cgImage: input)
    let looked = PhotoEffectsEngine.lookPixels(original, preset: "bw", intensity: 1)
    let lookedCG = try XCTUnwrap(PhotoEffectsEngine.context.createCGImage(looked, from: looked.extent, format: .RGBA8, colorSpace: PhotoEffectsEngine.sRGB))
    let worker = AppleFaceEffectsWorker(), done = expectation(description: "independent look-then-face reference")
    var referenceResult: Result<AppleFaceEffectsOutput, AppleFaceEffectsError>?
    worker.process(uprightImage: lookedCG, accessory: .crown) { referenceResult = $0; done.fulfill() }
    wait(for: [done], timeout: 90)
    var reference: AppleFaceEffectsOutput?, referenceStatus = "absent", referenceFailure = "none"
    switch referenceResult {
    case .success(let value): reference = value; referenceStatus = "success"
    case .failure(let error):
      referenceStatus = "failure"; referenceFailure = String(describing: error)
      XCTFail("Independent reference worker failed: " + referenceFailure)
    case nil: break
    }
    var goldPixels = 0
    for offset in stride(from: 0, to: output.count, by: 4) {
      if Int(output[offset]) > Int(output[offset + 2]) + 50 && output[offset] > 130 { goldPixels += 1 }
    }
    let orderSummary: [String: Any] = ["scope": "TEST_ONLY_SHA_PINNED_GENERATED_FIXTURE_NOT_GUEST_DATA", "fixtureSHA": "c6b6c5015df9b172731f021dde939300ebec6bf624818d63c4bda4a1854a3165",
      "legacyLookByteEqual": legacyLookByteEqual,
      "treatment": ["detected": treatment.detectedFaceCount ?? -1, "landmarked": treatment.landmarkedFaceCount ?? -1, "decorated": treatment.decoratedFaceCount],
      "reference": reference.map { ["detected": $0.detectedFaceCount ?? -1, "landmarked": $0.landmarkedFaceCount ?? -1, "decorated": $0.placements.count] as Any } ?? NSNull(),
      "referenceStatus": referenceStatus, "referenceFailure": referenceFailure,
      "referenceJpegPresent": reference?.jpegData != nil, "goldPixelCount": goldPixels]
    let orderBytes = try JSONSerialization.data(withJSONObject: orderSummary, options: [.sortedKeys])
    guard orderBytes.count <= 1500 else { throw PhotoTreatmentEngine.Failure.resourceLimit }
    print("SYNTHETIC_FACE_ORDER_SUMMARY " + String(decoding: orderBytes, as: UTF8.self))
    XCTAssertEqual(try data(treatment), try XCTUnwrap(reference?.jpegData), "exact final JPEG comes from the face renderer, no intermediate JPEG")
    XCTAssertGreaterThan(goldPixels, 12, "ornament gold stays colored because B&W is applied before face art")
  }

  func testAllEightExifOrientationsNormalizeOnceAndScrubMetadata() throws {
    let fixture = try blank(), context = CIContext(options: [.workingColorSpace: PhotoEffectsEngine.sRGB, .outputColorSpace: PhotoEffectsEngine.sRGB])
    for orientation in 1...8 {
      let source = try jpeg(fixture, orientation: orientation, name: "orientation-\(orientation)")
      let result = try render(source, recipe("film", 0.7)), bytes = try data(result)
      let raw = try image(Data(contentsOf: source)), oriented = CIImage(cgImage: raw).oriented(forExifOrientation: Int32(orientation))
      let upright = oriented.transformed(by: CGAffineTransform(translationX: -oriented.extent.minX, y: -oriented.extent.minY))
      let looked = PhotoEffectsEngine.lookPixels(upright, preset: "film", intensity: 0.7)
      let reference = try XCTUnwrap(context.createCGImage(looked, from: upright.extent, format: .RGBA8, colorSpace: PhotoEffectsEngine.sRGB))
      let actual = try image(bytes)
      XCTAssertEqual(actual.width, orientation >= 5 ? 200 : 320); XCTAssertEqual(actual.height, orientation >= 5 ? 320 : 200)
      let a = try pixels(actual), b = try pixels(reference)
      let mean = zip(a,b).reduce(0.0) { $0 + abs(Double($1.0) - Double($1.1)) } / Double(a.count)
      XCTAssertLessThan(mean, 5)
      let props = try properties(bytes)
      XCTAssertNil(props[kCGImagePropertyGPSDictionary as String]); XCTAssertNil((props[kCGImagePropertyExifDictionary as String] as? [String: Any])?[kCGImagePropertyExifUserComment as String])
      XCTAssertEqual((props[kCGImagePropertyOrientation as String] as? NSNumber)?.intValue ?? 1, 1)
    }
  }
  func testCancellationBusyAdmissionAndNoneDoNotReleasePhysicalJobEarly() throws {
    let source = try jpeg(blank()), queue = DispatchQueue(label: "treatment.suspended.test")
    queue.suspend(); var resumed = false; defer { if !resumed { queue.resume() } }
    let controlled = PhotoTreatmentEngine(cacheDirectory: cache, originalsDirectory: originals, workQueue: queue)
    let first = expectation(description: "cancelled operation acknowledges physical completion"), id = UUID()
    controlled.render(source: source, recipeJSON: try recipe("warm", 1), id: id) { result in
      if case .failure(.cancelled) = result {} else { XCTFail("must acknowledge cancellation") }; first.fulfill()
    }
    let busy = expectation(description: "None cannot bypass an active physical operation")
    engine.render(source: source, recipeJSON: try recipe(), id: UUID()) { result in
      if case .failure(.busy) = result {} else { XCTFail("global single-flight must reject backlog") }; busy.fulfill()
    }
    controlled.cancel(id)
    let stillBusy = expectation(description: "cancel flag does not release physical work")
    controlled.render(source: source, recipeJSON: try recipe(), id: UUID()) { result in
      if case .failure(.busy) = result {} else { XCTFail("must remain busy until worker acknowledges") }; stillBusy.fulfill()
    }
    resumed = true; queue.resume(); wait(for: [first,busy,stillBusy], timeout: 15)
    XCTAssertTrue(try render(source, recipe()).isOriginal)
    XCTAssertTrue(try FileManager.default.contentsOfDirectory(at: cache, includingPropertiesForKeys: nil).isEmpty)
  }
  func testSourceScopeAndReleaseRejectQueriesHostsSymlinksAndOriginals() throws {
    let source = try jpeg(blank()), json = try recipe("warm", 0.5)
    for suffix in ["?x=1", "#fragment"] { XCTAssertThrowsError(try render(URL(string: source.absoluteString + suffix)!, json)) }
    XCTAssertThrowsError(try render(URL(string: "file://otherhost" + source.path)!, json))
    let outside = root.appendingPathComponent("outside.jpg"); try Data(contentsOf: source).write(to: outside)
    XCTAssertThrowsError(try render(outside, json))
    let link = originals.appendingPathComponent("link.jpg"); try FileManager.default.createSymbolicLink(at: link, withDestinationURL: outside)
    XCTAssertThrowsError(try render(link, json)); XCTAssertThrowsError(try engine.release(source))
    let result = try render(source, json), owned = URL(string: result.uri)!
    XCTAssertThrowsError(try render(owned, json), "derivative cache may never become root input")
    XCTAssertThrowsError(try engine.release(URL(string: owned.absoluteString + "?x=1")!))
    try engine.release(owned); try engine.release(owned)
    XCTAssertFalse(FileManager.default.fileExists(atPath: owned.path)); XCTAssertTrue(FileManager.default.fileExists(atPath: source.path))
  }
  func testRecipeValidationCacheQuotaAndRestartCleanupFailClosed() throws {
    let source = try jpeg(blank()), valid = try recipe("warm", 0.5)
    for bad in [valid.replacingOccurrences(of: "look-then-face", with: "face-then-look"), valid.replacingOccurrences(of: "wedding-face-prototype-v3", with: "old"),
      valid.replacingOccurrences(of: "warm", with: "unknown"), valid.replacingOccurrences(of: "0.5", with: "2.0")] {
      XCTAssertThrowsError(try render(source, bad))
    }
    for _ in 0..<48 { try Data("orphan".utf8).write(to: cache.appendingPathComponent(UUID().uuidString + ".jpg")) }
    XCTAssertThrowsError(try render(source, valid))
    let unrelated = cache.appendingPathComponent("keep.txt"); try Data("keep".utf8).write(to: unrelated)
    weak var previous = engine
    engine = nil
    let released = XCTNSPredicateExpectation(predicate: NSPredicate { _,_ in previous == nil }, object: nil)
    wait(for: [released], timeout: 5)
    XCTAssertNil(previous, "restart cleanup requires the prior native engine lifetime to end")
    engine = PhotoTreatmentEngine(cacheDirectory: cache, originalsDirectory: originals)
    XCTAssertTrue(FileManager.default.fileExists(atPath: unrelated.path))
    XCTAssertFalse(try render(source, valid).isOriginal)
  }
  func testRenderedFileHashAndPreviewApplyParityUseSameImmutableCacheFile() throws {
    let source = try jpeg(blank()), original = try Data(contentsOf: source)
    let rendered = try render(source, recipe("warm", 0.7)), previewBytes = try data(rendered)
    let committed = root.appendingPathComponent("durable.jpg"), temporary = root.appendingPathComponent("durable.partial")
    try previewBytes.write(to: temporary); try FileManager.default.moveItem(at: temporary, to: committed)
    XCTAssertEqual(try Data(contentsOf: committed), previewBytes)
    XCTAssertEqual(sha(previewBytes), rendered.outputSha256); XCTAssertEqual(try data(rendered), previewBytes)
    XCTAssertEqual(rendered.originalSha256, sha(original)); XCTAssertEqual(try Data(contentsOf: source), original)
    let canonical = try rendered.recipe.canonicalJSON
    XCTAssertEqual(try PhotoTreatmentEngine.Recipe.parse(canonical).canonicalJSON, canonical)
    try engine.release(URL(string: rendered.uri)!); XCTAssertEqual(try Data(contentsOf: committed), previewBytes)
  }
  func testOverlappingEnginesPreserveActiveAndReturnedCacheFiles() throws {
    let source = try jpeg(blank()), json = try recipe("warm", 0.7)
    let preview = try render(source, json), previewURL = try XCTUnwrap(URL(string: preview.uri)), previewBytes = try data(preview)
    let rollover = PhotoTreatmentEngine(cacheDirectory: cache.appendingPathComponent(".", isDirectory: true), originalsDirectory: originals)
    XCTAssertEqual(try Data(contentsOf: previewURL), previewBytes, "new live engine must preserve an idle older engine's returned preview")
    let reached = expectation(description: "actual UUID temporary JPEG exists before atomic commit")
    let finished = expectation(description: "old physical work acknowledges cancellation")
    let resumeCommit = DispatchSemaphore(value: 0)
    var temporary: URL?, joined = false
    let controlled = PhotoTreatmentEngine(cacheDirectory: cache, originalsDirectory: originals,
      workQueue: DispatchQueue(label: "treatment.commit.window.test"), beforeAtomicCommit: { url in
        temporary = url; reached.fulfill()
        _ = resumeCommit.wait(timeout: .now() + 15)
      })
    let id = UUID()
    controlled.render(source: source, recipeJSON: json, id: id) { result in
      if case .failure(.cancelled) = result {} else { XCTFail("parked old work must acknowledge cooperative cancellation") }
      finished.fulfill()
    }
    defer { resumeCommit.signal(); if !joined { wait(for: [finished], timeout: 20) } }
    wait(for: [reached], timeout: 15)
    let activeTemporary = try XCTUnwrap(temporary)
    XCTAssertEqual(activeTemporary.pathExtension, "tmp")
    XCTAssertGreaterThan(try Data(contentsOf: activeTemporary).count, 0)
    let next = PhotoTreatmentEngine(cacheDirectory: cache, originalsDirectory: originals)
    XCTAssertTrue(FileManager.default.fileExists(atPath: activeTemporary.path), "rollover must not unlink a real old-engine temporary write")
    XCTAssertEqual(try Data(contentsOf: previewURL), previewBytes, "returned preview remains valid even during another engine's work")
    controlled.cancel(id); resumeCommit.signal(); wait(for: [finished], timeout: 20); joined = true
    XCTAssertFalse(FileManager.default.fileExists(atPath: activeTemporary.path), "only the owning cancelled job cleans its own temporary file")
    XCTAssertEqual(try Data(contentsOf: previewURL), previewBytes)
    withExtendedLifetime((rollover, controlled, next)) {}
  }

  /// TEST ONLY. Never called by the module or engine; only the SHA-pinned fictional PNG authorizes attachment data.
  private func attachSyntheticPlacementDiagnostics(source: URL, receipt: PhotoTreatmentEngine.Output) throws {
    let resource = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "separated-portrait", withExtension: "png"))
    let png = try Data(contentsOf: resource)
    guard sha(png) == "c6b6c5015df9b172731f021dde939300ebec6bf624818d63c4bda4a1854a3165" else { throw PhotoTreatmentEngine.Failure.invalidInput }
    let done = expectation(description: "bounded generated-fixture placement diagnosis")
    var result: Result<Data, Error>?
    DispatchQueue.global(qos: .userInitiated).async {
      result = Result { try autoreleasepool {
        guard VNDetectFaceLandmarksRequest.supportedRevisions.contains(3) else { throw PhotoTreatmentEngine.Failure.processingFailed }
        let input = try XCTUnwrap(CGImageSourceCreateWithURL(source as CFURL, nil))
        let props = try XCTUnwrap(CGImageSourceCopyPropertiesAtIndex(input, 0, nil) as? [String: Any])
        let orientation = (props[kCGImagePropertyOrientation as String] as? NSNumber)?.int32Value ?? 1
        let raw = try XCTUnwrap(CGImageSourceCreateImageAtIndex(input, 0, [kCGImageSourceShouldCache: false] as CFDictionary))
        let oriented = CIImage(cgImage: raw).oriented(forExifOrientation: orientation)
        let upright = oriented.transformed(by: CGAffineTransform(translationX: -oriented.extent.minX, y: -oriented.extent.minY))
        let warm: CGImage = try PhotoEffectsEngine.queue.sync {
          let looked = PhotoEffectsEngine.lookPixels(upright, preset: "warm", intensity: 0.4)
          return try XCTUnwrap(PhotoEffectsEngine.context.createCGImage(looked, from: upright.extent, format: .RGBA8, colorSpace: PhotoEffectsEngine.sRGB))
        }
        // "ci" labels the uncopied CI-origin image, not a proven lazy-render state.
        // No test CGContext read occurs before request0; post-request hashing may warm request1.
        // Owned-copy creation occurs only after both CI-origin attempts have completed.
        let variants: [(String, Bool, Bool)] = [("warm-cpu-ci",true,false), ("warm-default-ci",false,false),
          ("warm-cpu-copy",true,true), ("warm-default-copy",false,true)]
        var ownedCopy: CGImage?, reports = [[String: Any]]()
        for (name, forceCPU, materialized) in variants {
          let cg: CGImage
          if materialized {
            if ownedCopy == nil {
              // Only reached AFTER both CI-origin requests. makeImage retains an owned bitmap; no escaping pointers.
              let bitmap = try XCTUnwrap(CGContext(data: nil, width: warm.width, height: warm.height, bitsPerComponent: 8,
                bytesPerRow: warm.width * 4, space: PhotoEffectsEngine.sRGB,
                bitmapInfo: CGBitmapInfo.byteOrder32Big.rawValue | CGImageAlphaInfo.premultipliedLast.rawValue))
              bitmap.draw(warm, in: CGRect(x: 0, y: 0, width: CGFloat(warm.width), height: CGFloat(warm.height)))
              let copy = try XCTUnwrap(bitmap.makeImage())
              let deferredPixels = try self.pixels(warm), copyPixels = try self.pixels(copy)
              let equal = deferredPixels == copyPixels
              XCTAssertTrue(equal, "Owned RGBA copy must preserve every pixel before its Vision requests; CI=" + self.sha(Data(deferredPixels)) + "; copy=" + self.sha(Data(copyPixels)))
              // Preserve the measured report even if this asserted control identity fails; hashes expose the confound.
              ownedCopy = copy
            }
            cg = try XCTUnwrap(ownedCopy)
          } else { cg = warm }
          let request = VNDetectFaceLandmarksRequest(); request.revision = 3
          if forceCPU { request.usesCPUOnly = true }
          // Default cells leave the property untouched. false permits platform choice; it does NOT prove GPU/ANE use.
          let observedCPUOnly = request.usesCPUOnly
          var handler: VNImageRequestHandler? = VNImageRequestHandler(cgImage: cg, orientation: .up, options: [:])
          weak var weakHandler = handler
          func representation() -> [String: Any] {
            let isSRGB = (cg.colorSpace?.name).map { ($0 as String) == (CGColorSpace.sRGB as String) } ?? false
            return ["bpc": cg.bitsPerComponent, "bpp": cg.bitsPerPixel, "rowBytes": cg.bytesPerRow,
              "bitmapInfo": Int(cg.bitmapInfo.rawValue), "isSRGB": isSRGB]
          }
          do { try XCTUnwrap(handler).perform([request]) }
          catch {
            let nativeError = error as NSError
            let safeCode: Any
            if let exact = Int32(exactly: nativeError.code) { safeCode = Int(exact) } else { safeCode = NSNull() }
            let safeError: [String: Any] = ["domain": nativeError.domain == VNErrorDomain ? "vision" : "other", "code": safeCode]
            handler = nil
            reports.append(["variant": name, "width": cg.width, "height": cg.height,
              "handlerReleased": weakHandler == nil, "cpuOnly": observedCPUOnly, "materialized": materialized,
              "pixelSha256": self.sha(Data(try self.pixels(cg))), "representation": representation(),
              "status": "failure", "error": safeError, "detected": NSNull(), "landmarked": NSNull(),
              "observations": [], "pairDiagnostics": [], "allPlacements": NSNull(),
              "TEST_ONLY_confidenceOnePlacements": NSNull(), "TEST_ONLY_canonicalApplePlacements": NSNull()])
            continue
          }
          let observations = request.results ?? []
          guard observations.count <= 8 else { throw PhotoTreatmentEngine.Failure.resourceLimit }
          func workerReads(_ region: VNFaceLandmarkRegion2D) -> [CGPoint] {
            guard region.pointCount > 0, region.pointCount <= 128 else { return [] }
            return (0..<region.pointCount).map { let point = region.normalizedPoints[$0]; return CGPoint(x: point.x, y: point.y) }
          }
          func delta(_ baseline: [CGPoint], _ current: [CGPoint]) -> Double? {
            guard !baseline.isEmpty, baseline.count == current.count else { return nil }
            let values = zip(baseline,current).map { max(abs(Double($0.0.x - $0.1.x)),abs(Double($0.0.y - $0.1.y))) }
            guard values.allSatisfy(\.isFinite) else { return nil }; return values.max()
          }
          func maximumAvailable(_ values: [Double?]) -> Double? {
            guard !values.isEmpty, values.allSatisfy({ $0 != nil }) else { return nil }
            return values.compactMap { $0 }.max()
          }
          // All owners and independent value copies are captured while the SAME handler is alive.
          let retained = withExtendedLifetime(handler) { observations.map { observation -> (landmarks: VNFaceLandmarks2D?, left: VNFaceLandmarkRegion2D?, right: VNFaceLandmarkRegion2D?, leftSnapshot: [CGPoint], rightSnapshot: [CGPoint], before: Double?) in
            let landmarks = observation.landmarks, left = landmarks?.leftEye, right = landmarks?.rightEye
            func snapshot(_ region: VNFaceLandmarkRegion2D?) -> [CGPoint] {
              guard let region, region.pointCount > 0, region.pointCount <= 128 else { return [] }
              let whole = region.normalizedPoints
              return whole.map { CGPoint(x: $0.x, y: $0.y) }
            }
            let ls = snapshot(left), rs = snapshot(right)
            let before = maximumAvailable([left.flatMap { delta(ls, workerReads($0)) }, right.flatMap { delta(rs, workerReads($0)) }])
            return (landmarks,left,right,ls,rs,before)
          } }
          handler = nil
          let handlerReleased = weakHandler == nil
          var anchors = [FaceAnchors](), obstructions = [UnitRect](), rows = [[String: Any]]()
          var canonicalAnchors = [FaceAnchors](), canonicalObstructions = [UnitRect]()
          func rectangle(_ value: UnitRect) -> [Double] { [value.x,value.y,value.width,value.height] }
          func encode(_ value: AccessoryPlacement) -> [String: Any] {
            ["centerTopLeft": [value.center.x,value.center.y], "width": value.width, "height": value.height,
             "rotationRadians": value.rotation, "excludedBoundsTopLeft": value.excludedFaceBounds.map(rectangle)]
          }
          let size = ImageSize(width: Double(cg.width), height: Double(cg.height))
          func styles(_ faces: [FaceAnchors], _ blocks: [UnitRect]) -> [String: Any] {
            var outputs = [String: Any]()
            for accessory in [FaceAccessory.glasses,.crown,.hearts] {
              outputs[accessory.rawValue] = FaceGeometry.placements(faces: faces, image: size, accessory: accessory, obstructingBounds: blocks).map(encode)
            }; return outputs
          }
          for (index, observation) in observations.enumerated() {
            let b = observation.boundingBox
            let bounds = UnitRect(x: Double(b.minX), y: Double(b.minY), width: Double(b.width), height: Double(b.height))
            let top = UnitRect(x: bounds.x, y: 1 - bounds.y - bounds.height, width: bounds.width, height: bounds.height)
            let owner = retained[index]
            let landmarkConfidence: Any
            if let confidence = owner.landmarks.map({ Double($0.confidence) }), confidence.isFinite, (0...1).contains(confidence) {
              landmarkConfidence = confidence
            } else { landmarkConfidence = NSNull() }
            var row: [String: Any] = ["anonymousObservationIndex": index, "visionBoundsBottomLeft": rectangle(bounds),
              "confidence": Double(observation.confidence),
              "landmarkConfidence": landmarkConfidence,
              "normalizedRepeatDelta": NSNull()]

            func points(_ region: VNFaceLandmarkRegion2D) -> [UnitPoint] {
              guard region.pointCount <= 128 else { return [] }
              return (0..<region.pointCount).map { UnitPoint(x: Double(region.normalizedPoints[$0].x), y: Double(region.normalizedPoints[$0].y)) }
            }
            row["boundsTopLeft"] = rectangle(top)
            if let left = owner.left, let right = owner.right,
              left.pointCount > 0, right.pointCount > 0, left.pointCount <= 128, right.pointCount <= 128 {
              let leftLocal = points(left), rightLocal = points(right)
              let after = maximumAvailable([delta(owner.leftSnapshot, workerReads(left)), delta(owner.rightSnapshot, workerReads(right)),
                delta(owner.leftSnapshot, leftLocal.map { CGPoint(x: CGFloat($0.x), y: CGFloat($0.y)) }),
                delta(owner.rightSnapshot, rightLocal.map { CGPoint(x: CGFloat($0.x), y: CGFloat($0.y)) }),
                delta(owner.leftSnapshot, left.normalizedPoints), delta(owner.rightSnapshot, right.normalizedPoints)])
              let repeatDelta = maximumAvailable([owner.before,after])
              row["normalizedRepeatDelta"] = repeatDelta.map { $0 as Any } ?? NSNull()
              row["normalizedRepeatBeforeReleaseDelta"] = owner.before.map { $0 as Any } ?? NSNull()
              row["normalizedRepeatAfterReleaseDelta"] = after.map { $0 as Any } ?? NSNull()
              // Public Apple conversion: ObjC header verified, current Swift overlay verified by review;
              // the actual selected iOS SDK compile remains the runtime-candidate verification gate.
              func appleMean(_ region: VNFaceLandmarkRegion2D) throws -> [Double] {
                let converted = region.pointsInImage(imageSize: CGSize(width: CGFloat(cg.width), height: CGFloat(cg.height)))
                guard converted.count == region.pointCount else { throw PhotoTreatmentEngine.Failure.invalidInput }
                var x = 0.0, y = 0.0
                for i in 0..<region.pointCount { x += Double(converted[i].x); y += Double(converted[i].y) }
                return [x / Double(region.pointCount), y / Double(region.pointCount)]
              }
              func directMean(_ points: [UnitPoint]) -> [Double] {
                [points.reduce(0) { $0 + $1.x } / Double(points.count) * size.width,
                 points.reduce(0) { $0 + $1.y } / Double(points.count) * size.height]
              }
              let apple = [try appleMean(left), try appleMean(right)]
              let direct = [directMean(leftLocal), directMean(rightLocal)]
              let appleTop = apple.map { [$0[0] / size.width, 1 - $0[1] / size.height] }
              row["appleEyeMeansImagePixels"] = apple; row["appleEyeMeansTopLeft"] = appleTop
              row["directNormalizedEyeMeansImagePixels"] = direct
              row["directAppleMaximumDelta"] = zip(direct, apple).map {
                max(abs($0.0[0] - $0.1[0]) / size.width, abs($0.0[1] - $0.1[1]) / size.height)
              }.max() ?? 0
              let canonical = FaceAnchors(bounds: top, leftEye: UnitPoint(x: appleTop[0][0], y: appleTop[0][1]),
                rightEye: UnitPoint(x: appleTop[1][0], y: appleTop[1][1]), confidence: Double(observation.confidence))
              if top.valid && canonical.leftEye.valid && canonical.rightEye.valid { canonicalAnchors.append(canonical) }
              else if top.valid { canonicalObstructions.append(top) }
              if let face = FaceGeometry.fromVision(bounds: bounds, leftEye: leftLocal, rightEye: rightLocal, confidence: Double(observation.confidence)) {
                row["leftEyeTopLeft"] = [face.leftEye.x,face.leftEye.y]; row["rightEyeTopLeft"] = [face.rightEye.x,face.rightEye.y]
                let manual = [[face.leftEye.x * size.width, (1 - face.leftEye.y) * size.height],
                  [face.rightEye.x * size.width, (1 - face.rightEye.y) * size.height]]
                row["manualBBoxEyeMeansImagePixels"] = manual
                row["appleManualMaximumDelta"] = zip(manual, apple).map {
                  max(abs($0.0[0] - $0.1[0]) / size.width, abs($0.0[1] - $0.1[1]) / size.height)
                }.max() ?? 0
                let first = face.leftEye.x <= face.rightEye.x ? face.leftEye : face.rightEye
                let second = face.leftEye.x <= face.rightEye.x ? face.rightEye : face.leftEye
                let dx = (second.x - first.x) * size.width, dy = (second.y - first.y) * size.height
                let distance = hypot(dx,dy), roll = atan2(dy,dx)
                row["interocularPixels"] = distance; row["sortedEyeRollRadians"] = roll
                row["confidenceAtLeast0.8"] = face.confidence >= 0.8
                row["commonAdmissionConditions"] = ["confidenceAtLeast0.5": face.confidence >= 0.5,
                  "faceWidthAtLeast0.035": face.bounds.width >= 0.035,
                  "bothEyesInsideFace": face.bounds.contains(first) && face.bounds.contains(second),
                  "eyeDistanceAtLeastMinimum": distance >= max(4, size.width * 0.008),
                  "eyeDistanceWithinFaceWidth": distance <= face.bounds.width * size.width * 0.9,
                  "rollWithinPiOver3": abs(roll) <= .pi / 3]
                row["individualNoNeighborPlacements"] = styles([face], [])
                anchors.append(face)
              } else if top.valid { obstructions.append(top) }
            } else if top.valid { obstructions.append(top); canonicalObstructions.append(top) }
            rows.append(row)
          }
          var pairs = [[String: Any]]()
          if anchors.count >= 2 {
            for i in 0..<(anchors.count - 1) { for j in (i + 1)..<anchors.count {
              pairs.append(["anonymousAnchorIndices": [i,j], "placementsWithRawObstructions": styles([anchors[i],anchors[j]], obstructions)])
            } }
          }
          let confidenceOne = anchors.map { FaceAnchors(bounds: $0.bounds, leftEye: $0.leftEye, rightEye: $0.rightEye, confidence: 1) }
          reports.append(["variant": name, "width": cg.width, "height": cg.height, "handlerReleased": handlerReleased,
            "cpuOnly": observedCPUOnly, "materialized": materialized, "status": "success", "error": NSNull(),
            "representation": representation(), "pixelSha256": self.sha(Data(try self.pixels(cg))), "detected": observations.count, "landmarked": anchors.count,
            "observations": rows, "rawObstructionsTopLeft": obstructions.map(rectangle), "pairDiagnostics": pairs,
            "allPlacements": styles(anchors, obstructions),
            "TEST_ONLY_canonicalApplePlacements": styles(canonicalAnchors, canonicalObstructions),
            "TEST_ONLY_confidenceOnePlacements": styles(confidenceOne, obstructions)])
          withExtendedLifetime((request,retained)) {} // Request/observations/regions outlive every after-release getter.
        }
        let postRequestHashes = reports.compactMap { $0["pixelSha256"] as? String }
        XCTAssertEqual(postRequestHashes.count, 4)
        XCTAssertEqual(Set(postRequestHashes).count, 1, "All four post-inference canonical pixel hashes must match: " + postRequestHashes.joined(separator: ","))
        let report: [String: Any] = ["scope": "TEST_ONLY_SHA_PINNED_GENERATED_FIXTURE_NOT_GUEST_DATA",
          "fixturePngSha256": self.sha(png), "rootJpegSha256": self.sha(try Data(contentsOf: source)), "visionRevision": 3,
          "requestOrientation": "up", "backendPolicies": ["forced-cpu", "unmodified-default"], "recipeVersion": FaceGeometry.recipeVersion,
          "productionWarmGlassesReceipt": ["detected": receipt.detectedFaceCount ?? -1, "landmarked": receipt.landmarkedFaceCount ?? -1,
            "decorated": receipt.decoratedFaceCount, "fallbackReason": receipt.fallbackReason],
          "independentRepeatsMayVary": true, "variants": reports]
        let bytes = try JSONSerialization.data(withJSONObject: report, options: [.sortedKeys])
        guard bytes.count <= 96 * 1024 else { throw PhotoTreatmentEngine.Failure.resourceLimit }; return bytes
      } }; done.fulfill()
    }
    wait(for: [done], timeout: 120)
    let bytes = try XCTUnwrap(result).get()
    try printSyntheticPlacementSummary(bytes)
    // The CI logger bounds each line to 16k characters. Only fixed ASCII keys,
    // synthetic-fixture labels and JSON numbers are admitted; preserve every byte.
    guard bytes.allSatisfy({ $0 < 128 }) else { throw PhotoTreatmentEngine.Failure.invalidInput }
    let chunkSize = 6000, total = (bytes.count + chunkSize - 1) / chunkSize
    for start in stride(from: 0, to: bytes.count, by: chunkSize) {
      let part = bytes.subdata(in: start..<min(start + chunkSize, bytes.count))
      print("SYNTHETIC_FACE_PLACEMENT_JSON_CHUNK \(start / chunkSize + 1)/\(total) " + String(decoding: part, as: UTF8.self))
    }
    let attachment = XCTAttachment(data: bytes, uniformTypeIdentifier: UTType.json.identifier)
    attachment.name = "synthetic-face-placement-diagnostic"; attachment.lifetime = .keepAlways; add(attachment)
  }

  /// Fixed compact summary for ordinary CI logs; full synthetic report stays attached/chunked separately.
  private func printSyntheticPlacementSummary(_ bytes: Data) throws {
    let report = try XCTUnwrap(JSONSerialization.jsonObject(with: bytes) as? [String: Any])
    guard report["fixturePngSha256"] as? String == "c6b6c5015df9b172731f021dde939300ebec6bf624818d63c4bda4a1854a3165",
      let variants = report["variants"] as? [[String: Any]], variants.count == 4 else { throw PhotoTreatmentEngine.Failure.invalidInput }
    func rounded(_ value: Any, digits: Double = 100000) -> Any {
      if let array = value as? [Any] { return array.map { rounded($0, digits: digits) } }
      if let number = value as? Double { return (number * digits).rounded() / digits }
      return NSNull()
    }
    func counts(_ value: Any?) -> [String: Int] {
      let styles = value as? [String: Any] ?? [:]
      return ["g": (styles["glasses"] as? [Any])?.count ?? 0,
        "c": (styles["crown"] as? [Any])?.count ?? 0, "h": (styles["hearts"] as? [Any])?.count ?? 0]
    }
    let bitNames = ["confidenceAtLeast0.5", "faceWidthAtLeast0.035", "bothEyesInsideFace", "eyeDistanceAtLeastMinimum", "eyeDistanceWithinFaceWidth", "rollWithinPiOver3"]
    var summaries = [[String: Any]]()
    for variant in variants {
      let failed = variant["status"] as? String == "failure"
      let rows = variant["observations"] as? [[String: Any]] ?? []
      guard rows.count <= 8 else { throw PhotoTreatmentEngine.Failure.resourceLimit }
      var faces = [[String: Any]]()
      for row in rows {
        let conditions = row["commonAdmissionConditions"] as? [String: Bool] ?? [:]
        let bits = bitNames.enumerated().reduce(0) { $0 | (conditions[$1.element] == true ? 1 << $1.offset : 0) }
        let face: [String: Any] = ["i": row["anonymousObservationIndex"] ?? -1,
          "b": rounded(row["boundsTopLeft"] ?? NSNull()),
          "e": [rounded(row["leftEyeTopLeft"] ?? NSNull()), rounded(row["rightEyeTopLeft"] ?? NSNull())],
          "c": rounded(row["confidence"] ?? 0, digits: 1000), "admissionBits": bits,
          "landmarkConfidence": rounded(row["landmarkConfidence"] ?? NSNull(), digits: 100000),
          "normalizedRepeatDelta": rounded(row["normalizedRepeatDelta"] ?? NSNull(), digits: 10000000),
          "appleE": rounded(row["appleEyeMeansTopLeft"] ?? NSNull()),
          "appleDeltaMax": rounded(row["appleManualMaximumDelta"] ?? NSNull(), digits: 10000000),
          "directDeltaMax": rounded(row["directAppleMaximumDelta"] ?? NSNull(), digits: 10000000)]
        faces.append(face)
      }
      summaries.append(["name": variant["variant"] ?? "unknown", "w": variant["width"] ?? 0, "h": variant["height"] ?? 0,
        "handlerReleased": variant["handlerReleased"] ?? false,
        "cpuOnly": variant["cpuOnly"] ?? NSNull(), "materialized": variant["materialized"] ?? NSNull(),
        "pixelSha256": String((variant["pixelSha256"] as? String ?? "").prefix(12)),
        "representation": variant["representation"] ?? NSNull(), "status": variant["status"] ?? "failure", "error": variant["error"] ?? NSNull(),
        "detected": variant["detected"] ?? NSNull(), "landmarked": variant["landmarked"] ?? NSNull(), "faces": faces,
        "individual": rows.map { counts($0["individualNoNeighborPlacements"]) },
        "full": failed ? (NSNull() as Any) : (counts(variant["allPlacements"]) as Any),
        "confidence1": failed ? (NSNull() as Any) : (counts(variant["TEST_ONLY_confidenceOnePlacements"]) as Any),
        "canonicalFull": failed ? (NSNull() as Any) : (counts(variant["TEST_ONLY_canonicalApplePlacements"]) as Any)])
    }
    let summary: [String: Any] = ["scope": "TEST_ONLY_SHA_PINNED_GENERATED_FIXTURE_NOT_GUEST_DATA", "fixtureSHA": report["fixturePngSha256"]!, "variants": summaries]
    let compact = try JSONSerialization.data(withJSONObject: summary, options: [.sortedKeys])
    guard compact.count <= 6000 else { throw PhotoTreatmentEngine.Failure.resourceLimit }
    // admissionBits bit0..5 follow bitNames above; no missing bit means the common guard passed.
    print("SYNTHETIC_FACE_PLACEMENT_SUMMARY " + String(decoding: compact, as: UTF8.self))
  }

}
