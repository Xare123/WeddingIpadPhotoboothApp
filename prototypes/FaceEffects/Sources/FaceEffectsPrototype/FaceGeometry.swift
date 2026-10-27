import Foundation

public enum FaceAccessory: String, Sendable { case none, glasses, crown, hearts }

/// Upright, unmirrored image coordinates: [0,1], origin at the top left.
/// These ephemeral values are neither identity descriptors nor persistence data.
public struct UnitPoint: Equatable, Sendable {
  public let x: Double, y: Double
  public init(x: Double, y: Double) { self.x = x; self.y = y }
  public var valid: Bool { x.isFinite && y.isFinite && (0...1).contains(x) && (0...1).contains(y) }
}
public struct UnitRect: Equatable, Sendable {
  public let x: Double, y: Double, width: Double, height: Double
  public init(x: Double, y: Double, width: Double, height: Double) {
    self.x = x; self.y = y; self.width = width; self.height = height
  }
  public var valid: Bool {
    [x, y, width, height].allSatisfy(\.isFinite) && x >= 0 && y >= 0 && width > 0 && height > 0
      && x + width <= 1.000001 && y + height <= 1.000001
  }
  public func contains(_ p: UnitPoint) -> Bool {
    p.valid && p.x >= x && p.y >= y && p.x <= x + width && p.y <= y + height
  }
}
public struct ImageSize: Equatable, Sendable {
  public let width: Double, height: Double
  public init(width: Double, height: Double) { self.width = width; self.height = height }
  public var valid: Bool { width.isFinite && height.isFinite && width > 0 && height > 0 && width <= 24000 && height <= 24000 }
}
public struct FaceAnchors: Equatable, Sendable {
  public let bounds: UnitRect, leftEye: UnitPoint, rightEye: UnitPoint
  public let confidence: Double
  public init(bounds: UnitRect, leftEye: UnitPoint, rightEye: UnitPoint, confidence: Double) {
    self.bounds = bounds; self.leftEye = leftEye; self.rightEye = rightEye; self.confidence = confidence
  }
}
public struct AccessoryPlacement: Equatable, Sendable {
  public let accessory: FaceAccessory, center: UnitPoint
  public let width: Double, height: Double, rotation: Double
  public init(accessory: FaceAccessory, center: UnitPoint, width: Double, height: Double, rotation: Double) {
    self.accessory = accessory; self.center = center; self.width = width; self.height = height; self.rotation = rotation
  }
  /// Centers may lie outside the source at a forehead edge; the renderer clips to the image.
  public var finite: Bool {
    [center.x, center.y, width, height, rotation].allSatisfy(\.isFinite) && width > 0 && height > 0
      && width <= 3 && height <= 3 && abs(center.x) <= 3 && abs(center.y) <= 3 && abs(rotation) <= .pi
  }
}
public struct PixelPoint: Equatable, Sendable {
  public let x: Double, y: Double
}

public enum FaceGeometry {
  public static let recipeVersion = "wedding-face-prototype-v1"
  public static let maximumFaces = 6

  /// Vision supplies bottom-left face bounds and face-local landmark points.
  /// Convert once; callers must already normalize the image's EXIF orientation.
  public static func fromVision(bounds: UnitRect, leftEye: [UnitPoint], rightEye: [UnitPoint],
                                confidence: Double) -> FaceAnchors? {
    guard bounds.valid, confidence.isFinite, (0...1).contains(confidence),
      !leftEye.isEmpty, !rightEye.isEmpty, leftEye.count <= 128, rightEye.count <= 128,
      leftEye.allSatisfy(\.valid), rightEye.allSatisfy(\.valid) else { return nil }
    func center(_ points: [UnitPoint]) -> UnitPoint {
      let x = points.reduce(0) { $0 + $1.x } / Double(points.count)
      let y = points.reduce(0) { $0 + $1.y } / Double(points.count)
      return UnitPoint(x: bounds.x + x * bounds.width, y: 1 - (bounds.y + y * bounds.height))
    }
    return FaceAnchors(bounds: UnitRect(x: bounds.x, y: 1 - bounds.y - bounds.height,
      width: bounds.width, height: bounds.height), leftEye: center(leftEye), rightEye: center(rightEye), confidence: confidence)
  }

  public static func placements(faces: [FaceAnchors], image: ImageSize, accessory: FaceAccessory,
                                maximum: Int = maximumFaces) -> [AccessoryPlacement] {
    guard accessory != .none, image.valid, faces.count <= 64, (1...maximumFaces).contains(maximum) else { return [] }
    return faces.enumerated().filter { _, face in
      face.bounds.valid && face.confidence.isFinite && (0.5...1).contains(face.confidence)
    }.sorted {
      let a = $0.element.bounds.width * $0.element.bounds.height, b = $1.element.bounds.width * $1.element.bounds.height
      return a == b ? $0.offset < $1.offset : a > b
    }.compactMap { _, face -> AccessoryPlacement? in
      guard face.bounds.valid, face.confidence.isFinite, (0.5...1).contains(face.confidence),
        face.bounds.width >= 0.035, face.bounds.contains(face.leftEye), face.bounds.contains(face.rightEye) else { return nil }
      let first = face.leftEye.x <= face.rightEye.x ? face.leftEye : face.rightEye
      let second = face.leftEye.x <= face.rightEye.x ? face.rightEye : face.leftEye
      let dx = (second.x - first.x) * image.width, dy = (second.y - first.y) * image.height
      let distance = hypot(dx, dy), angle = atan2(dy, dx)
      guard distance >= max(4, image.width * 0.008), distance <= face.bounds.width * image.width * 0.9,
        angle.isFinite, abs(angle) <= .pi / 3 else { return nil }
      let x = (first.x + second.x) / 2, y = (first.y + second.y) / 2
      let geometry: (Double, Double, Double)
      switch accessory {
      case .none: return nil
      case .glasses: geometry = (2.4, 0.72, 0)
      case .crown: geometry = (2.65, 1.05, -1.05)
      case .hearts: geometry = (2.8, 1.1, -1.15)
      }
      // Offset along the local face's vertical axis, not the screen's vertical.
      let offset = geometry.2 * distance
      let placement = AccessoryPlacement(accessory: accessory,
        center: UnitPoint(x: x - sin(angle) * offset / image.width,
                          y: y + cos(angle) * offset / image.height),
        width: geometry.0 * distance / image.width, height: geometry.1 * distance / image.height, rotation: angle)
      return placement.finite ? placement : nil
    }.prefix(maximum).map { $0 }
  }

  /// Aspect-fill preview positioning only. It does not widen FOV or crop originals.
  public static func previewPoint(_ point: UnitPoint, image: ImageSize, viewport: ImageSize,
                                  mirrored: Bool) -> PixelPoint? {
    guard point.valid, image.valid, viewport.valid else { return nil }
    let scale = max(viewport.width / image.width, viewport.height / image.height)
    let x = mirrored ? 1 - point.x : point.x
    return PixelPoint(x: x * image.width * scale + (viewport.width - image.width * scale) / 2,
      y: point.y * image.height * scale + (viewport.height - image.height * scale) / 2)
  }
}
