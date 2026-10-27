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
  /// Ephemeral, upright face exclusions; never persisted as identity data.
  public let excludedFaceBounds: [UnitRect]
  public init(accessory: FaceAccessory, center: UnitPoint, width: Double, height: Double, rotation: Double, excludedFaceBounds: [UnitRect] = []) {
    self.excludedFaceBounds = excludedFaceBounds
    self.accessory = accessory; self.center = center; self.width = width; self.height = height; self.rotation = rotation
  }
  /// Centers may lie outside the source at a forehead edge; the renderer clips to the image.
  public var finite: Bool {
    [center.x, center.y, width, height, rotation].allSatisfy(\.isFinite) && width > 0 && height > 0
      && width <= 3 && height <= 3 && abs(center.x) <= 3 && abs(center.y) <= 3 && abs(rotation) <= .pi
      && excludedFaceBounds.count <= 64 && excludedFaceBounds.allSatisfy(\.valid)
  }
}
public struct PixelPoint: Equatable, Sendable {
  public let x: Double, y: Double
}

public enum FaceGeometry {
  public static let recipeVersion = "wedding-face-prototype-v3"
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
                                maximum: Int = maximumFaces, obstructingBounds: [UnitRect] = []) -> [AccessoryPlacement] {
    guard accessory != .none, image.valid, faces.count <= 64, obstructingBounds.count <= 64,
      obstructingBounds.allSatisfy(\.valid), (1...maximumFaces).contains(maximum) else { return [] }
    let eligible = faces.enumerated().filter { _, face in
      face.bounds.valid && face.confidence.isFinite && (0.5...1).contains(face.confidence)
    }
    // A detector confidence/landmark rejection must not erase another face's
    // protective rectangle. Only decoration admission uses the confidence gate.
    let protective = faces.enumerated().filter { $0.element.bounds.valid }
    var accepted: [AccessoryPlacement] = [], envelopes: [[PixelPoint]] = []
    let ranked = eligible.sorted {
      let a = $0.element.bounds.width * $0.element.bounds.height, b = $1.element.bounds.width * $1.element.bounds.height
      return a == b ? $0.offset < $1.offset : a > b
    }
    for (index, face) in ranked {
      guard face.bounds.valid, face.confidence.isFinite, (0.5...1).contains(face.confidence),
        face.bounds.width >= 0.035, face.bounds.contains(face.leftEye), face.bounds.contains(face.rightEye) else { continue }
      let first = face.leftEye.x <= face.rightEye.x ? face.leftEye : face.rightEye
      let second = face.leftEye.x <= face.rightEye.x ? face.rightEye : face.leftEye
      let dx = (second.x - first.x) * image.width, dy = (second.y - first.y) * image.height
      let distance = hypot(dx, dy), angle = atan2(dy, dx)
      guard distance >= max(4, image.width * 0.008), distance <= face.bounds.width * image.width * 0.9,
        angle.isFinite, abs(angle) <= .pi / 3 else { continue }
      let x = (first.x + second.x) / 2, y = (first.y + second.y) / 2
      let geometry: (Double, Double, Double)
      switch accessory {
      case .none: continue
      case .glasses: geometry = (2.0, 0.60, 0)
      case .crown: geometry = (1.72, 0.50, -1.40)
      case .hearts: geometry = (1.70, 0.48, -1.35)
      }
      // Fixed maximum six poses for forehead ornaments; glasses remain eye-locked.
      let alternatives: [(lift: Double, scale: Double)] = accessory == .glasses ? [(0, 1)]
        : [(0, 1), (0.25, 1), (0.50, 1), (0, 0.90), (0.25, 0.90), (0.50, 0.90)]
      for alternative in alternatives {
        // Lift along the local head normal; scale only the ornament, never the eyes.
        let offset = (geometry.2 - alternative.lift) * distance
        let placement = AccessoryPlacement(accessory: accessory,
          center: UnitPoint(x: x - sin(angle) * offset / image.width,
                            y: y + cos(angle) * offset / image.height),
          width: alternative.scale * geometry.0 * distance / image.width, height: alternative.scale * geometry.1 * distance / image.height, rotation: angle)
        guard placement.finite else { continue }
        let box = envelope(placement, image: image)
        guard box.allSatisfy({ $0.x >= 0 && $0.y >= 0 && $0.x <= image.width && $0.y <= image.height }) else { continue }
        // All other valid face rectangles protect even low-confidence/invalid eyes.
        // Own bounds are excluded by input index, not rectangle equality.
        let padding = 0.035 * distance
        guard !obstructingBounds.contains(where: { overlaps(box, rectangle($0, image: image, padding: padding)) }),
          !envelopes.contains(where: { overlaps(box, $0) }) else { continue }
        var exclusions: [UnitRect] = [], blocked = false
        for neighbor in protective where neighbor.offset != index {
          let bounds = neighbor.element.bounds, padded = rectangle(bounds, image: image, padding: padding)
          if !overlaps(box, padded) { continue }
          // Only trim an exterior glasses temple when both own eye cores are
          // untouched and the neighbor has reliable full eye geometry. Every
          // rejected/low-confidence neighbor remains a full obstruction.
          guard accessory == .glasses, reliableEyes(face, image: image), reliableEyes(neighbor.element, image: image),
            !overlaps(eyeCore(first, image: image, halfSize: 0.20 * distance), padded),
            !overlaps(eyeCore(second, image: image, halfSize: 0.20 * distance), padded) else { blocked = true; break }
          let left = max(0, bounds.x - padding / image.width), top = max(0, bounds.y - padding / image.height)
          let right = min(1, bounds.x + bounds.width + padding / image.width)
          let bottom = min(1, bounds.y + bounds.height + padding / image.height)
          exclusions.append(UnitRect(x: left, y: top, width: right - left, height: bottom - top))
        }
        if blocked { continue }
        let safe = AccessoryPlacement(accessory: placement.accessory, center: placement.center, width: placement.width,
          height: placement.height, rotation: placement.rotation, excludedFaceBounds: exclusions)
        guard safe.finite else { continue }
        accepted.append(safe); envelopes.append(box)
        break // First safe candidate wins; never float an already-safe baseline.
      }
      if accepted.count == maximum { break }
    }
    return accepted
  }

  private static func reliableEyes(_ face: FaceAnchors, image: ImageSize) -> Bool {
    guard face.bounds.valid, face.bounds.width >= 0.035, face.confidence.isFinite, (0.8...1).contains(face.confidence),
      face.bounds.contains(face.leftEye), face.bounds.contains(face.rightEye) else { return false }
    let first = face.leftEye.x <= face.rightEye.x ? face.leftEye : face.rightEye
    let second = face.leftEye.x <= face.rightEye.x ? face.rightEye : face.leftEye
    let dx = (second.x - first.x) * image.width, dy = (second.y - first.y) * image.height
    let distance = hypot(dx, dy), angle = atan2(dy, dx)
    return distance >= max(4, image.width * 0.008) && distance <= face.bounds.width * image.width * 0.9
      && angle.isFinite && abs(angle) <= .pi / 3
  }
  private static func eyeCore(_ point: UnitPoint, image: ImageSize, halfSize: Double) -> [PixelPoint] {
    let x = point.x * image.width, y = point.y * image.height
    return [PixelPoint(x: x - halfSize, y: y - halfSize), PixelPoint(x: x + halfSize, y: y - halfSize),
      PixelPoint(x: x + halfSize, y: y + halfSize), PixelPoint(x: x - halfSize, y: y + halfSize)]
  }

  /// Conservative artwork/stroke envelope, not face segmentation or depth occlusion.
  private static func envelope(_ placement: AccessoryPlacement, image: ImageSize) -> [PixelPoint] {
    let c = cos(placement.rotation), s = sin(placement.rotation)
    return [(-0.515, -0.515), (0.515, -0.515), (0.515, 0.515), (-0.515, 0.515)].map { corner in
      let x = corner.0 * placement.width * image.width, y = corner.1 * placement.height * image.height
      return PixelPoint(x: placement.center.x * image.width + c * x - s * y,
        y: placement.center.y * image.height + s * x + c * y)
    }
  }
  private static func rectangle(_ bounds: UnitRect, image: ImageSize, padding: Double) -> [PixelPoint] {
    let x = bounds.x * image.width - padding, y = bounds.y * image.height - padding
    let right = (bounds.x + bounds.width) * image.width + padding
    let bottom = (bounds.y + bounds.height) * image.height + padding
    return [PixelPoint(x: x, y: y), PixelPoint(x: right, y: y), PixelPoint(x: right, y: bottom), PixelPoint(x: x, y: bottom)]
  }
  /// Separating-axis test in physical pixel coordinates; touching is suppressed.
  private static func overlaps(_ first: [PixelPoint], _ second: [PixelPoint]) -> Bool {
    for polygon in [first, second] {
      for index in 0..<4 {
        let a = polygon[index], b = polygon[(index + 1) % 4]
        let nx = -(b.y - a.y), ny = b.x - a.x
        let one = first.map { $0.x * nx + $0.y * ny }, two = second.map { $0.x * nx + $0.y * ny }
        if one.max()! < two.min()! || two.max()! < one.min()! { return false }
      }
    }
    return true
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
