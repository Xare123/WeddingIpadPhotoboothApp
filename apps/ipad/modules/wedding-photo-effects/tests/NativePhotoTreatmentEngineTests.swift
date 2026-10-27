import XCTest
import Foundation
import CoreImage
import ImageIO
import UniformTypeIdentifiers
import CryptoKit

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
    XCTAssertEqual(sha(data), "c6b6c5015df9b172731f021dde939300ebec6bf624818d63c4bda4a1854a3165")
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
    XCTAssertEqual(try data(onlyLook), try Data(contentsOf: URL(string: legacy.uri)!))
    let treatment = try render(source, recipe("bw", 1, "crown")), output = try pixels(image(data(treatment)))
    let original = CIImage(cgImage: input)
    let looked = PhotoEffectsEngine.lookPixels(original, preset: "bw", intensity: 1)
    let lookedCG = try XCTUnwrap(PhotoEffectsEngine.context.createCGImage(looked, from: looked.extent, format: .RGBA8, colorSpace: PhotoEffectsEngine.sRGB))
    let worker = AppleFaceEffectsWorker(), done = expectation(description: "independent look-then-face reference")
    var reference: AppleFaceEffectsOutput?
    worker.process(uprightImage: lookedCG, accessory: .crown) { if case .success(let value) = $0 { reference = value }; done.fulfill() }
    wait(for: [done], timeout: 90)
    XCTAssertEqual(try data(treatment), try XCTUnwrap(reference?.jpegData), "exact final JPEG comes from the face renderer, no intermediate JPEG")
    var goldPixels = 0
    for offset in stride(from: 0, to: output.count, by: 4) {
      if Int(output[offset]) > Int(output[offset + 2]) + 50 && output[offset] > 130 { goldPixels += 1 }
    }
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

}
