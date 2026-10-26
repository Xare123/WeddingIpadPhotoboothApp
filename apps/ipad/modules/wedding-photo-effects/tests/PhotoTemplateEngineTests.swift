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
  /// Rotate the stored raster counterclockwise; EXIF6 must undo this, not rotate upright people sideways.
  func counterclockwiseRaster(_ image: CGImage) throws -> CGImage {
    let width = image.width, height = image.height
    var pixels = [UInt8](repeating: 255, count: width * height * 4)
    try pixels.withUnsafeMutableBytes { bytes in
      let context = try XCTUnwrap(CGContext(data: bytes.baseAddress!, width: width, height: height,
        bitsPerComponent: 8, bytesPerRow: width * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
      context.draw(image, in: CGRect(x: 0, y: 0, width: CGFloat(width), height: CGFloat(height)))
    }
    var rotated = [UInt8](repeating: 255, count: pixels.count)
    for y in 0..<height { for x in 0..<width {
      let source = (y * width + x) * 4, target = ((width - 1 - x) * height + y) * 4
      for channel in 0..<4 { rotated[target + channel] = pixels[source + channel] }
    } }
    return try XCTUnwrap(CGImage(width: height, height: width, bitsPerComponent: 8, bitsPerPixel: 32,
      bytesPerRow: height * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
      bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
      provider: CGDataProvider(data: Data(rotated) as CFData)!, decode: nil, shouldInterpolate: false, intent: .defaultIntent))
  }
  /// Independent upright source samples, not production orientation code or width-only checks.
  func assertUprightContent(_ actual: CGImage, source: CGImage, content: CGRect) throws {
    var error = 0.0, channels = 0
    for y in [0.15, 0.35, 0.55, 0.75] { for x in [0.2, 0.4, 0.6, 0.8] {
      let expected = try sample(source, x: Int(Double(source.width) * x), y: Int(Double(source.height) * y))
      let observed = try sample(actual, x: Int(content.minX + content.width * CGFloat(x)), y: Int(content.minY + content.height * CGFloat(y)))
      for channel in 0..<3 { error += abs(Double(observed[channel]) - Double(expected[channel])); channels += 1 }
    } }
    // JPEG re-encoding and subpixel fit/preview resampling may differ; orientation must not.
    XCTAssertLessThan(error / Double(channels) / 255, 0.065, "Rendered content must match the upright original")
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
    // Expected displayed [top, right, bottom, left] edges for all eight EXIF transforms.
    // Raw edges: yellow, black, cyan, white. The table is independent of Core Image.
    let edgeColors: [[UInt8]] = [[245,240,20], [15,15,15], [20,235,235], [250,250,250]]
    let mappings = [[0,1,2,3], [0,3,2,1], [2,3,0,1], [2,1,0,3],
      [3,2,1,0], [3,0,1,2], [1,0,3,2], [1,2,3,0]]
    for orientation in 1...8 {
      let inputs = try fixtures(orientation: orientation), bytes = try inputs.map { try Data(contentsOf: $0.url) }
      let rendered = try image(render(inputs, recipe: recipe()).uri)
      let window = PhotoTemplateEngine.window(layout: "strip", index: 0)
      let size = orientation >= 5 ? CGSize(width: 300, height: 400) : CGSize(width: 400, height: 300)
      let factor = min(window.width / size.width, window.height / size.height)
      let content = CGRect(x: window.midX - size.width * factor / 2, y: window.midY - size.height * factor / 2,
        width: size.width * factor, height: size.height * factor)
      let points = [CGPoint(x: content.midX, y: content.minY + 10), CGPoint(x: content.maxX - 10, y: content.midY),
        CGPoint(x: content.midX, y: content.maxY - 10), CGPoint(x: content.minX + 10, y: content.midY)]
      for edge in 0..<4 { near(try sample(rendered, x: Int(points[edge].x), y: Int(points[edge].y)),
        edgeColors[mappings[orientation - 1][edge]], tolerance: 25) }
      for index in 0..<4 { XCTAssertEqual(try Data(contentsOf: inputs[index].url), bytes[index]) }
    }
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

    // Missing cache leaves, directory URL flags, and symlinked ancestors must all
    // permit our rendered JPEG while keeping release inside the canonical root.
    let originalBytes = try sources.map { try Data(contentsOf: $0.url) }
    for directoryFlag in [false, true] { for aliasedParent in [false, true] {
      let parent = directory.appendingPathComponent("release-\(directoryFlag)-\(aliasedParent)", isDirectory: true)
      try FileManager.default.createDirectory(at: parent, withIntermediateDirectories: true)
      let alias = directory.appendingPathComponent("alias-\(directoryFlag)-\(aliasedParent)", isDirectory: true)
      if aliasedParent { try FileManager.default.createSymbolicLink(at: alias, withDestinationURL: parent) }
      let requested = URL(fileURLWithPath: (aliasedParent ? alias : parent).appendingPathComponent("cache").path,
        isDirectory: directoryFlag)
      XCTAssertFalse(FileManager.default.fileExists(atPath: requested.path))
      let isolated = PhotoTemplateEngine(cacheDirectory: requested)
      XCTAssertTrue(FileManager.default.fileExists(atPath: requested.path))
      let rendered = try isolated.render(sources: sources, recipeJSON: json, preview: true, id: UUID())
      let renderedURL = try XCTUnwrap(URL(string: rendered.uri))
      try isolated.release(renderedURL)
      XCTAssertFalse(FileManager.default.fileExists(atPath: renderedURL.path))
      try isolated.release(renderedURL) // Releasing an already removed owned file is harmless.

      let root = requested.standardizedFileURL.resolvingSymlinksInPath()
      let owned = root.appendingPathComponent(UUID().uuidString + ".jpg")
      let sentinel = Data("must remain unchanged".utf8)
      try sentinel.write(to: owned)
      var remote = URLComponents(); remote.scheme = "https"; remote.host = "invalid.example"; remote.path = owned.path
      XCTAssertThrowsError(try isolated.release(try XCTUnwrap(remote.url)))
      XCTAssertEqual(try Data(contentsOf: owned), sentinel)
      // The same file is releasable through the requested (possibly aliased) root.
      try isolated.release(requested.appendingPathComponent(owned.lastPathComponent))
      XCTAssertFalse(FileManager.default.fileExists(atPath: owned.path))

      let sibling = parent.appendingPathComponent("cache-sibling", isDirectory: true)
      let nested = root.appendingPathComponent("nested", isDirectory: true)
      try FileManager.default.createDirectory(at: sibling, withIntermediateDirectories: true)
      try FileManager.default.createDirectory(at: nested, withIntermediateDirectories: true)
      let outside = sibling.appendingPathComponent(UUID().uuidString + ".jpg")
      let nestedFile = nested.appendingPathComponent(UUID().uuidString + ".jpg")
      let wrongExtension = root.appendingPathComponent(UUID().uuidString + ".png")
      let wrongName = root.appendingPathComponent("keep.jpg")
      for file in [outside, nestedFile, wrongExtension, wrongName] { try sentinel.write(to: file) }
      let escape = root.appendingPathComponent(UUID().uuidString + ".jpg")
      try FileManager.default.createSymbolicLink(at: escape, withDestinationURL: outside)
      for invalid in [outside, nestedFile, wrongExtension, wrongName, escape] {
        XCTAssertThrowsError(try isolated.release(invalid))
        XCTAssertEqual(try Data(contentsOf: invalid), sentinel)
      }
      // A misleading name/extension must not become valid by resolving to an owned file.
      let target = root.appendingPathComponent(UUID().uuidString + ".jpg")
      try sentinel.write(to: target)
      for name in [UUID().uuidString + ".tmp", "alias.jpg"] {
        let misleading = root.appendingPathComponent(name)
        try FileManager.default.createSymbolicLink(at: misleading, withDestinationURL: target)
        XCTAssertThrowsError(try isolated.release(misleading))
        XCTAssertEqual(try Data(contentsOf: target), sentinel)
      }
      XCTAssertEqual(try Data(contentsOf: outside), sentinel)
    } }
    for slashCount in [1, 2, 3] {
      let base = URL(fileURLWithPath: directory.appendingPathComponent("release-slashes-\(slashCount)").path, isDirectory: false)
      let requested = try XCTUnwrap(URL(string: base.absoluteString + String(repeating: "/", count: slashCount)))
      XCTAssertFalse(FileManager.default.fileExists(atPath: base.path))
      let isolated = PhotoTemplateEngine(cacheDirectory: requested)
      let rendered = try isolated.render(sources: sources, recipeJSON: json, preview: true, id: UUID())
      let roundTrip = try XCTUnwrap(URL(string: rendered.uri))
      let canonical = base.standardizedFileURL.resolvingSymlinksInPath().standardizedFileURL
      XCTAssertEqual(roundTrip.standardizedFileURL.resolvingSymlinksInPath().deletingLastPathComponent().pathComponents,
        canonical.pathComponents)
      try isolated.release(roundTrip)
      XCTAssertFalse(FileManager.default.fileExists(atPath: roundTrip.path))
      try isolated.release(roundTrip)
    }
    for index in 0..<4 { XCTAssertEqual(try Data(contentsOf: sources[index].url), originalBytes[index]) }
  }
  func recipeV2(layout: String = "strip", theme: String = "classic", aspect: String = "portrait") throws -> String {
    let v1 = try recipe(layout: layout, theme: theme)
    var object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(v1.utf8)) as? [String: Any])
    object["version"] = PhotoTemplateEngine.currentVersion; object["gridAspect"] = aspect
    return String(data: try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]), encoding: .utf8)!
  }
  private static var attachmentBytes = 0
  func attachJPEG(_ result: PhotoTemplateEngine.Result, name: String) throws {
    let data = try Data(contentsOf: XCTUnwrap(URL(string: result.uri)))
    XCTAssertLessThan(data.count, 6 * 1024 * 1024, "Keep individual native visual evidence bounded")
    Self.attachmentBytes += data.count
    XCTAssertLessThanOrEqual(Self.attachmentBytes, 32 * 1024 * 1024, "Bound total clean native JPEG attachments below xcresult cap")
    let attachment = XCTAttachment(data: data, uniformTypeIdentifier: UTType.jpeg.identifier)
    attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
  }
  func cleanSources(portraitOnly: Bool = true) throws -> [PhotoTemplateEngine.Source] {
    let names = portraitOnly ? ["portrait-1", "portrait-2", "portrait-3", "portrait-4"]
      : ["portrait-1", "landscape-1", "portrait-2", "landscape-2"]
    return try names.enumerated().map { index, name in
      let url = try XCTUnwrap(Bundle(for: PhotoTemplateEngineTests.self).url(forResource: "studio-" + name, withExtension: "jpg"),
        "Required clean generated JPEG must be copied into the native test bundle: " + name)
      return PhotoTemplateEngine.Source(photoId: "photo-\(index)", url: url)
    }
  }
  func testV2InspectionUsesUprightDimensionsMedianAndUnchangedHashes() throws {
    let landscape = try fixtures(), before = try landscape.map { try Data(contentsOf: $0.url) }
    let first = try engine.inspect(sources: landscape)
    XCTAssertEqual(first.gridAspect, "square")
    XCTAssertEqual(first.sources.map(\.photoId), landscape.map(\.photoId))
    for (index, source) in first.sources.enumerated() {
      XCTAssertEqual(source.width, 400); XCTAssertEqual(source.height, 300)
      XCTAssertEqual(source.sha256, SHA256.hash(data: before[index]).map { String(format: "%02x", $0) }.joined())
    }
    let portrait = try fixtures(orientation: 6)
    let rotated = try engine.inspect(sources: portrait)
    XCTAssertEqual(rotated.gridAspect, "portrait")
    XCTAssertEqual(rotated.sources.map(\.width), [300,300,300,300])
    XCTAssertEqual(rotated.sources.map(\.height), [400,400,400,400])
    XCTAssertEqual(try engine.inspect(sources: Array(portrait.reversed())).gridAspect, "portrait")
    XCTAssertThrowsError(try engine.inspect(sources: Array(portrait.prefix(3))))
    XCTAssertThrowsError(try engine.inspect(sources: [portrait[0],portrait[0],portrait[2],portrait[3]]))
    // Exact 0.95 threshold is square; one pixel below is portrait.
    for width in [95, 94] {
      var boundary = [PhotoTemplateEngine.Source]()
      for index in 0..<4 {
        let context = try XCTUnwrap(CGContext(data: nil, width: width, height: 100, bitsPerComponent: 8, bytesPerRow: width * 4,
          space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
        context.setFillColor(CGColor(gray: 0.5, alpha: 1)); context.fill(CGRect(x: 0, y: 0, width: CGFloat(width), height: 100))
        let cg = try XCTUnwrap(context.makeImage()), url = directory.appendingPathComponent("boundary-\(width)-\(index).jpg")
        let output = try XCTUnwrap(CGImageDestinationCreateWithURL(url as CFURL, UTType.jpeg.identifier as CFString, 1, nil))
        CGImageDestinationAddImage(output, cg, [kCGImagePropertyOrientation: 1] as CFDictionary)
        XCTAssertTrue(CGImageDestinationFinalize(output))
        boundary.append(PhotoTemplateEngine.Source(photoId: "boundary-\(index)", url: url))
      }
      XCTAssertEqual(try engine.inspect(sources: boundary).gridAspect, width == 95 ? "square" : "portrait")
    }
    let broken = directory.appendingPathComponent("broken-inspection.jpg")
    try Data("not a JPEG".utf8).write(to: broken)
    XCTAssertThrowsError(try engine.inspect(sources: [PhotoTemplateEngine.Source(photoId: "photo-0", url: broken)] + Array(portrait.dropFirst())))
  }
  func testV2StrictVersionedRecipeAndGeometryKeepV1Unchanged() throws {
    let v1 = try PhotoTemplateEngine.Recipe.parse(recipe(layout: "grid"))
    XCTAssertNil(v1.gridAspect); XCTAssertEqual(PhotoTemplateEngine.dimensions(recipe: v1).height, 2100)
    XCTAssertEqual(PhotoTemplateEngine.window(recipe: v1, index: 3), CGRect(x: 1224, y: 954, width: 1080, height: 810))
    for aspect in ["portrait", "square"] {
      let strip = try PhotoTemplateEngine.Recipe.parse(recipeV2(aspect: aspect))
      XCTAssertEqual(PhotoTemplateEngine.dimensions(recipe: strip).width, 1200)
      XCTAssertEqual(PhotoTemplateEngine.dimensions(recipe: strip).height, 3600)
      XCTAssertEqual(PhotoTemplateEngine.window(recipe: strip, index: 3), CGRect(x: 60, y: 2562, width: 1080, height: 810))
      let grid = try PhotoTemplateEngine.Recipe.parse(recipeV2(layout: "grid", aspect: aspect))
      XCTAssertEqual(PhotoTemplateEngine.dimensions(recipe: grid).height, aspect == "portrait" ? 3000 : 2400)
      let last = PhotoTemplateEngine.window(recipe: grid, index: 3)
      XCTAssertEqual(last, aspect == "portrait" ? CGRect(x: 1212, y: 1428, width: 1116, height: 1332)
        : CGRect(x: 1224, y: 1164, width: 1080, height: 1080))
    }
    XCTAssertThrowsError(try PhotoTemplateEngine.Recipe.parse(recipeV2(aspect: "landscape")))
    let extraOnV1 = try recipeV2().replacingOccurrences(of: PhotoTemplateEngine.currentVersion, with: PhotoTemplateEngine.version)
    XCTAssertThrowsError(try PhotoTemplateEngine.Recipe.parse(extraOnV1))
    let missingOnV2 = try recipe().replacingOccurrences(of: PhotoTemplateEngine.version, with: PhotoTemplateEngine.currentVersion)
    XCTAssertThrowsError(try PhotoTemplateEngine.Recipe.parse(missingOnV2))
  }
  func testV2AllSixCleanNativeJpegFullAndPreviewAttachments() throws {
    let sources = try cleanSources(), bytes = try sources.map { try Data(contentsOf: $0.url) }
    let inspection = try engine.inspect(sources: sources)
    XCTAssertEqual(inspection.gridAspect, "portrait")
    for layout in ["strip", "grid"] { for theme in ["classic", "botanical", "coastal"] {
      let json = try recipeV2(layout: layout, theme: theme, aspect: inspection.gridAspect)
      let full = try render(sources, recipe: json), preview = try render(sources, recipe: json, preview: true)
      XCTAssertEqual(full.version, PhotoTemplateEngine.currentVersion)
      XCTAssertEqual(full.width, layout == "strip" ? 1200 : 2400)
      XCTAssertEqual(full.height, layout == "strip" ? 3600 : 3000)
      XCTAssertEqual(preview.width, layout == "strip" ? 480 : 1152)
      XCTAssertEqual(preview.height, 1440)
      XCTAssertEqual(full.recipeJSON, preview.recipeJSON); XCTAssertEqual(full.sourceHashes, preview.sourceHashes)
      try attachJPEG(full, name: "native-v2-clean-portrait-\(layout)-\(theme)-FULL")
      try attachJPEG(preview, name: "native-v2-clean-portrait-\(layout)-\(theme)-PREVIEW")
      try engine.release(URL(string: full.uri)!); try engine.release(URL(string: preview.uri)!)
    } }
    for index in 0..<4 { XCTAssertEqual(try Data(contentsOf: sources[index].url), bytes[index]) }
  }
  func testV2CleanMixedAspectAndExifNativeJpegAttachments() throws {
    let mixed = try cleanSources(portraitOnly: false)
    let inspection = try engine.inspect(sources: mixed)
    XCTAssertEqual(inspection.gridAspect, "square")
    let full = try render(mixed, recipe: recipeV2(layout: "grid", theme: "coastal", aspect: inspection.gridAspect))
    let preview = try render(mixed, recipe: full.recipeJSON, preview: true)
    XCTAssertEqual(full.width, 2400); XCTAssertEqual(full.height, 2400)
    XCTAssertEqual(preview.width, 1440); XCTAssertEqual(preview.height, 1440)
    try attachJPEG(full, name: "native-v2-clean-mixed-square-grid-coastal-FULL")
    try attachJPEG(preview, name: "native-v2-clean-mixed-square-grid-coastal-PREVIEW")
    // Representative portrait shots stored with mixed EXIF orientations must still show upright people.
    let uprightSources = try cleanSources(), uprightBytes = try uprightSources.map { try Data(contentsOf: $0.url) }
    var exifSources = [PhotoTemplateEngine.Source](), uprightImages = [CGImage]()
    for (index, source) in uprightSources.enumerated() {
      let input = try XCTUnwrap(CGImageSourceCreateWithURL(source.url as CFURL, nil))
      let cg = try XCTUnwrap(CGImageSourceCreateImageAtIndex(input, 0, nil))
      uprightImages.append(cg)
      let target = directory.appendingPathComponent("clean-exif-\(index).jpg")
      let output = try XCTUnwrap(CGImageDestinationCreateWithURL(target as CFURL, UTType.jpeg.identifier as CFString, 1, nil))
      let orientation = index % 2 == 0 ? 1 : 6
      let stored = orientation == 6 ? try counterclockwiseRaster(cg) : cg
      CGImageDestinationAddImage(output, stored, [kCGImageDestinationLossyCompressionQuality: 0.95,
        kCGImagePropertyOrientation: orientation, kCGImagePropertyGPSDictionary: [kCGImagePropertyGPSLatitude: 42.5]] as CFDictionary)
      XCTAssertTrue(CGImageDestinationFinalize(output))
      let encoded = try XCTUnwrap(CGImageSourceCreateWithURL(target as CFURL, nil))
      let properties = try XCTUnwrap(CGImageSourceCopyPropertiesAtIndex(encoded, 0, nil) as? [String: Any])
      XCTAssertEqual((properties[kCGImagePropertyOrientation as String] as? NSNumber)?.intValue, orientation)
      XCTAssertEqual((properties[kCGImagePropertyPixelWidth as String] as? NSNumber)?.intValue, stored.width)
      XCTAssertEqual((properties[kCGImagePropertyPixelHeight as String] as? NSNumber)?.intValue, stored.height)
      // ImageIO's transform decoder independently checks our stored raster + metadata, not the production CI transform.
      let decoded = try XCTUnwrap(CGImageSourceCreateThumbnailAtIndex(encoded, 0, [
        kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceCreateThumbnailWithTransform: true,
        kCGImageSourceThumbnailMaxPixelSize: max(cg.width, cg.height)] as CFDictionary))
      XCTAssertEqual(decoded.width, cg.width); XCTAssertEqual(decoded.height, cg.height)
      try assertUprightContent(decoded, source: cg,
        content: CGRect(x: 0, y: 0, width: CGFloat(decoded.width), height: CGFloat(decoded.height)))
      exifSources.append(PhotoTemplateEngine.Source(photoId: source.photoId, url: target))
    }
    let exif = try engine.inspect(sources: exifSources)
    XCTAssertEqual(exif.gridAspect, "portrait")
    let result = try render(exifSources, recipe: recipeV2(layout: "grid", theme: "botanical", aspect: exif.gridAspect))
    try attachJPEG(result, name: "native-v2-clean-mixed-EXIF-portrait-grid-sage-FULL")
    let exifPreview = try render(exifSources, recipe: result.recipeJSON, preview: true)
    XCTAssertEqual(exifPreview.width, 1152); XCTAssertEqual(exifPreview.height, 1440)
    XCTAssertEqual(result.sourceHashes, exifPreview.sourceHashes)
    let fullPixels = try image(result.uri), previewPixels = try image(exifPreview.uri)
    let parsed = try PhotoTemplateEngine.Recipe.parse(result.recipeJSON)
    for index in 0..<4 {
      let source = uprightImages[index], window = PhotoTemplateEngine.window(recipe: parsed, index: index)
      let fit = min(window.width / CGFloat(source.width), window.height / CGFloat(source.height))
      let content = CGRect(x: window.midX - CGFloat(source.width) * fit / 2,
        y: window.midY - CGFloat(source.height) * fit / 2, width: CGFloat(source.width) * fit, height: CGFloat(source.height) * fit)
      try assertUprightContent(fullPixels, source: source, content: content)
      let scale = CGFloat(exifPreview.width) / CGFloat(result.width)
      try assertUprightContent(previewPixels, source: source,
        content: CGRect(x: content.minX * scale, y: content.minY * scale, width: content.width * scale, height: content.height * scale))
      XCTAssertEqual(try Data(contentsOf: uprightSources[index].url), uprightBytes[index])
    }
    try attachJPEG(exifPreview, name: "native-v2-clean-mixed-EXIF-portrait-grid-sage-PREVIEW")
    let input = try XCTUnwrap(CGImageSourceCreateWithURL(URL(string: result.uri)! as CFURL, nil))
    let props = try XCTUnwrap(CGImageSourceCopyPropertiesAtIndex(input, 0, nil) as? [String: Any])
    XCTAssertNil(props[kCGImagePropertyGPSDictionary as String])
    XCTAssertEqual((props[kCGImagePropertyOrientation as String] as? NSNumber)?.intValue ?? 1, 1)
  }
  func testV2DecorationNeverTouchesPhotoWindowsAndFitPreservesEdgeMarkers() throws {
    let sources = try fixtures()
    for layout in ["strip", "grid"] { for aspect in ["portrait", "square"] {
      var centers = [[[UInt8]]]()
      for theme in ["classic", "botanical", "coastal"] {
        let json = try recipeV2(layout: layout, theme: theme, aspect: aspect)
        let parsed = try PhotoTemplateEngine.Recipe.parse(json), result = try render(sources, recipe: json)
        let output = try image(result.uri)
        let field: [UInt8] = theme == "classic" ? [246,240,228] : theme == "botanical" ? [220,229,214] : [219,235,231]
        near(try sample(output, x: result.width / 2, y: 40), field, tolerance: 8)
        var pixels = [[UInt8]]()
        for index in 0..<4 {
          let window = PhotoTemplateEngine.window(recipe: parsed, index: index)
          let center = try sample(output, x: Int(window.midX), y: Int(window.midY))
          near(center, colors[index]); pixels.append(center)
          // A 4:3 source is width-limited in the two new grid frames: both full
          // left/right marker strips remain visible under default FIT.
          near(try sample(output, x: Int(window.minX + 10), y: Int(window.midY)), [250,250,250], tolerance: 25)
          near(try sample(output, x: Int(window.maxX - 10), y: Int(window.midY)), [15,15,15], tolerance: 25)
        }
        centers.append(pixels)
        let props = try XCTUnwrap(CGImageSourceCopyPropertiesAtIndex(CGImageSourceCreateWithURL(URL(string: result.uri)! as CFURL, nil)!, 0, nil) as? [String: Any])
        XCTAssertNil(props[kCGImagePropertyGPSDictionary as String])
        try engine.release(URL(string: result.uri)!)
      }
      for theme in centers { for (index, pixel) in theme.enumerated() { near(pixel, colors[index]) } }
    } }
    // An independent tall raster has a yellow TOP band, cyan BOTTOM band,
    // red upper body and blue lower body. Sample decoded JPEG window edges,
    // rather than reimplementing the compositor's transform in this test.
    var vertical = [PhotoTemplateEngine.Source](), originalBytes = [Data]()
    for index in 0..<4 {
      let width = 300, height = 800
      var pixels = [UInt8](repeating: 255, count: width * height * 4)
      for y in 0..<height {
        let rgb: [UInt8] = y < 12 ? [245,240,20] : y >= height - 12 ? [20,235,235]
          : y < height / 2 ? [215,40,35] : [40,65,215]
        for x in 0..<width { for channel in 0..<3 { pixels[(y * width + x) * 4 + channel] = rgb[channel] } }
      }
      let cg = try XCTUnwrap(CGImage(width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: width * 4,
        space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.noneSkipLast.rawValue),
        provider: CGDataProvider(data: Data(pixels) as CFData)!, decode: nil, shouldInterpolate: false, intent: .defaultIntent))
      let url = directory.appendingPathComponent("vertical-top-bottom-\(index).jpg")
      let destination = try XCTUnwrap(CGImageDestinationCreateWithURL(url as CFURL, UTType.jpeg.identifier as CFString, 1, nil))
      CGImageDestinationAddImage(destination, cg, [kCGImageDestinationLossyCompressionQuality: 1, kCGImagePropertyOrientation: 1] as CFDictionary)
      XCTAssertTrue(CGImageDestinationFinalize(destination))
      vertical.append(PhotoTemplateEngine.Source(photoId: "photo-\(index)", url: url))
      originalBytes.append(try Data(contentsOf: url))
    }
    for pan in [-1.0, 1.0] {
      var object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(recipeV2().utf8)) as? [String: Any])
      object["cropsByPhotoId"] = Dictionary(uniqueKeysWithValues: vertical.map { source in
        (source.photoId, ["mode": "fill", "x": 0, "y": pan, "zoom": 1] as [String: Any])
      })
      let json = String(data: try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]), encoding: .utf8)!
      let result = try render(vertical, recipe: json), output = try image(result.uri)
      // Fixed strip windows are at y60/894/1728/2562, each810 high.
      // y=-1 retains the source top; y=+1 retains its bottom.
      for (index, top) in [60,894,1728,2562].enumerated() {
        near(try sample(output, x: 600, y: top + 15), pan == -1 ? [245,240,20] : [40,65,215], tolerance: 25)
        near(try sample(output, x: 600, y: top + 795), pan == -1 ? [215,40,35] : [20,235,235], tolerance: 25)
        XCTAssertEqual(result.sourceHashes[vertical[index].photoId], SHA256.hash(data: originalBytes[index]).map { String(format: "%02x", $0) }.joined())
        XCTAssertEqual(try Data(contentsOf: vertical[index].url), originalBytes[index])
      }
      try engine.release(URL(string: result.uri)!)
    }
  }

}
