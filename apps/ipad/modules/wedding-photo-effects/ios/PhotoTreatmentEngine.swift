import Foundation
import CoreImage
import ImageIO
import UniformTypeIdentifiers
import CryptoKit

/// Root-original -> look pixels -> face pixels -> one final JPEG. No live-camera integration.
public final class PhotoTreatmentEngine: @unchecked Sendable {
  public static let version = "wedding-photo-treatment-v1"
  public struct Look: Codable { public var preset: String; public var intensity: Double; public var version: String }
  public struct Face: Codable { public var accessory: String; public var version: String }
  public struct Recipe: Codable {
    public var version: String, order: String
    public var look: Look; public var face: Face
    public static func parse(_ json: String) throws -> Recipe {
      guard let data = json.data(using: .utf8), data.count <= 8192,
        let raw = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
        Set(raw.keys) == Set(["version", "order", "look", "face"]),
        let look = raw["look"] as? [String: Any], Set(look.keys) == Set(["preset", "intensity", "version"]),
        let face = raw["face"] as? [String: Any], Set(face.keys) == Set(["accessory", "version"]) else { throw Failure.invalidRecipe }
      guard var value = try? JSONDecoder().decode(Recipe.self, from: data) else { throw Failure.invalidRecipe }
      guard value.version == PhotoTreatmentEngine.version, value.order == "look-then-face",
        value.look.version == PhotoEffectsEngine.recipeVersion, PhotoEffectsEngine.presets.contains(value.look.preset),
        value.look.intensity.isFinite, (0...1).contains(value.look.intensity),
        value.face.version == FaceGeometry.recipeVersion, FaceAccessory(rawValue: value.face.accessory) != nil else { throw Failure.invalidRecipe }
      if value.look.preset == "original" || value.look.intensity == 0 { value.look.preset = "original"; value.look.intensity = 0 }
      return value
    }
    public var canonicalJSON: String { get throws {
      let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
      return String(data: try encoder.encode(self), encoding: .utf8)!
    } }
    public var dictionary: [String: Any] { ["version": version, "order": order,
      "look": ["preset": look.preset, "intensity": look.intensity, "version": look.version],
      "face": ["accessory": face.accessory, "version": face.version]] }
  }
  public struct Output {
    public let uri: String; public let width, height: Int; public let recipe: Recipe
    public let originalSha256, outputSha256: String; public let isOriginal: Bool
    public let detectedFaceCount, landmarkedFaceCount: Int?; public let decoratedFaceCount: Int
    public let fallbackReason: String
    public var dictionary: [String: Any] { ["uri": uri, "width": width, "height": height, "recipe": recipe.dictionary,
      "originalSha256": originalSha256, "outputSha256": outputSha256, "isOriginal": isOriginal,
      "detectedFaceCount": detectedFaceCount.map { $0 as Any } ?? NSNull(),
      "landmarkedFaceCount": landmarkedFaceCount.map { $0 as Any } ?? NSNull(),
      "decoratedFaceCount": decoratedFaceCount, "fallbackReason": fallbackReason] }
  }
  public enum Failure: Error { case busy, cancelled, invalidInput, invalidRecipe, resourceLimit, processingFailed, sourceChanged }
  private static let admission = NSLock()
  private static var physicalOwner: UUID?
  private static let cacheLeasesLock = NSLock()
  private static var cacheLeases = [String: Int]()
  private let lock = NSLock(), workQueue: DispatchQueue
  private let worker = AppleFaceEffectsWorker()
  private let cache: URL, originalsDirectory: URL
  private let cacheLeaseKey: String?
  private let beforeAtomicCommit: ((URL) -> Void)?
  private var active: UUID?, cancelled = false
  private var completed = [UUID](), pendingCancellation = [UUID]()
  public convenience init(cacheDirectory: URL, originalsDirectory: URL) {
    self.init(cacheDirectory: cacheDirectory, originalsDirectory: originalsDirectory,
      workQueue: DispatchQueue(label: "wedding.photo.treatment", qos: .userInitiated))
  }
  /// Internal deterministic test seam; production owns a serial coordinator queue.
  init(cacheDirectory: URL, originalsDirectory: URL, workQueue: DispatchQueue, beforeAtomicCommit: ((URL) -> Void)? = nil) {
    self.workQueue = workQueue; self.originalsDirectory = originalsDirectory; self.beforeAtomicCommit = beforeAtomicCommit
    if cacheDirectory.isFileURL { try? FileManager.default.createDirectory(at: cacheDirectory, withIntermediateDirectories: true) }
    cache = cacheDirectory.standardizedFileURL.resolvingSymlinksInPath().standardizedFileURL
    // Canonical components collapse Darwin /var aliases and URL directory/trailing forms.
    cacheLeaseKey = cache.isFileURL ? cache.pathComponents.filter { $0 != "/" && !$0.isEmpty }.joined(separator: "/") : nil
    if let key = cacheLeaseKey {
      Self.cacheLeasesLock.lock()
      let previous = Self.cacheLeases[key] ?? 0
      Self.cacheLeases[key] = previous + 1
      // Only the first live engine may reap prior-process/module-lifetime orphans.
      // A non-rendering older engine can still own returned preview URIs.
      if previous == 0 {
        let files = (try? FileManager.default.contentsOfDirectory(at: cache, includingPropertiesForKeys: nil)) ?? []
        for file in files where Self.owned(file) { try? FileManager.default.removeItem(at: file) }
      }
      Self.cacheLeasesLock.unlock()
    }
  }
  deinit {
    if let key = cacheLeaseKey {
      Self.cacheLeasesLock.lock()
      let remaining = (Self.cacheLeases[key] ?? 1) - 1
      if remaining == 0 { Self.cacheLeases.removeValue(forKey: key) } else { Self.cacheLeases[key] = remaining }
      Self.cacheLeasesLock.unlock()
    }
  }
  private static func owned(_ url: URL) -> Bool {
    ["jpg", "tmp"].contains(url.pathExtension) && UUID(uuidString: url.deletingPathExtension().lastPathComponent) != nil
  }
  public func cancel(_ id: UUID) {
    lock.lock()
    if active == id { cancelled = true }
    else if !completed.contains(id), !pendingCancellation.contains(id) {
      pendingCancellation.append(id); if pendingCancellation.count > 512 { pendingCancellation.removeFirst() }
    }
    lock.unlock(); worker.cancel(id)
  }
  private func check(_ id: UUID) throws {
    lock.lock(); defer { lock.unlock() }
    guard active == id, !cancelled else { throw Failure.cancelled }
  }
  private func finish(_ id: UUID, result: Result<Output, Failure>, completion: @escaping (Result<Output, Failure>) -> Void) {
    lock.lock(); let stale = cancelled || active != id
    active = nil; cancelled = false; completed.append(id); if completed.count > 512 { completed.removeFirst() }; lock.unlock()
    if stale, case .success(let output) = result, !output.isOriginal, let url = URL(string: output.uri) { try? release(url) }
    Self.admission.lock(); if Self.physicalOwner == id { Self.physicalOwner = nil }; Self.admission.unlock()
    // Caller must still check its own editor ticket before UI/Apply admission; callbacks cannot be atomically revoked.
    completion(stale ? .failure(.cancelled) : result)
  }
  private func sourceURL(_ source: URL) throws -> URL {
    guard source.isFileURL, source.host == nil || source.host == "", source.query == nil, source.fragment == nil,
      !source.absoluteString.contains("%00"), source.lastPathComponent.range(of: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}(?:\\.draft)?\\.jpg$", options: .regularExpression) != nil,
      originalsDirectory.isFileURL else { throw Failure.invalidInput }
    let root = originalsDirectory.standardizedFileURL.resolvingSymlinksInPath().standardizedFileURL
    let resolved = source.standardizedFileURL.resolvingSymlinksInPath().standardizedFileURL
    guard resolved.deletingLastPathComponent().pathComponents == root.pathComponents,
      resolved.lastPathComponent == source.lastPathComponent,
      try FileManager.default.attributesOfItem(atPath: source.path)[.type] as? FileAttributeType == .typeRegular else { throw Failure.invalidInput }
    return resolved
  }
  public func render(source: URL, recipeJSON: String, id: UUID,
                     completion: @escaping (Result<Output, Failure>) -> Void) {
    Self.admission.lock()
    guard Self.physicalOwner == nil else { Self.admission.unlock(); completion(.failure(.busy)); return }
    Self.physicalOwner = id; Self.admission.unlock()
    lock.lock()
    if completed.contains(id) { lock.unlock(); Self.admission.lock(); Self.physicalOwner = nil; Self.admission.unlock(); completion(.failure(.invalidInput)); return }
    active = id; cancelled = pendingCancellation.contains(id); pendingCancellation.removeAll { $0 == id }; lock.unlock()
    workQueue.async { [self] in
      do { try autoreleasepool {
        try check(id)
        let originalURI = source.absoluteString
        let recipe = try Recipe.parse(recipeJSON), source = try sourceURL(source)
        let values = try source.resourceValues(forKeys: [.fileSizeKey])
        guard let bytes = values.fileSize, bytes > 0, bytes <= 64 * 1024 * 1024,
          let input = CGImageSourceCreateWithURL(source as CFURL, nil), CGImageSourceGetCount(input) == 1,
          let type = CGImageSourceGetType(input), (type as String) == UTType.jpeg.identifier,
          let props = CGImageSourceCopyPropertiesAtIndex(input, 0, nil) as? [String: Any],
          let w = props[kCGImagePropertyPixelWidth as String] as? NSNumber,
          let h = props[kCGImagePropertyPixelHeight as String] as? NSNumber else { throw Failure.invalidInput }
        let width = w.intValue, height = h.intValue
        guard width > 0, height > 0, width <= 24000, height <= 24000, width * height <= 24_000_000 else { throw Failure.resourceLimit }
        let orientation = (props[kCGImagePropertyOrientation as String] as? NSNumber)?.int32Value ?? 1
        guard (1...8).contains(orientation) else { throw Failure.invalidInput }
        let rootHash = try hashURL(source, id: id), outWidth = orientation >= 5 ? height : width, outHeight = orientation >= 5 ? width : height
        try check(id)
        if recipe.look.preset == "original", recipe.face.accessory == "none" {
          let output = Output(uri: originalURI, width: outWidth, height: outHeight, recipe: recipe,
            originalSha256: rootHash, outputSha256: rootHash, isOriginal: true, detectedFaceCount: nil,
            landmarkedFaceCount: nil, decoratedFaceCount: 0, fallbackReason: "none")
          finish(id, result: .success(output), completion: completion); return
        }
        _ = try cacheUsage()
        guard let decoded = CGImageSourceCreateImageAtIndex(input, 0, [kCGImageSourceShouldCache: false] as CFDictionary) else { throw Failure.invalidInput }
        let upright = CIImage(cgImage: decoded).oriented(forExifOrientation: orientation)
        let original = upright.transformed(by: CGAffineTransform(translationX: -upright.extent.minX, y: -upright.extent.minY))
        try check(id)
        let looked: CGImage = try PhotoEffectsEngine.queue.sync {
          let image = PhotoEffectsEngine.lookPixels(original, preset: recipe.look.preset, intensity: recipe.look.intensity)
          guard let cg = PhotoEffectsEngine.context.createCGImage(image, from: original.extent,
            format: .RGBA8, colorSpace: PhotoEffectsEngine.sRGB) else { throw Failure.processingFailed }; return cg
        }
        try check(id)
        if recipe.face.accessory == "none" {
          let result = try finalize(source: source, originalURI: originalURI, rootHash: rootHash, image: looked, jpeg: nil, recipe: recipe,
            detected: nil, landmarked: nil, decorated: 0, reason: "none", id: id)
          finish(id, result: .success(result), completion: completion); return
        }
        worker.process(uprightImage: looked, accessory: FaceAccessory(rawValue: recipe.face.accessory)!, requestID: id) { [self] faceResult in
          workQueue.async { [self] in
            do {
              try check(id)
              let faces = try faceResult.get()
              var effective = recipe
              if faces.placements.isEmpty { effective.face.accessory = "none" }
              let count = faces.placements.count, detected = faces.detectedFaceCount, landmarked = faces.landmarkedFaceCount
              let reason = count == 0 ? (detected == 0 ? "no-face" : "no-usable-face") : count < (detected ?? count) ? "partial" : "none"
              let output = try finalize(source: source, originalURI: originalURI, rootHash: rootHash, image: faces.image, jpeg: faces.jpegData, recipe: effective,
                detected: detected, landmarked: landmarked, decorated: count, reason: reason, id: id)
              finish(id, result: .success(output), completion: completion)
            } catch { finish(id, result: .failure((error as? Failure) ?? .processingFailed), completion: completion) }
          }
        }
        // Cover a cancellation racing the handoff into the native Vision worker.
        lock.lock(); let cancelNow = cancelled; lock.unlock(); if cancelNow { worker.cancel(id) }
      } } catch { finish(id, result: .failure((error as? Failure) ?? .processingFailed), completion: completion) }
    }
  }
  private func cacheUsage() throws -> Int {
    guard cache.isFileURL else { throw Failure.invalidInput }
    let files = try FileManager.default.contentsOfDirectory(at: cache, includingPropertiesForKeys: [.fileSizeKey])
    let used = try files.reduce(0) { try $0 + ($1.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0) }
    guard files.count < 48, used < 192 * 1024 * 1024 else { throw Failure.resourceLimit }; return used
  }
  private func finalize(source: URL, originalURI: String, rootHash: String, image: CGImage, jpeg: Data?, recipe: Recipe,
                        detected: Int?, landmarked: Int?, decorated: Int, reason: String, id: UUID) throws -> Output {
    try check(id)
    guard try hashURL(source, id: id) == rootHash else { throw Failure.sourceChanged }
    if recipe.look.preset == "original", recipe.face.accessory == "none" {
      return Output(uri: originalURI, width: image.width, height: image.height, recipe: recipe,
        originalSha256: rootHash, outputSha256: rootHash, isOriginal: true, detectedFaceCount: detected,
        landmarkedFaceCount: landmarked, decoratedFaceCount: decorated, fallbackReason: reason)
    }
    let used = try cacheUsage(), data: Data
    if let jpeg { data = jpeg } else {
      let buffer = NSMutableData()
      guard let destination = CGImageDestinationCreateWithData(buffer as CFMutableData, UTType.jpeg.identifier as CFString, 1, nil) else { throw Failure.processingFailed }
      CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: 0.95, kCGImagePropertyOrientation: 1] as CFDictionary)
      guard CGImageDestinationFinalize(destination) else { throw Failure.processingFailed }; data = buffer as Data
    }
    try check(id)
    guard used + data.count <= 256 * 1024 * 1024 else { throw Failure.resourceLimit }
    let outputHash = try hashData(data, id: id)
    let temporary = cache.appendingPathComponent(UUID().uuidString + ".tmp"), final = cache.appendingPathComponent(UUID().uuidString + ".jpg")
    defer { try? FileManager.default.removeItem(at: temporary) }
    try data.write(to: temporary, options: .withoutOverwriting); try check(id)
    beforeAtomicCommit?(temporary) // Internal test seam: work/self lease remains owned until acknowledgement.
    try check(id)
    try FileManager.default.moveItem(at: temporary, to: final)
    do { try check(id) } catch { try? FileManager.default.removeItem(at: final); throw error }
    return Output(uri: final.absoluteString, width: image.width, height: image.height, recipe: recipe,
      originalSha256: rootHash, outputSha256: outputHash, isOriginal: false, detectedFaceCount: detected,
      landmarkedFaceCount: landmarked, decoratedFaceCount: decorated, fallbackReason: reason)
  }
  private func hashURL(_ url: URL, id: UUID) throws -> String {
    let file = try FileHandle(forReadingFrom: url); defer { try? file.close() }; var hash = SHA256()
    while let data = try file.read(upToCount: 1024 * 1024), !data.isEmpty { try check(id); hash.update(data: data) }
    return hash.finalize().map { String(format: "%02x", $0) }.joined()
  }
  private func hashData(_ data: Data, id: UUID) throws -> String {
    var hash = SHA256()
    for start in stride(from: 0, to: data.count, by: 1024 * 1024) { try check(id); hash.update(data: data.subdata(in: start..<min(data.count, start + 1024 * 1024))) }
    return hash.finalize().map { String(format: "%02x", $0) }.joined()
  }
  public func release(_ url: URL) throws {
    guard url.isFileURL, url.host == nil || url.host == "", url.query == nil, url.fragment == nil,
      !url.absoluteString.contains("%00"), url.pathExtension == "jpg", Self.owned(url), cache.isFileURL else { throw Failure.invalidInput }
    let resolved = url.standardizedFileURL.resolvingSymlinksInPath().standardizedFileURL
    guard resolved.deletingLastPathComponent().pathComponents == cache.pathComponents,
      resolved.lastPathComponent == url.lastPathComponent else { throw Failure.invalidInput }
    if FileManager.default.fileExists(atPath: resolved.path) {
      guard try FileManager.default.attributesOfItem(atPath: url.path)[.type] as? FileAttributeType == .typeRegular else { throw Failure.invalidInput }
      try FileManager.default.removeItem(at: resolved)
    }
  }
}
