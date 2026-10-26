import Foundation
import CoreImage
import ImageIO
import UniformTypeIdentifiers
import CryptoKit

/// Camera originals are immutable. This engine has no UIKit or Expo dependency.
public final class PhotoEffectsEngine: @unchecked Sendable {
  public static let recipeVersion = "wedding-ci-srgb-v1"
  public static let presets = ["original", "warm", "bw", "film"]
  static let queue = DispatchQueue(label: "wedding.photo.effects", qos: .userInitiated)
  static let sRGB = CGColorSpace(name: CGColorSpace.sRGB)!
  static let context = CIContext(options: [.workingColorSpace: sRGB,
    .outputColorSpace: sRGB, .cacheIntermediates: false])
  private let lock = NSLock()
  private var cancelled = Set<UUID>()
  private var active = Set<UUID>()
  private var completed = Set<UUID>()
  private var recentCompleted = [UUID]()
  private var pendingCancellation = [UUID]()
  private let cache: URL
  public struct Result {
    public let uri: String, preset: String, originalSha256: String
    public let width: Int, height: Int
    public let intensity: Double
    public let isOriginal: Bool, preview: Bool
    public var dictionary: [String: Any] { ["uri": uri, "width": width, "height": height,
      "recipeVersion": PhotoEffectsEngine.recipeVersion, "preset": preset, "intensity": intensity,
      "originalSha256": originalSha256, "isOriginal": isOriginal, "preview": preview] }
  }
  public enum Failure: Error { case invalidInput, cancelled, resourceLimit, encodingFailed }
  /// A new module lifetime owns this cache exclusively; prior cache URIs are ephemeral.
  public init(cacheDirectory: URL) {
    cache = cacheDirectory.standardizedFileURL.resolvingSymlinksInPath()
    Self.queue.sync {
      let old = (try? FileManager.default.contentsOfDirectory(at: cache, includingPropertiesForKeys: nil)) ?? []
      for item in old where Self.ownedName(item) { try? FileManager.default.removeItem(at: item) }
    }
  }
  private static func ownedName(_ url: URL) -> Bool {
    ["jpg", "tmp"].contains(url.pathExtension) && UUID(uuidString: url.deletingPathExtension().lastPathComponent) != nil
  }
  /// Cancellation is cooperative; it cannot interrupt an in-flight Core Image GPU render.
  public func cancel(_ id: UUID) {
    lock.lock(); defer { lock.unlock() }
    if completed.contains(id) { return }
    if active.contains(id) { cancelled.insert(id); return }
    if !pendingCancellation.contains(id) {
      pendingCancellation.append(id)
      if pendingCancellation.count > 512 { pendingCancellation.removeFirst() }
    }
  }
  private func checkpoint(_ id: UUID) throws {
    lock.lock(); defer { lock.unlock() }
    if cancelled.contains(id) { throw Failure.cancelled }
  }
  public func render(source: URL, preset: String, intensity: Double, preview: Bool, id: UUID) throws -> Result {
    lock.lock()
    guard !active.contains(id), !completed.contains(id), active.count < 64 else {
      lock.unlock(); throw Failure.resourceLimit
    }
    active.insert(id)
    if let index = pendingCancellation.firstIndex(of: id) {
      pendingCancellation.remove(at: index); cancelled.insert(id)
    }
    lock.unlock()
    defer {
      lock.lock(); active.remove(id); cancelled.remove(id); completed.insert(id); recentCompleted.append(id)
      if recentCompleted.count > 512 { completed.remove(recentCompleted.removeFirst()) }
      lock.unlock()
    }
    return try Self.queue.sync { try autoreleasepool {
      try checkpoint(id)
      guard source.isFileURL, Self.presets.contains(preset), intensity.isFinite,
        (0...1).contains(intensity) else { throw Failure.invalidInput }
      let size = try source.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey])
      guard size.isRegularFile == true, let bytes = size.fileSize, bytes > 0, bytes <= 64 * 1024 * 1024,
        let input = CGImageSourceCreateWithURL(source as CFURL, nil), CGImageSourceGetCount(input) == 1,
        let type = CGImageSourceGetType(input), (type as String) == UTType.jpeg.identifier,
        let props = CGImageSourceCopyPropertiesAtIndex(input, 0, nil) as? [String: Any],
        let w = props[kCGImagePropertyPixelWidth as String] as? NSNumber,
        let h = props[kCGImagePropertyPixelHeight as String] as? NSNumber else { throw Failure.invalidInput }
      let width = w.intValue, height = h.intValue
      guard width > 0, height > 0, width <= 24000, height <= 24000,
        width * height <= 24_000_000 else { throw Failure.resourceLimit }
      let orientation = (props[kCGImagePropertyOrientation as String] as? NSNumber)?.int32Value ?? 1
      guard (1...8).contains(orientation) else { throw Failure.invalidInput }
      let uprightWidth = orientation >= 5 ? height : width
      let uprightHeight = orientation >= 5 ? width : height
      let sha = try hash(source, id: id)
      try checkpoint(id)
      if !preview && (preset == "original" || intensity == 0) {
        return Result(uri: source.absoluteString, preset: preset, originalSha256: sha,
          width: uprightWidth, height: uprightHeight, intensity: intensity, isOriginal: true, preview: false)
      }
      try FileManager.default.createDirectory(at: cache, withIntermediateDirectories: true)
      let files = try FileManager.default.contentsOfDirectory(at: cache, includingPropertiesForKeys: [.fileSizeKey])
      let used = try files.reduce(0) { try $0 + ($1.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0) }
      guard files.count < 48, used < 192 * 1024 * 1024 else { throw Failure.resourceLimit }
      guard let cg = CGImageSourceCreateImageAtIndex(input, 0, [kCGImageSourceShouldCache: false] as CFDictionary)
        else { throw Failure.invalidInput }
      let oriented = CIImage(cgImage: cg).oriented(forExifOrientation: orientation)
      let origin = oriented.extent.origin
      let original = oriented.transformed(by: CGAffineTransform(translationX: -origin.x, y: -origin.y))
      let effect = recipe(original, preset: preset)
      var image = original
      if preset != "original" && intensity > 0 {
        image = original.applyingFilter("CIDissolveTransition", parameters: [
          kCIInputTargetImageKey: effect, kCIInputTimeKey: intensity]).cropped(to: original.extent)
      }
      let scale = preview ? min(1, 1440 / max(image.extent.width, image.extent.height)) : 1
      let outWidth = max(1, Int(floor(image.extent.width * scale)))
      let outHeight = max(1, Int(floor(image.extent.height * scale)))
      if scale < 1 { image = image.applyingFilter("CILanczosScaleTransform", parameters: [kCIInputScaleKey: scale, kCIInputAspectRatioKey: 1]) }
      let bounds = CGRect(x: 0, y: 0, width: CGFloat(outWidth), height: CGFloat(outHeight))
      try checkpoint(id)
      guard let rendered = Self.context.createCGImage(image, from: bounds, format: .RGBA8, colorSpace: Self.sRGB)
        else { throw Failure.encodingFailed }
      try checkpoint(id)
      let final = cache.appendingPathComponent(UUID().uuidString + ".jpg")
      let temporary = cache.appendingPathComponent(UUID().uuidString + ".tmp")
      defer { try? FileManager.default.removeItem(at: temporary) }
      guard let destination = CGImageDestinationCreateWithURL(temporary as CFURL, UTType.jpeg.identifier as CFString, 1, nil)
        else { throw Failure.encodingFailed }
      // A fresh destination receives no source EXIF, GPS, maker notes, thumbnails, or UI overlays.
      CGImageDestinationAddImage(destination, rendered, [kCGImageDestinationLossyCompressionQuality: 0.95,
        kCGImagePropertyOrientation: 1] as CFDictionary)
      guard CGImageDestinationFinalize(destination) else { throw Failure.encodingFailed }
      let outputBytes = try temporary.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
      guard outputBytes > 0, used + outputBytes <= 256 * 1024 * 1024 else { throw Failure.resourceLimit }
      try checkpoint(id)
      try FileManager.default.moveItem(at: temporary, to: final)
      do { try checkpoint(id) } catch { try? FileManager.default.removeItem(at: final); throw error }
      return Result(uri: final.absoluteString, preset: preset, originalSha256: sha,
        width: outWidth, height: outHeight, intensity: intensity, isOriginal: false, preview: preview)
    } }
  }
  private func recipe(_ input: CIImage, preset: String) -> CIImage {
    switch preset {
    case "warm":
      return input.applyingFilter("CIColorMatrix", parameters: [
        "inputRVector": CIVector(x: 1.045, y: 0, z: 0, w: 0),
        "inputGVector": CIVector(x: 0, y: 1.008, z: 0, w: 0),
        "inputBVector": CIVector(x: 0, y: 0, z: 0.955, w: 0)])
    case "bw":
      return input.applyingFilter("CIColorControls", parameters: [kCIInputSaturationKey: 0, kCIInputContrastKey: 1.035])
    case "film":
      return input.applyingFilter("CIColorControls", parameters: [kCIInputSaturationKey: 0.86, kCIInputContrastKey: 0.94])
        .applyingFilter("CIColorMatrix", parameters: ["inputBiasVector": CIVector(x: 0.018, y: 0.012, z: 0.005, w: 0)])
    default: return input
    }
  }
  private func hash(_ source: URL, id: UUID) throws -> String {
    let file = try FileHandle(forReadingFrom: source); defer { try? file.close() }
    var hash = SHA256()
    while let data = try file.read(upToCount: 1024 * 1024), !data.isEmpty {
      try checkpoint(id); hash.update(data: data)
    }
    return hash.finalize().map { String(format: "%02x", $0) }.joined()
  }
  public func release(_ url: URL) throws {
    try Self.queue.sync {
      let resolved = url.standardizedFileURL.resolvingSymlinksInPath()
      guard url.isFileURL, resolved.deletingLastPathComponent() == cache,
        resolved.pathExtension == "jpg", UUID(uuidString: resolved.deletingPathExtension().lastPathComponent) != nil
        else { throw Failure.invalidInput }
      if FileManager.default.fileExists(atPath: resolved.path) { try FileManager.default.removeItem(at: resolved) }
    }
  }
}
