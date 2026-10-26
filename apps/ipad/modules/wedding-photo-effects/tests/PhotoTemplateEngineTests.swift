import XCTest
import Foundation
import CoreImage
import ImageIO
import UniformTypeIdentifiers
import CryptoKit

/// Compile with both pure engines; generated fixtures contain no external art.
final class PhotoTemplateEngineTests: XCTestCase {
  var directory: URL!
  var engine: PhotoTemplateEngine!
  let colors: [[UInt8]] = [[215,40,35], [35,175,55], [40,65,215], [185,40,180]]
  override func setUpWithError() throws {
    directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    engine = PhotoTemplateEngine(cacheDirectory: directory.appendingPathComponent("templates"))
  }
  override func tearDownWithError() throws { try FileManager.default.removeItem(at: directory) }
  func fixtures(orientation: Int = 1, wide: Bool = false, split: Bool = false) throws -> [PhotoTemplateEngine.Source] {
    try (0..<4).map { index in
      let width = wide ? 800 : 400, height = 300
      var pixels = [UInt8](repeating: 255, count: width * height * 4)
      for y in 0..<height { for x in 0..<width {
        let rgb = y < 8 ? [UInt8(245),240,20] : y >= height - 8 ? [UInt8(20),235,235]
          : x < 8 ? [UInt8(250),250,250] : x >= width - 8 ? [UInt8(15),15,15]
          : split ? (x < width / 2 ? [UInt8(215),40,35] : [UInt8(40),65,215]) : colors[index]
        let offset = (y * width + x) * 4
        for channel in 0..<3 { pixels[offset + channel] = rgb[channel] }
      } }
      let cg = CGImage(width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: width * 4,
        space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.noneSkipLast.rawValue),
        provider: CGDataProvider(data: Data(pixels) as CFData)!, decode: nil, shouldInterpolate: false, intent: .defaultIntent)!
      let id = "photo-\(index)", url = directory.appendingPathComponent("photo-\(index).jpg")
      let output = CGImageDestinationCreateWithURL(url as CFURL, UTType.jpeg.identifier as CFString, 1, nil)!
      CGImageDestinationAddImage(output, cg, [kCGImageDestinationLossyCompressionQuality: 1,
        kCGImagePropertyOrientation: orientation, kCGImagePropertyGPSDictionary: [kCGImagePropertyGPSLatitude: 42.5]] as CFDictionary)
      XCTAssertTrue(CGImageDestinationFinalize(output))
      return PhotoTemplateEngine.Source(photoId: id, url: url)
    }
  }
  func recipe(layout: String = "strip", theme: String = "classic", mode: String = "fit", x: Double = 0,
    y: Double = 0, zoom: Double = 1) throws -> String {
    let ids = (0..<4).map { "photo-\($0)" }
    let crops = Dictionary(uniqueKeysWithValues: ids.map { ($0, ["mode": mode, "x": x, "y": y, "zoom": zoom] as [String: Any]) })
    let object: [String: Any] = ["version": PhotoTemplateEngine.version, "layout": layout, "theme": theme,
      "photoIds": ids, "cropsByPhotoId": crops]
    return String(data: try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]), encoding: .utf8)!
  }
  func render(_ sources: [PhotoTemplateEngine.Source], recipe: String, preview: Bool = false, id: UUID = UUID()) throws -> PhotoTemplateEngine.Result {
    try engine.render(sources: sources, recipeJSON: recipe, preview: preview, id: id)
  }
  func image(_ uri: String) throws -> CGImage {
    let source = try XCTUnwrap(CGImageSourceCreateWithURL(URL(string: uri)! as CFURL, nil))
    return try XCTUnwrap(CGImageSourceCreateImageAtIndex(source, 0, nil))
  }
  func sample(_ image: CGImage, x: Int, y: Int) throws -> [UInt8] {
    let pixel = try XCTUnwrap(image.cropping(to: CGRect(x: CGFloat(x), y: CGFloat(y), width: 1, height: 1)))
    var bytes = [UInt8](repeating: 0, count: 4)
    bytes.withUnsafeMutableBytes {
      let context = CGContext(data: $0.baseAddress!, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4,
        space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
      context.draw(pixel, in: CGRect(x: 0, y: 0, width: 1, height: 1))
    }; return Array(bytes.prefix(3))
  }
  func near(_ actual: [UInt8], _ expected: [UInt8], tolerance: Int = 14, file: StaticString = #filePath, line: UInt = #line) {
    for i in 0..<3 { XCTAssertLessThanOrEqual(abs(Int(actual[i]) - Int(expected[i])), tolerance, file: file, line: line) }
  }
  func testAllSixCombinationsKeepFourDistinctPhotosInOrderAndPreserveOriginalHashes() throws {
    let sources = try fixtures(), originalBytes = try sources.map { try Data(contentsOf: $0.url) }
    for layout in ["strip", "grid"] { for theme in ["classic", "botanical", "coastal"] {
      let result = try render(sources, recipe: recipe(layout: layout, theme: theme))
      XCTAssertEqual(result.width, layout == "strip" ? 1200 : 2400)
      XCTAssertEqual(result.height, layout == "strip" ? 3600 : 2100)
      let output = try image(result.uri)
      for index in 0..<4 {
        let window = PhotoTemplateEngine.window(layout: layout, index: index)
        near(try sample(output, x: Int(window.midX), y: Int(window.midY)), colors[index])
        // Four edge markers survive default fit; no implicit people/edge crop.
        near(try sample(output, x: Int(window.midX), y: Int(window.minY + 10)), [245,240,20], tolerance: 22)
        near(try sample(output, x: Int(window.midX), y: Int(window.maxY - 10)), [20,235,235], tolerance: 22)
        near(try sample(output, x: Int(window.minX + 10), y: Int(window.midY)), [250,250,250], tolerance: 22)
        near(try sample(output, x: Int(window.maxX - 10), y: Int(window.midY)), [15,15,15], tolerance: 22)
        XCTAssertEqual(result.sourceHashes[sources[index].photoId], SHA256.hash(data: originalBytes[index]).map { String(format: "%02x", $0) }.joined())
      }
      let input = try XCTUnwrap(CGImageSourceCreateWithURL(URL(string: result.uri)! as CFURL, nil))
      let props = try XCTUnwrap(CGImageSourceCopyPropertiesAtIndex(input, 0, nil) as? [String: Any])
      XCTAssertNil(props[kCGImagePropertyGPSDictionary as String])
      XCTAssertEqual((props[kCGImagePropertyOrientation as String] as? NSNumber)?.intValue ?? 1, 1)
    } }
    for index in 0..<4 { XCTAssertEqual(try Data(contentsOf: sources[index].url), originalBytes[index]) }
  }
  func testFitLetterboxesAndExplicitFillPanSelectsOppositeEdges() throws {
    let sources = try fixtures(wide: true, split: true)
    let fit = try image(render(sources, recipe: recipe()).uri)
    near(try sample(fit, x: 600, y: 100), [246,241,231])
    near(try sample(fit, x: 65, y: 465), [250,250,250], tolerance: 25)
    near(try sample(fit, x: 1135, y: 465), [15,15,15], tolerance: 25)
    let left = try image(render(sources, recipe: recipe(mode: "fill", x: -1)).uri)
    let right = try image(render(sources, recipe: recipe(mode: "fill", x: 1)).uri)
    near(try sample(left, x: 600, y: 465), [215,40,35])
    near(try sample(right, x: 600, y: 465), [40,65,215])
  }
  func testExifOrientationIsAppliedExactlyOnce() throws {
    let sources = try fixtures(orientation: 6)
    let output = try image(render(sources, recipe: recipe()).uri)
    // Portrait fit: source top/bottom markers become right/left after EXIF6 clockwise rotation.
    near(try sample(output, x: 895, y: 465), [245,240,20], tolerance: 25)
    near(try sample(output, x: 305, y: 465), [20,235,235], tolerance: 25)
    near(try sample(output, x: 100, y: 465), [246,241,231])
  }
  func testPreviewUsesExactSameRecipeHashesAndCanvasWithJpegTolerance() throws {
    let sources = try fixtures()
    let json = try recipe(layout: "grid", theme: "coastal", mode: "fill", x: 0.3, y: -0.2, zoom: 1.2)
    let full = try render(sources, recipe: json), preview = try render(sources, recipe: json, preview: true)
    XCTAssertEqual(full.sourceHashes, preview.sourceHashes); XCTAssertEqual(full.recipeJSON, preview.recipeJSON)
    XCTAssertEqual(preview.width, 1440); XCTAssertEqual(preview.height, 1260)
    let color = CGColorSpace(name: CGColorSpace.sRGB)!, context = CIContext()
    let fullImage = CIImage(cgImage: try image(full.uri)).applyingFilter("CILanczosScaleTransform", parameters: [kCIInputScaleKey: 0.6, kCIInputAspectRatioKey: 1])
    let previewImage = CIImage(cgImage: try image(preview.uri))
    var a = [UInt8](repeating: 0, count: 1440 * 1260 * 4), b = a
    let bounds = CGRect(x: 0, y: 0, width: 1440, height: 1260)
    a.withUnsafeMutableBytes { context.render(fullImage, toBitmap: $0.baseAddress!, rowBytes: 1440 * 4, bounds: bounds, format: .RGBA8, colorSpace: color) }
    b.withUnsafeMutableBytes { context.render(previewImage, toBitmap: $0.baseAddress!, rowBytes: 1440 * 4, bounds: bounds, format: .RGBA8, colorSpace: color) }
    let error = zip(a, b).reduce(0.0) { $0 + abs(Double($1.0) - Double($1.1)) } / Double(a.count) / 255
    XCTAssertLessThan(error, 0.035)
  }
  func testRecipeIdentityOrderAndBoundsRejectInvalidInputs() throws {
    let sources = try fixtures()
    for invalid in [try recipe(layout: "other"), try recipe(theme: "other"), try recipe(mode: "fit", x: 0.1),
      try recipe(mode: "fill", x: 1.1), try recipe(mode: "fill", zoom: 1.6)] {
      XCTAssertThrowsError(try render(sources, recipe: invalid))
    }
    let json = try recipe()
    XCTAssertThrowsError(try render(Array(sources.reversed()), recipe: json))
    XCTAssertThrowsError(try render([sources[0], sources[0], sources[2], sources[3]], recipe: json))
    XCTAssertThrowsError(try render(Array(sources.prefix(3)), recipe: json))
    XCTAssertThrowsError(try render(sources, recipe: json.replacingOccurrences(of: "wedding-template-v1", with: "old")))
    XCTAssertThrowsError(try render(sources, recipe: json.replacingOccurrences(of: "\"layout\"", with: "\"extra\"")))
  }
  func testCancellationReleaseAndRestartStayInsideTemplateCache() throws {
    let sources = try fixtures(), json = try recipe(), cancelled = UUID()
    engine.cancel(cancelled); XCTAssertThrowsError(try render(sources, recipe: json, id: cancelled))
    let done = UUID(), result = try render(sources, recipe: json, preview: true, id: done)
    for _ in 0..<5000 { engine.cancel(done); engine.cancel(UUID()) }
    let fresh = try render(sources, recipe: json, preview: true)
    try engine.release(URL(string: fresh.uri)!)
    XCTAssertThrowsError(try engine.release(sources[0].url))
    let cache = directory.appendingPathComponent("templates"), unrelated = cache.appendingPathComponent("keep.jpg")
    try Data("keep".utf8).write(to: unrelated)
    _ = PhotoTemplateEngine(cacheDirectory: cache)
    XCTAssertFalse(FileManager.default.fileExists(atPath: URL(string: result.uri)!.path))
    XCTAssertTrue(FileManager.default.fileExists(atPath: unrelated.path))
    XCTAssertTrue(FileManager.default.fileExists(atPath: sources[0].url.path))
  }
}
