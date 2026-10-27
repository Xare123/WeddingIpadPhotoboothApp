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
    for accessory in [FaceAccessory.glasses, .crown, .hearts] {
      let output = try process(image, accessory)
      XCTAssertFalse(output.unchanged)
      XCTAssertEqual(output.visionRevision, 3)
      XCTAssertGreaterThanOrEqual(output.placements.count, 1, "Actual Vision must detect a usable face; count/identity is not fixed")
      XCTAssertLessThanOrEqual(output.placements.count, FaceGeometry.maximumFaces)
      XCTAssertTrue(output.placements.allSatisfy { $0.accessory == accessory && $0.finite })
      let jpeg = try XCTUnwrap(output.jpegData), decoded = try decode(jpeg)
      XCTAssertEqual(decoded.width, 960); XCTAssertEqual(decoded.height, 1200)
      XCTAssertNotEqual(try pixels(output.image), before, "Each accessory must change actual image pixels")
      let metadata = try XCTUnwrap(CGImageSourceCreateWithData(jpeg as CFData, nil))
      let props = try XCTUnwrap(CGImageSourceCopyPropertiesAtIndex(metadata, 0, nil) as? [String: Any])
      XCTAssertNil(props[kCGImagePropertyGPSDictionary as String])
      XCTAssertEqual((props[kCGImagePropertyOrientation as String] as? NSNumber)?.intValue ?? 1, 1)
      derivatives.insert(SHA256.hash(data: jpeg).map { String(format: "%02x", $0) }.joined())
      try evidence(jpeg, accessory: accessory)
    }
    XCTAssertEqual(derivatives.count, 3, "Accessories must not all render the same pixels")
    XCTAssertEqual(SHA256.hash(data: try Data(contentsOf: url)), originalHash)
    XCTAssertEqual(try Data(contentsOf: url), source)
  }
  func testBlankImageReturnsUntouchedInputWithoutEncodingOrFakeFace() throws {
    let image = try blank()
    let output = try process(image, .glasses)
    XCTAssertTrue(output.unchanged); XCTAssertNil(output.jpegData); XCTAssertTrue(output.image === image)
    XCTAssertTrue(output.placements.isEmpty); XCTAssertEqual(output.visionRevision, 3)
  }
  func testNoneUnconditionallyBypassesDetectionAndEncoding() throws {
    let source = try Data(contentsOf: portraitURL()), image = try decode(source)
    let output = try process(image, .none)
    XCTAssertTrue(output.image === image); XCTAssertNil(output.jpegData)
    XCTAssertNil(output.visionRevision); XCTAssertTrue(output.placements.isEmpty)
    XCTAssertEqual(try Data(contentsOf: portraitURL()), source)
  }
  func testControlledAnchorsPlaceCrownAtExpectedPixelsAndKeepOuterPixels() throws {
    let image = try blank(width: 200, height: 200)
    let face = FaceAnchors(bounds: UnitRect(x: 0.2, y: 0.25, width: 0.6, height: 0.6),
      leftEye: UnitPoint(x: 0.4, y: 0.5), rightEye: UnitPoint(x: 0.6, y: 0.5), confidence: 1)
    let placements = FaceGeometry.placements(faces: [face], image: ImageSize(width: 200, height: 200), accessory: .crown)
    XCTAssertEqual(placements.count, 1)
    let done = expectation(description: "controlled geometry rendered off main")
    var rendered: Result<AppleFaceEffectsOutput, Error>?
    DispatchQueue.global(qos: .userInitiated).async {
      rendered = Result { try AppleFaceEffectsWorker.renderPlacements(uprightImage: image, placements: placements) }; done.fulfill()
    }
    wait(for: [done], timeout: 10)
    let output = try XCTUnwrap(rendered).get()
    // CGImage crop coordinates are top-left; avoid assuming bitmap-buffer row order.
    let sample = try XCTUnwrap(output.image.cropping(to: CGRect(x: 100, y: 58, width: 1, height: 1)))
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
}
#endif
