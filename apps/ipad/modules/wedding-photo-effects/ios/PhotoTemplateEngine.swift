import Foundation
import CoreImage
import CoreText
import ImageIO
import UniformTypeIdentifiers
import CryptoKit

/// Original text-spec geometry and vector ornament only; no vendor/reference artwork.
public final class PhotoTemplateEngine: @unchecked Sendable {
  public static let version = "wedding-template-v1"
  public struct Source { public let photoId: String; public let url: URL
    public init(photoId: String, url: URL) { self.photoId = photoId; self.url = url } }
  public struct Crop: Codable { public let mode: String; public let x, y, zoom: Double }
  public struct Recipe: Codable {
    public let version, layout, theme: String
    public let photoIds: [String]
    public let cropsByPhotoId: [String: Crop]
    public static func parse(_ json: String) throws -> Recipe {
      guard let data = json.data(using: .utf8), data.count <= 8192,
        let raw = try JSONSerialization.jsonObject(with: data) as? [String: Any],
        Set(raw.keys) == Set(["version", "layout", "theme", "photoIds", "cropsByPhotoId"]),
        let crops = raw["cropsByPhotoId"] as? [String: [String: Any]],
        crops.values.allSatisfy({ Set($0.keys) == Set(["mode", "x", "y", "zoom"]) }) else { throw Failure.invalidInput }
      let recipe = try JSONDecoder().decode(Recipe.self, from: data)
      guard recipe.version == PhotoTemplateEngine.version, ["strip", "grid"].contains(recipe.layout),
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
    public let recipeJSON: String; public let sourceHashes: [String: String]
    public var dictionary: [String: Any] { ["uri": uri, "width": width, "height": height,
      "preview": preview, "version": PhotoTemplateEngine.version, "recipeJSON": recipeJSON, "sourceHashes": sourceHashes] }
  }
  public enum Failure: Error { case invalidInput, resourceLimit, cancelled, encodingFailed }
  private let cache: URL
  private let lock = NSLock()
  private var active = Set<UUID>(), cancelled = Set<UUID>(), completed = Set<UUID>()
  private var recent = [UUID](), pending = [UUID]()
  public init(cacheDirectory: URL) {
    cache = cacheDirectory.standardizedFileURL.resolvingSymlinksInPath()
    PhotoEffectsEngine.queue.sync {
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
      let width = recipe.layout == "strip" ? 1200 : 2400, height = recipe.layout == "strip" ? 3600 : 2100
      guard let canvas = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
        space: PhotoEffectsEngine.sRGB, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { throw Failure.resourceLimit }
      let colors = palette(recipe.theme)
      canvas.setFillColor(colors.background); canvas.fill(CGRect(x: 0, y: 0, width: CGFloat(width), height: CGFloat(height)))
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
        let top = Self.window(layout: recipe.layout, index: index)
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
      footer(canvas, width: width, height: height, layout: recipe.layout, theme: recipe.theme, colors: colors)
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
        recipeJSON: try recipe.canonical, sourceHashes: hashes)
    } }
  }
  public static func window(layout: String, index: Int) -> CGRect {
    if layout == "strip" { return CGRect(x: 60, y: CGFloat(60 + index * 834), width: 1080, height: 810) }
    return CGRect(x: CGFloat(96 + (index % 2) * 1128), y: CGFloat(96 + (index / 2) * 858), width: 1080, height: 810)
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
  private func hash(_ url: URL, id: UUID) throws -> String {
    let file = try FileHandle(forReadingFrom: url); defer { try? file.close() }; var value = SHA256()
    while let data = try file.read(upToCount: 1024 * 1024), !data.isEmpty { try check(id); value.update(data: data) }
    return value.finalize().map { String(format: "%02x", $0) }.joined()
  }
  public func release(_ url: URL) throws {
    try PhotoEffectsEngine.queue.sync {
      let resolved = url.standardizedFileURL.resolvingSymlinksInPath()
      guard url.isFileURL, resolved.deletingLastPathComponent() == cache, resolved.pathExtension == "jpg", Self.owned(resolved) else { throw Failure.invalidInput }
      if FileManager.default.fileExists(atPath: resolved.path) { try FileManager.default.removeItem(at: resolved) }
    }
  }
}
