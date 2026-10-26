import XCTest
import Foundation
import CoreImage
import ImageIO
import UniformTypeIdentifiers
import CryptoKit

// Compile this file AND ios/PhotoEffectsEngine.swift into a native XCTest target.
// No Expo dependency or downloaded image assets are needed.
final class PhotoEffectsEngineTests: XCTestCase {
  var directory: URL!
  var engine: PhotoEffectsEngine!
  override func setUpWithError() throws {
    directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    engine = PhotoEffectsEngine(cacheDirectory: directory.appendingPathComponent("effects"))
  }
  override func tearDownWithError() throws { try FileManager.default.removeItem(at: directory) }
  func fixture(orientation: Int = 1, width: Int = 1600, height: Int = 1200,
    space: CGColorSpace = CGColorSpace(name: CGColorSpace.sRGB)!) throws -> URL {
    var pixels = [UInt8](repeating: 255, count: width * height * 4)
    for y in 0..<height { for x in 0..<width {
      let i = (y * width + x) * 4
      pixels[i] = UInt8(x * 255 / width)
      pixels[i + 1] = UInt8(y * 255 / height)
      pixels[i + 2] = x < width / 3 ? 220 : 40
    } }
    let provider = CGDataProvider(data: Data(pixels) as CFData)!
    let cg = CGImage(width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 32,
      bytesPerRow: width * 4, space: space,
      bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.noneSkipLast.rawValue),
      provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent)!
    let url = directory.appendingPathComponent(UUID().uuidString + ".jpg")
    let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.jpeg.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(destination, cg, [kCGImageDestinationLossyCompressionQuality: 1,
      kCGImagePropertyOrientation: orientation,
      kCGImagePropertyGPSDictionary: [kCGImagePropertyGPSLatitude: 51.5, kCGImagePropertyGPSLatitudeRef: "N"],
      kCGImagePropertyExifDictionary: [kCGImagePropertyExifUserComment: "PRIVATE SOURCE"]] as CFDictionary)
    XCTAssertTrue(CGImageDestinationFinalize(destination))
    return url
  }
  func render(_ source: URL, _ preset: String = "warm", _ intensity: Double = 0.7,
    preview: Bool = false, id: UUID = UUID()) throws -> PhotoEffectsEngine.Result {
    try engine.render(source: source, preset: preset, intensity: intensity, preview: preview, id: id)
  }
  func properties(_ uri: String) throws -> [String: Any] {
    let source = try XCTUnwrap(CGImageSourceCreateWithURL(URL(string: uri)! as CFURL, nil))
    return try XCTUnwrap(CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [String: Any])
  }
  func testOriginalHashImmutableAndZeroIsExactSource() throws {
    let source = try fixture(orientation: 6)
    let bytes = try Data(contentsOf: source)
    let expected = SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
    for preset in PhotoEffectsEngine.presets {
      let zero = try render(source, preset, 0)
      XCTAssertTrue(zero.isOriginal); XCTAssertEqual(zero.uri, source.absoluteString)
      XCTAssertEqual(zero.originalSha256, expected)
      XCTAssertEqual(zero.width, 1200); XCTAssertEqual(zero.height, 1600)
      _ = try render(source, preset, 0.8)
    }
    XCTAssertEqual(try Data(contentsOf: source), bytes)
  }
  func testEffectsRepeatDeterministicallyAndDifferFromOriginal() throws {
    let source = try fixture(width: 320, height: 240)
    let originalPreview = try render(source, "original", 1, preview: true)
    let original = try Data(contentsOf: URL(string: originalPreview.uri)!)
    var effects = [Data]()
    for preset in ["warm", "bw", "film"] {
      let first = try render(source, preset)
      let second = try render(source, preset)
      let firstBytes = try Data(contentsOf: URL(string: first.uri)!)
      XCTAssertEqual(firstBytes, try Data(contentsOf: URL(string: second.uri)!))
      XCTAssertNotEqual(firstBytes, original); effects.append(firstBytes)
    }
    XCTAssertNotEqual(effects[0], effects[1]); XCTAssertNotEqual(effects[1], effects[2])
  }
  func testAllExifOrientationsNormalizeOnceWithoutCropAndScrubMetadata() throws {
    for orientation in 1...8 {
      let source = try fixture(orientation: orientation, width: 320, height: 240)
      let result = try render(source)
      XCTAssertEqual(result.width, orientation >= 5 ? 240 : 320)
      XCTAssertEqual(result.height, orientation >= 5 ? 320 : 240)
      let props = try properties(result.uri)
      XCTAssertEqual((props[kCGImagePropertyOrientation as String] as? NSNumber)?.intValue ?? 1, 1)
      XCTAssertNil(props[kCGImagePropertyGPSDictionary as String])
      let exif = props[kCGImagePropertyExifDictionary as String] as? [String: Any]
      XCTAssertNil(exif?[kCGImagePropertyExifUserComment as String])
    }
  }
  func testPreviewAndFullUseSameRecipeWithinJpegTolerance() throws {
    let source = try fixture(orientation: 8)
    let preview = try render(source, "film", 0.65, preview: true)
    let full = try render(source, "film", 0.65)
    XCTAssertLessThanOrEqual(max(preview.width, preview.height), 1440)
    XCTAssertEqual(full.width, 1200); XCTAssertEqual(full.height, 1600)
    let color = CGColorSpace(name: CGColorSpace.sRGB)!
    let context = CIContext(options: [.workingColorSpace: color, .outputColorSpace: color])
    let small = try XCTUnwrap(CIImage(contentsOf: URL(string: preview.uri)!, options: [.colorSpace: color]))
    let big = try XCTUnwrap(CIImage(contentsOf: URL(string: full.uri)!, options: [.colorSpace: color]))
    let scaled = big.applyingFilter("CILanczosScaleTransform", parameters: [kCIInputScaleKey: 0.9, kCIInputAspectRatioKey: 1])
    let bounds = CGRect(x: 0, y: 0, width: CGFloat(preview.width), height: CGFloat(preview.height))
    var a = [UInt8](repeating: 0, count: preview.width * preview.height * 4), b = a
    a.withUnsafeMutableBytes { context.render(small, toBitmap: $0.baseAddress!, rowBytes: preview.width * 4,
      bounds: bounds, format: .RGBA8, colorSpace: color) }
    b.withUnsafeMutableBytes { context.render(scaled, toBitmap: $0.baseAddress!, rowBytes: preview.width * 4,
      bounds: bounds, format: .RGBA8, colorSpace: color) }
    let error = zip(a, b).reduce(0.0) { $0 + abs(Double($1.0) - Double($1.1)) } / Double(a.count) / 255
    XCTAssertLessThan(error, 0.035, "JPEG encoding differs, but recipe and orientation must agree")
  }
  func testBadInputsCancellationAndReleaseScope() throws {
    let source = try fixture(width: 160, height: 120)
    for amount in [-0.1, 1.1, Double.nan, Double.infinity] { XCTAssertThrowsError(try render(source, "warm", amount)) }
    XCTAssertThrowsError(try render(source, "unknown"))
    let id = UUID(); engine.cancel(id)
    XCTAssertThrowsError(try render(source, id: id))
    let corrupt = directory.appendingPathComponent("broken.jpg")
    try Data("not a jpeg".utf8).write(to: corrupt)
    XCTAssertThrowsError(try render(corrupt))
    XCTAssertThrowsError(try engine.release(source))
    let result = try render(source)
    let output = URL(string: result.uri)!
    try engine.release(output); XCTAssertFalse(FileManager.default.fileExists(atPath: output.path))
    XCTAssertTrue(FileManager.default.fileExists(atPath: source.path))
  }
  func testDisplayP3SourceConvertsIntoSrgbRatherThanReinterpretingChannels() throws {
    let source = try fixture(width: 320, height: 240, space: CGColorSpace(name: CGColorSpace.displayP3)!)
    let input = try XCTUnwrap(CGImageSourceCreateWithURL(source as CFURL, nil))
    let cg = try XCTUnwrap(CGImageSourceCreateImageAtIndex(input, 0, nil))
    XCTAssertTrue(try XCTUnwrap(cg.colorSpace).isWideGamutRGB, "Fixture must retain its P3 ICC profile")
    let result = try render(source, "original", 1, preview: true)
    let output = try XCTUnwrap(CIImage(contentsOf: URL(string: result.uri)!))
    let sRGB = CGColorSpace(name: CGColorSpace.sRGB)!
    let context = CIContext(options: [.workingColorSpace: sRGB, .outputColorSpace: sRGB])
    func pixels(_ image: CIImage) -> [UInt8] {
      var bytes = [UInt8](repeating: 0, count: 320 * 240 * 4)
      bytes.withUnsafeMutableBytes { context.render(image, toBitmap: $0.baseAddress!, rowBytes: 320 * 4,
        bounds: CGRect(x: 0, y: 0, width: 320, height: 240), format: .RGBA8, colorSpace: sRGB) }
      return bytes
    }
    let actual = pixels(output)
    let reference = pixels(CIImage(cgImage: cg))
    let incorrectlyReinterpreted = pixels(CIImage(cgImage: cg, options: [.colorSpace: sRGB]))
    func error(_ expected: [UInt8]) -> Double {
      zip(actual, expected).reduce(0.0) { $0 + abs(Double($1.0) - Double($1.1)) } / Double(actual.count) / 255
    }
    XCTAssertLessThan(error(reference), 0.015, "Allow JPEG quantization after color-managed sRGB conversion")
    XCTAssertLessThan(error(reference), error(incorrectlyReinterpreted) * 0.7,
      "Output must honor P3 profile, not label P3 channel values as sRGB")
  }
  func testLateAndUnknownCancellationNeverPermanentlyDisableEngine() throws {
    let source = try fixture(width: 64, height: 48)
    let completed = UUID()
    _ = try render(source, "original", 0, id: completed)
    for _ in 0..<5000 { engine.cancel(completed) }
    for _ in 0..<5000 { engine.cancel(UUID()) }
    XCTAssertTrue(try render(source, "original", 0).isOriginal)
    let pending = UUID(); engine.cancel(pending)
    XCTAssertThrowsError(try render(source, "original", 0, id: pending))
    XCTAssertFalse(try render(source).isOriginal)
  }
  func testFreshEngineSweepsOnlyOwnOrphanNames() throws {
    let source = try fixture(width: 64, height: 48)
    let original = try Data(contentsOf: source)
    let result = try render(source)
    let cache = directory.appendingPathComponent("effects")
    let temporary = cache.appendingPathComponent(UUID().uuidString + ".tmp")
    let unrelated = cache.appendingPathComponent("unrelated.jpg")
    try Data("orphan".utf8).write(to: temporary)
    try Data("keep".utf8).write(to: unrelated)
    let restarted = PhotoEffectsEngine(cacheDirectory: cache)
    XCTAssertFalse(FileManager.default.fileExists(atPath: URL(string: result.uri)!.path))
    XCTAssertFalse(FileManager.default.fileExists(atPath: temporary.path))
    XCTAssertTrue(FileManager.default.fileExists(atPath: unrelated.path))
    XCTAssertEqual(try Data(contentsOf: source), original)
    XCTAssertFalse(try restarted.render(source: source, preset: "warm", intensity: 0.5,
      preview: false, id: UUID()).isOriginal)
  }

}
