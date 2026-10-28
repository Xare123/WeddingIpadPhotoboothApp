import Foundation
import CoreImage
import CoreText
import ImageIO
import UniformTypeIdentifiers
import CryptoKit

/// Versioned keepsakes: legacy vector designs and original generated frame artwork.
public final class PhotoTemplateEngine: @unchecked Sendable {
  public static let version = "wedding-template-v1"
  public static let previousVersion = "wedding-template-v2"
  public static let currentVersion = "wedding-template-v3"
  public static let supportedVersions = [version, previousVersion, currentVersion]
  public struct Source { public let photoId: String; public let url: URL
    public init(photoId: String, url: URL) { self.photoId = photoId; self.url = url } }
  public struct Crop: Codable { public let mode: String; public let x, y, zoom: Double }
  public struct Recipe: Codable {
    public let version, layout, theme: String
    public let gridAspect: String?
    public let photoIds: [String]
    public let cropsByPhotoId: [String: Crop]
    public static func parse(_ json: String) throws -> Recipe {
      guard let data = json.data(using: .utf8), data.count <= 8192,
        let raw = try JSONSerialization.jsonObject(with: data) as? [String: Any],
        let requestedVersion = raw["version"] as? String,
        PhotoTemplateEngine.supportedVersions.contains(requestedVersion),
        Set(raw.keys) == Set(["version", "layout", "theme", "photoIds", "cropsByPhotoId"] +
          (requestedVersion != PhotoTemplateEngine.version ? ["gridAspect"] : [])),
        let crops = raw["cropsByPhotoId"] as? [String: [String: Any]],
        crops.values.allSatisfy({ Set($0.keys) == Set(["mode", "x", "y", "zoom"]) }) else { throw Failure.invalidInput }
      let recipe = try JSONDecoder().decode(Recipe.self, from: data)
      guard (recipe.version == PhotoTemplateEngine.version ? recipe.gridAspect == nil :
        ["portrait", "square"].contains(recipe.gridAspect ?? "")),
        (recipe.version != PhotoTemplateEngine.currentVersion || recipe.gridAspect == "square"), ["strip", "grid"].contains(recipe.layout),
        ["classic", "botanical", "coastal"].contains(recipe.theme), recipe.photoIds.count == 4,
        Set(recipe.photoIds).count == 4, Set(crops.keys) == Set(recipe.photoIds),
        recipe.photoIds.allSatisfy({ $0.range(of: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$", options: .regularExpression) != nil })
        else { throw Failure.invalidInput }
      for crop in recipe.cropsByPhotoId.values {
        guard ["fit", "fill"].contains(crop.mode), crop.x.isFinite, crop.y.isFinite, crop.zoom.isFinite,
          (-1...1).contains(crop.x), (-1...1).contains(crop.y), (1...1.5).contains(crop.zoom),
          crop.mode != "fit" || (crop.x == 0 && crop.y == 0 && crop.zoom == 1) else { throw Failure.invalidInput }
      }
      return recipe
    }
    public var canonical: String { get throws {
      let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
      return String(data: try encoder.encode(self), encoding: .utf8)!
    } }
  }
  public struct Result {
    public let uri: String; public let width, height: Int; public let preview: Bool
    public let version: String
    public let recipeJSON: String; public let sourceHashes: [String: String]
    public var dictionary: [String: Any] { ["uri": uri, "width": width, "height": height,
      "preview": preview, "version": version, "recipeJSON": recipeJSON, "sourceHashes": sourceHashes] }
  }
  public enum Failure: Error { case invalidInput, resourceLimit, cancelled, encodingFailed }
  private let cache: URL
  private let lock = NSLock()
  private var active = Set<UUID>(), cancelled = Set<UUID>(), completed = Set<UUID>()
  private var recent = [UUID](), pending = [UUID]()
  public init(cacheDirectory: URL) {
    // Resolve existing ancestors only after creating the leaf (e.g. Darwin's /var alias).
    if cacheDirectory.isFileURL {
      try? FileManager.default.createDirectory(at: cacheDirectory, withIntermediateDirectories: true)
    }
    // An empty appended component can introduce a second slash and a trailing "/" path component on Darwin.
    cache = cacheDirectory.standardizedFileURL.resolvingSymlinksInPath().standardizedFileURL
    PhotoEffectsEngine.queue.sync {
      guard cache.isFileURL else { return }
      let files = (try? FileManager.default.contentsOfDirectory(at: cache, includingPropertiesForKeys: nil)) ?? []
      for file in files where Self.owned(file) { try? FileManager.default.removeItem(at: file) }
    }
  }
  private static func owned(_ url: URL) -> Bool {
    ["jpg", "tmp"].contains(url.pathExtension) && UUID(uuidString: url.deletingPathExtension().lastPathComponent) != nil
  }
  public func cancel(_ id: UUID) {
    lock.lock(); defer { lock.unlock() }
    if completed.contains(id) { return }
    if active.contains(id) { cancelled.insert(id); return }
    if !pending.contains(id) { pending.append(id); if pending.count > 512 { pending.removeFirst() } }
  }
  private func check(_ id: UUID) throws {
    lock.lock(); defer { lock.unlock() }; if cancelled.contains(id) { throw Failure.cancelled }
  }
  public func render(sources: [Source], recipeJSON: String, preview: Bool, id: UUID) throws -> Result {
    lock.lock()
    guard active.count < 64, !active.contains(id), !completed.contains(id) else { lock.unlock(); throw Failure.resourceLimit }
    active.insert(id)
    if let i = pending.firstIndex(of: id) { pending.remove(at: i); cancelled.insert(id) }
    lock.unlock()
    defer { lock.lock(); active.remove(id); cancelled.remove(id); completed.insert(id); recent.append(id)
      if recent.count > 512 { completed.remove(recent.removeFirst()) }; lock.unlock() }
    return try PhotoEffectsEngine.queue.sync { try autoreleasepool {
      try check(id)
      let recipe = try Recipe.parse(recipeJSON)
      guard sources.count == 4, sources.map(\.photoId) == recipe.photoIds else { throw Failure.invalidInput }
      try FileManager.default.createDirectory(at: cache, withIntermediateDirectories: true)
      let files = try FileManager.default.contentsOfDirectory(at: cache, includingPropertiesForKeys: [.fileSizeKey])
      let used = try files.reduce(0) { try $0 + ($1.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0) }
      guard files.count < 48, used < 192 * 1024 * 1024 else { throw Failure.resourceLimit }
      let dimensions = Self.dimensions(recipe: recipe), width = dimensions.width, height = dimensions.height
      guard let canvas = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
        space: PhotoEffectsEngine.sRGB, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { throw Failure.resourceLimit }
      let colors = recipe.version == Self.version ? palette(recipe.theme) : paletteV2(recipe.theme)
      canvas.setFillColor(colors.background); canvas.fill(CGRect(x: 0, y: 0, width: CGFloat(width), height: CGFloat(height)))
      if recipe.version == Self.previousVersion { decorationV2(canvas, width: width, height: height, recipe: recipe, colors: colors) }
      if recipe.version == Self.currentVersion { try artworkV3(canvas, width: width, height: height, recipe: recipe, colors: colors) }
      var hashes = [String: String]()
      for (index, source) in sources.enumerated() { try autoreleasepool {
        try check(id)
        guard source.url.isFileURL else { throw Failure.invalidInput }
        let file = try source.url.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey])
        guard source.url.isFileURL, file.isRegularFile == true, let bytes = file.fileSize, bytes > 0, bytes <= 64 * 1024 * 1024,
          let input = CGImageSourceCreateWithURL(source.url as CFURL, nil), CGImageSourceGetCount(input) == 1,
          let type = CGImageSourceGetType(input), (type as String) == UTType.jpeg.identifier,
          let props = CGImageSourceCopyPropertiesAtIndex(input, 0, nil) as? [String: Any],
          let w = props[kCGImagePropertyPixelWidth as String] as? NSNumber,
          let h = props[kCGImagePropertyPixelHeight as String] as? NSNumber else { throw Failure.invalidInput }
        let sw = w.intValue, sh = h.intValue
        guard sw > 0, sh > 0, sw <= 24000, sh <= 24000, sw * sh <= 24_000_000 else { throw Failure.resourceLimit }
        let orientation = (props[kCGImagePropertyOrientation as String] as? NSNumber)?.int32Value ?? 1
        guard (1...8).contains(orientation) else { throw Failure.invalidInput }
        hashes[source.photoId] = try hash(source.url, id: id)
        try check(id)
        guard let cg = CGImageSourceCreateImageAtIndex(input, 0, [kCGImageSourceShouldCache: false] as CFDictionary) else { throw Failure.invalidInput }
        let upright = CIImage(cgImage: cg).oriented(forExifOrientation: orientation)
        let image = upright.transformed(by: CGAffineTransform(translationX: -upright.extent.minX, y: -upright.extent.minY))
        let top = Self.window(recipe: recipe, index: index)
        let window = CGRect(x: top.minX, y: CGFloat(height) - top.maxY, width: top.width, height: top.height)
        let crop = recipe.cropsByPhotoId[source.photoId]!
        let base = crop.mode == "fit" ? min(window.width / image.extent.width, window.height / image.extent.height)
          : max(window.width / image.extent.width, window.height / image.extent.height)
        let scale = base * CGFloat(crop.zoom), dw = image.extent.width * scale, dh = image.extent.height * scale
        let x = window.midX - dw / 2 - CGFloat(crop.x) * max(0, dw - window.width) / 2
        let y = window.midY - dh / 2 + CGFloat(crop.y) * max(0, dh - window.height) / 2
        let placed = image.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
          .transformed(by: CGAffineTransform(translationX: x, y: y))
        try check(id)
        guard let tile = PhotoEffectsEngine.context.createCGImage(placed, from: window, format: .RGBA8,
          colorSpace: PhotoEffectsEngine.sRGB) else { throw Failure.encodingFailed }
        canvas.draw(tile, in: window)
      } }
      if recipe.version == Self.version {
        footer(canvas, width: width, height: height, layout: recipe.layout, theme: recipe.theme, colors: colors)
      } else { footerV2(canvas, width: width, height: height, recipe: recipe, colors: colors) }
      try check(id)
      guard let full = canvas.makeImage() else { throw Failure.encodingFailed }
      let factor = preview ? min(1, 1440 / CGFloat(max(width, height))) : 1
      let outWidth = Int((CGFloat(width) * factor).rounded()), outHeight = Int((CGFloat(height) * factor).rounded())
      var output = full
      if preview {
        let small = CIImage(cgImage: full).applyingFilter("CILanczosScaleTransform", parameters: [kCIInputScaleKey: factor, kCIInputAspectRatioKey: 1])
        guard let scaled = PhotoEffectsEngine.context.createCGImage(small, from: CGRect(x: 0, y: 0,
          width: CGFloat(outWidth), height: CGFloat(outHeight)), format: .RGBA8, colorSpace: PhotoEffectsEngine.sRGB) else { throw Failure.encodingFailed }
        output = scaled
      }
      try check(id)
      let temporary = cache.appendingPathComponent(UUID().uuidString + ".tmp"), final = cache.appendingPathComponent(UUID().uuidString + ".jpg")
      defer { try? FileManager.default.removeItem(at: temporary) }
      guard let destination = CGImageDestinationCreateWithURL(temporary as CFURL, UTType.jpeg.identifier as CFString, 1, nil) else { throw Failure.encodingFailed }
      CGImageDestinationAddImage(destination, output, [kCGImageDestinationLossyCompressionQuality: 0.95, kCGImagePropertyOrientation: 1] as CFDictionary)
      guard CGImageDestinationFinalize(destination) else { throw Failure.encodingFailed }
      let bytes = try temporary.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
      guard bytes > 0, used + bytes <= 256 * 1024 * 1024 else { throw Failure.resourceLimit }
      try check(id); try FileManager.default.moveItem(at: temporary, to: final)
      do { try check(id) } catch { try? FileManager.default.removeItem(at: final); throw error }
      return Result(uri: final.absoluteString, width: outWidth, height: outHeight, preview: preview,
        version: recipe.version, recipeJSON: try recipe.canonical, sourceHashes: hashes)
    } }
  }
  public static func window(layout: String, index: Int) -> CGRect {
    if layout == "strip" { return CGRect(x: 60, y: CGFloat(60 + index * 834), width: 1080, height: 810) }
    return CGRect(x: CGFloat(96 + (index % 2) * 1128), y: CGFloat(96 + (index / 2) * 858), width: 1080, height: 810)
  }
  /// Geometry for v1 remains routed to the unchanged original window function.
  public static func dimensions(recipe: Recipe) -> (width: Int, height: Int) {
    if recipe.layout == "strip" { return (1200, 3600) }
    if recipe.version == currentVersion { return (2400, 2400) }
    if recipe.version == version { return (2400, 2100) }
    return (2400, recipe.gridAspect == "portrait" ? 3000 : 2400)
  }
  public static func window(recipe: Recipe, index: Int) -> CGRect {
    if recipe.version == currentVersion {
      if recipe.layout == "strip" { return CGRect(x: 100, y: CGFloat(220 + index * 770), width: 1000, height: 750) }
      return CGRect(x: CGFloat(160 + (index % 2) * 1056), y: CGFloat(180 + (index / 2) * 1036), width: 1024, height: 1024)
    }
    if recipe.version == version || recipe.layout == "strip" { return window(layout: recipe.layout, index: index) }
    if recipe.gridAspect == "portrait" {
      return CGRect(x: CGFloat(72 + (index % 2) * 1140), y: CGFloat(72 + (index / 2) * 1356), width: 1116, height: 1332)
    }
    return CGRect(x: CGFloat(96 + (index % 2) * 1128), y: CGFloat(60 + (index / 2) * 1104), width: 1080, height: 1080)
  }
  public struct InspectedSource {
    public let photoId: String; public let width, height: Int; public let sha256: String
    public var dictionary: [String: Any] { ["photoId": photoId, "width": width, "height": height, "sha256": sha256] }
  }
  public struct Inspection {
    public let sources: [InspectedSource]; public let gridAspect: String
    public var dictionary: [String: Any] { ["version": PhotoTemplateEngine.currentVersion, "gridAspect": gridAspect,
      "sources": sources.map { $0.dictionary }] }
  }
  /// Metadata is read without decoding four full bitmaps. Caller persists the choice
  /// in the v2 recipe, so theme/order/crop mutations never recompute it.
  public func inspect(sources: [Source]) throws -> Inspection {
    guard sources.count == 4, Set(sources.map(\.photoId)).count == 4,
      sources.allSatisfy({ $0.photoId.range(of: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$", options: .regularExpression) != nil })
      else { throw Failure.invalidInput }
    return try PhotoEffectsEngine.queue.sync { try autoreleasepool {
      let inspected = try sources.map { source -> InspectedSource in
        guard source.url.isFileURL else { throw Failure.invalidInput }
        let file = try source.url.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey])
        guard file.isRegularFile == true, let bytes = file.fileSize, bytes > 0, bytes <= 64 * 1024 * 1024,
          let input = CGImageSourceCreateWithURL(source.url as CFURL, nil), CGImageSourceGetCount(input) == 1,
          let type = CGImageSourceGetType(input), (type as String) == UTType.jpeg.identifier,
          let props = CGImageSourceCopyPropertiesAtIndex(input, 0, nil) as? [String: Any],
          let w = props[kCGImagePropertyPixelWidth as String] as? NSNumber,
          let h = props[kCGImagePropertyPixelHeight as String] as? NSNumber else { throw Failure.invalidInput }
        let width = w.intValue, height = h.intValue
        guard width > 0, height > 0, width <= 24000, height <= 24000, width * height <= 24_000_000 else { throw Failure.resourceLimit }
        let orientation = (props[kCGImagePropertyOrientation as String] as? NSNumber)?.intValue ?? 1
        guard (1...8).contains(orientation) else { throw Failure.invalidInput }
        let handle = try FileHandle(forReadingFrom: source.url); defer { try? handle.close() }
        var value = SHA256()
        while let data = try handle.read(upToCount: 1024 * 1024), !data.isEmpty { value.update(data: data) }
        return InspectedSource(photoId: source.photoId, width: orientation >= 5 ? height : width,
          height: orientation >= 5 ? width : height, sha256: value.finalize().map { String(format: "%02x", $0) }.joined())
      }
      let ratios = inspected.map { Double($0.width) / Double($0.height) }.sorted()
      let median = (ratios[1] + ratios[2]) / 2
      return Inspection(sources: inspected, gridAspect: median < 0.95 ? "portrait" : "square")
    } }
  }
  private struct Palette { let background, ink, accent, sand: CGColor }
  private func palette(_ theme: String) -> Palette {
    func color(_ r: CGFloat, _ g: CGFloat, _ b: CGFloat) -> CGColor {
      CGColor(colorSpace: PhotoEffectsEngine.sRGB, components: [r / 255, g / 255, b / 255, 1])!
    }
    switch theme {
    case "botanical": return Palette(background: color(238,241,232), ink: color(49,72,58), accent: color(139,155,128), sand: color(139,155,128))
    case "coastal": return Palette(background: color(237,244,242), ink: color(39,69,65), accent: color(143,183,174), sand: color(212,193,162))
    default: return Palette(background: color(246,241,231), ink: color(53,43,37), accent: color(188,166,139), sand: color(188,166,139))
    }
  }
  private func footer(_ context: CGContext, width: Int, height: Int, layout: String, theme: String, colors: Palette) {
    let strip = layout == "strip", center = CGFloat(width) / 2
    func text(_ value: String, size: CGFloat, font: String, topBaseline: CGFloat) {
      let attributes: [NSAttributedString.Key: Any] = [NSAttributedString.Key(kCTFontAttributeName as String): CTFontCreateWithName(font as CFString, size, nil),
        NSAttributedString.Key(kCTForegroundColorAttributeName as String): colors.ink]
      let line = CTLineCreateWithAttributedString(NSAttributedString(string: value, attributes: attributes) as CFAttributedString)
      let length = CGFloat(CTLineGetTypographicBounds(line, nil, nil, nil))
      context.textMatrix = .identity; context.textPosition = CGPoint(x: center - length / 2, y: CGFloat(height) - topBaseline)
      CTLineDraw(line, context)
    }
    text("Gizelle & Rami", size: strip ? 52 : 64, font: "Georgia", topBaseline: strip ? 3457 : 1870)
    text("NOVEMBER 1, 2026", size: strip ? 21 : 25, font: "HelveticaNeue", topBaseline: strip ? 3510 : 1936)
    context.setStrokeColor(colors.accent); context.setLineWidth(2.5)
    let y = CGFloat(height) - (strip ? 3542 : 1982)
    if theme == "botanical" {
      for sign in [CGFloat(-1), CGFloat(1)] {
        let x = center + sign * 180
        context.move(to: CGPoint(x: x - 45, y: y)); context.addLine(to: CGPoint(x: x + 45, y: y + 9)); context.strokePath()
        for step in 0..<5 {
          let sx = x - 30 + CGFloat(step) * 15
          context.move(to: CGPoint(x: sx, y: y + 3)); context.addQuadCurve(to: CGPoint(x: sx + 9, y: y + 17), control: CGPoint(x: sx + 2, y: y + 15)); context.strokePath()
        }
      }
    } else if theme == "coastal" {
      for row in 0..<2 {
        context.setStrokeColor(row == 0 ? colors.accent : colors.sand)
        context.move(to: CGPoint(x: center - 150, y: y - CGFloat(row) * 9))
        for step in 0..<6 {
          let x = center - 150 + CGFloat(step) * 50
          context.addCurve(to: CGPoint(x: x + 50, y: y - CGFloat(row) * 9), control1: CGPoint(x: x + 16, y: y + 10 - CGFloat(row) * 9), control2: CGPoint(x: x + 34, y: y - 10 - CGFloat(row) * 9))
        }; context.strokePath()
      }
    } else { context.move(to: CGPoint(x: center - 80, y: y)); context.addLine(to: CGPoint(x: center + 80, y: y)); context.strokePath() }
  }
  private func paletteV2(_ theme: String) -> Palette {
    func color(_ r: CGFloat, _ g: CGFloat, _ b: CGFloat) -> CGColor {
      CGColor(colorSpace: PhotoEffectsEngine.sRGB, components: [r / 255, g / 255, b / 255, 1])!
    }
    switch theme {
    case "botanical": return Palette(background: color(220,229,214), ink: color(45,69,55), accent: color(109,131,103), sand: color(250,247,238))
    case "coastal": return Palette(background: color(219,235,231), ink: color(36,76,73), accent: color(107,159,153), sand: color(250,247,238))
    default: return Palette(background: color(246,240,228), ink: color(55,45,39), accent: color(182,160,124), sand: color(250,247,238))
    }
  }
  /// Original ornaments are clipped to the space outside all four photo windows.
  /// Ivory mats remain visible in FIT sidebands; FILL is the only crop operation.
  private func decorationV2(_ context: CGContext, width: Int, height: Int, recipe: Recipe, colors: Palette) {
    context.saveGState(); defer { context.restoreGState() }
    context.translateBy(x: 0, y: CGFloat(height)); context.scaleBy(x: 1, y: -1)
    let bounds = CGRect(x: 0, y: 0, width: CGFloat(width), height: CGFloat(height))
    let windows = (0..<4).map { Self.window(recipe: recipe, index: $0) }
    for window in windows {
      context.setFillColor(recipe.theme == "classic" ? colors.background : colors.sand)
      context.fill(window.insetBy(dx: -10, dy: -10))
    }
    context.addRect(bounds)
    for window in windows { context.addRect(window) }
    context.clip(using: .evenOdd)
    context.setStrokeColor(colors.accent)
    if recipe.theme == "classic" {
      context.setLineWidth(2)
      context.stroke(bounds.insetBy(dx: 20, dy: 20))
      context.setLineWidth(1)
      context.stroke(bounds.insetBy(dx: 30, dy: 30))
      for window in windows { context.stroke(window.insetBy(dx: -7, dy: -7)) }
    } else if recipe.theme == "botanical" {
      // Asymmetric opposite stems, paired filled leaves; all artwork is procedural.
      func branch(x: CGFloat, y: CGFloat, sign: CGFloat, length: CGFloat) {
        context.saveGState(); defer { context.restoreGState() }
        context.translateBy(x: x, y: y); context.scaleBy(x: sign, y: 1)
        context.setLineWidth(3)
        context.move(to: CGPoint(x: 0, y: 0))
        context.addCurve(to: CGPoint(x: length, y: -45), control1: CGPoint(x: length * 0.35, y: -4), control2: CGPoint(x: length * 0.7, y: -40))
        context.strokePath(); context.setFillColor(colors.accent)
        for i in 1...6 {
          let px = CGFloat(i) * length / 7, py = -CGFloat(i) * 45 / 7
          for side in [CGFloat(-1), CGFloat(1)] {
            context.move(to: CGPoint(x: px, y: py))
            context.addQuadCurve(to: CGPoint(x: px + 19, y: py + side * 30), control: CGPoint(x: px - 6, y: py + side * 24))
            context.addQuadCurve(to: CGPoint(x: px, y: py), control: CGPoint(x: px + 28, y: py + side * 13))
            context.fillPath()
          }
        }
      }
      let footerTop = windows.map(\.maxY).max()!
      let length: CGFloat = recipe.layout == "strip" ? 160 : 270
      branch(x: recipe.layout == "strip" ? 75 : 120, y: footerTop + (CGFloat(height) - footerTop) * 0.67, sign: 1, length: length)
      branch(x: CGFloat(width) - (recipe.layout == "strip" ? 75 : 120), y: footerTop + (CGFloat(height) - footerTop) * 0.38, sign: -1, length: length)
      branch(x: 20, y: 57, sign: 1, length: 170)
      branch(x: CGFloat(width) - 20, y: 40, sign: -1, length: 170)
    } else {
      // Visible flowing coastal contours in the field and footer, never the photos.
      context.setLineWidth(3)
      for row in 0..<5 {
        let y = CGFloat(height) - 22 - CGFloat(row) * 15
        let wing = recipe.layout == "strip" ? CGFloat(210) : CGFloat(650)
        for mirror in [false, true] {
          context.saveGState()
          if mirror { context.translateBy(x: CGFloat(width), y: 0); context.scaleBy(x: -1, y: 1) }
          context.move(to: CGPoint(x: 36, y: y))
          context.addCurve(to: CGPoint(x: wing, y: y - 8), control1: CGPoint(x: wing * 0.35, y: y - 24), control2: CGPoint(x: wing * 0.7, y: y + 20))
          context.strokePath(); context.restoreGState()
        }
      }
      for row in 0..<3 {
        let x = CGFloat(18 + row * 13)
        context.move(to: CGPoint(x: x, y: 35))
        context.addCurve(to: CGPoint(x: x + 4, y: CGFloat(height) - 40), control1: CGPoint(x: x + 18, y: CGFloat(height) * 0.3), control2: CGPoint(x: x - 10, y: CGFloat(height) * 0.65))
        context.strokePath()
        context.move(to: CGPoint(x: CGFloat(width) - x, y: 35))
        context.addCurve(to: CGPoint(x: CGFloat(width) - x - 4, y: CGFloat(height) - 40), control1: CGPoint(x: CGFloat(width) - x - 18, y: CGFloat(height) * 0.3), control2: CGPoint(x: CGFloat(width) - x + 10, y: CGFloat(height) * 0.65))
        context.strokePath()
      }
    }
  }
  /// Resource identity is part of the v3 recipe contract. Missing/tampered art fails visibly;
  /// it must never silently produce a legacy frame under a v3 acknowledgement.
  private func artworkV3(_ context: CGContext, width: Int, height: Int, recipe: Recipe, colors: Palette) throws {
    let art: (String, String)
    switch recipe.theme {
    case "botanical": art = ("Sage-Botanical-Text-Free-Artwork", "4121598a7aa1d445fed5c223d4b475d706cb93567d90c51a42d1dad86cb36e21")
    case "coastal": art = ("Coastal-Sea-Glass-Text-Free-Artwork", "8f3bbfb131c9454f6ea633a79445e6cd9b32176e9aa80c09080925b0d83884a0")
    default: art = ("Classic-Ivory-Text-Free-Artwork", "3ccb9f0acf030b5bc31b2bbf6d81f3e694e2dd2e045dc77fd930c6d4df59164e")
    }
    let host = Bundle(for: PhotoTemplateEngine.self)
    let nested = host.url(forResource: "WeddingFrameArt", withExtension: "bundle").flatMap(Bundle.init(url:))
      ?? Bundle.main.url(forResource: "WeddingFrameArt", withExtension: "bundle").flatMap(Bundle.init(url:))
    guard let url = (nested ?? host).url(forResource: art.0, withExtension: "frameart"),
      let data = try? Data(contentsOf: url), data.count < 8 * 1024 * 1024,
      SHA256.hash(data: data).map({ String(format: "%02x", $0) }).joined() == art.1,
      let source = CGImageSourceCreateWithData(data as CFData, nil),
      CGImageSourceGetCount(source) == 1,
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil), image.width == 1254, image.height == 1254
      else { throw Failure.invalidInput }
    // Nine-slice preserves corner sprigs/washes at uniform scale. Only the quiet
    // paper/edge bands stretch along a strip; no whole-square stretch or center crop.
    let edge: CGFloat = recipe.layout == "strip" ? 250 : 350
    let input: [CGFloat] = [0, 250, 1004, 1254]
    let outputX: [CGFloat] = [0, edge, CGFloat(width) - edge, CGFloat(width)]
    let outputY: [CGFloat] = [0, edge, CGFloat(height) - edge, CGFloat(height)]
    context.saveGState(); defer { context.restoreGState() }
    context.interpolationQuality = .high
    for row in 0..<3 { for col in 0..<3 {
      let sourceRect = CGRect(x: input[col], y: input[row], width: input[col+1] - input[col], height: input[row+1] - input[row])
      guard let patch = image.cropping(to: sourceRect) else { throw Failure.encodingFailed }
      let destination = CGRect(x: outputX[col], y: CGFloat(height) - outputY[row+1],
        width: outputX[col+1] - outputX[col], height: outputY[row+1] - outputY[row])
      context.draw(patch, in: destination)
    } }
    // A crisp editorial outline is separate from the generated paper artwork.
    context.setStrokeColor(colors.accent); context.setLineWidth(recipe.theme == "classic" ? 1.5 : 1)
    let inset: CGFloat = recipe.layout == "strip" ? 24 : 40
    context.stroke(CGRect(x: inset, y: inset, width: CGFloat(width) - inset * 2, height: CGFloat(height) - inset * 2))
    // Photo mats never cover originals; FIT retains every edge, FILL stays explicit.
    context.setFillColor(colors.sand)
    for index in 0..<4 {
      let window = Self.window(recipe: recipe, index: index)
      context.fill(CGRect(x: window.minX, y: CGFloat(height) - window.maxY, width: window.width, height: window.height))
    }
  }
  private func footerV2(_ context: CGContext, width: Int, height: Int, recipe: Recipe, colors: Palette) {
    let footerTop = (0..<4).map { Self.window(recipe: recipe, index: $0).maxY }.max()!
    let strip = recipe.layout == "strip", compact = !strip && recipe.gridAspect == "square"
    let nameBaseline = recipe.version == Self.currentVersion ? CGFloat(strip ? 3420 : 2310) : strip ? CGFloat(3480) : footerTop + (compact ? 86 : 116)
    let dateBaseline = recipe.version == Self.currentVersion ? CGFloat(strip ? 3490 : 2360) : strip ? CGFloat(3535) : footerTop + (compact ? 133 : 174)
    func text(_ value: String, size: CGFloat, font: String, topBaseline: CGFloat) {
      let attributes: [NSAttributedString.Key: Any] = [NSAttributedString.Key(kCTFontAttributeName as String): CTFontCreateWithName(font as CFString, size, nil),
        NSAttributedString.Key(kCTForegroundColorAttributeName as String): colors.ink]
      let line = CTLineCreateWithAttributedString(NSAttributedString(string: value, attributes: attributes) as CFAttributedString)
      let length = CGFloat(CTLineGetTypographicBounds(line, nil, nil, nil))
      context.textMatrix = .identity
      context.textPosition = CGPoint(x: CGFloat(width) / 2 - length / 2, y: CGFloat(height) - topBaseline)
      CTLineDraw(line, context)
    }
    text("Gizelle & Rami", size: strip ? 86 : 84, font: "Georgia", topBaseline: nameBaseline)
    text("NOVEMBER 1, 2026", size: strip ? 36 : 32, font: "HelveticaNeue", topBaseline: dateBaseline)
  }
  private func hash(_ url: URL, id: UUID) throws -> String {
    let file = try FileHandle(forReadingFrom: url); defer { try? file.close() }; var value = SHA256()
    while let data = try file.read(upToCount: 1024 * 1024), !data.isEmpty { try check(id); value.update(data: data) }
    return value.finalize().map { String(format: "%02x", $0) }.joined()
  }
  public func release(_ url: URL) throws {
    try PhotoEffectsEngine.queue.sync {
      let resolved = url.standardizedFileURL.resolvingSymlinksInPath()
      guard url.isFileURL, cache.isFileURL, url.pathExtension == "jpg", Self.owned(url),
        resolved.deletingLastPathComponent().pathComponents == cache.pathComponents,
        resolved.pathExtension == "jpg", Self.owned(resolved) else { throw Failure.invalidInput }
      if FileManager.default.fileExists(atPath: resolved.path) { try FileManager.default.removeItem(at: resolved) }
    }
  }
}
