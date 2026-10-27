#if canImport(Vision) && canImport(CoreGraphics)
import Foundation
import CoreGraphics
import CoreImage
import ImageIO
import UniformTypeIdentifiers
import Vision

public enum AppleFaceEffectsError: Error { case busy, cancelled, invalidImage, unsupportedRevision, detectionFailed, encodingFailed, requiresBackground }
public struct AppleFaceEffectsOutput {
  public let image: CGImage
  /// Nil means unchanged input: there is deliberately no lossy re-encoding.
  public let jpegData: Data?
  public let placements: [AccessoryPlacement]
  public let visionRevision: Int?
  /// Ephemeral aggregate counts only; no face coordinates/identities are persisted by this prototype.
  public let detectedFaceCount: Int?, landmarkedFaceCount: Int?
  public init(image: CGImage, jpegData: Data?, placements: [AccessoryPlacement], visionRevision: Int?,
              detectedFaceCount: Int? = nil, landmarkedFaceCount: Int? = nil) {
    self.image = image; self.jpegData = jpegData; self.placements = placements; self.visionRevision = visionRevision
    self.detectedFaceCount = detectedFaceCount; self.landmarkedFaceCount = landmarkedFaceCount
  }
  public var unchanged: Bool { jpegData == nil }
}

/// Still-image prototype only. No camera, file I/O, Expo, UIKit, identity or network.
/// Caller supplies pixels ALREADY upright/unmirrored; no EXIF transform is performed here.
/// The caller MUST validate its current FrameFreshnessGate ticket at UI/save admission.
/// Cancellation cannot atomically revoke a callback after native work releases admission.
public final class AppleFaceEffectsWorker: @unchecked Sendable {
  public static let pinnedVisionRevision = 3
  private let queue: DispatchQueue
  private let lock = NSLock()
  private var activeID: UUID?
  private var cancelled = false
  private var request: VNRequest?
  public init() { queue = DispatchQueue(label: "wedding.face.still.prototype", qos: .userInitiated) }
  // Internal deterministic test seam; production always owns its serial worker queue.
  init(testQueue: DispatchQueue) { queue = testQueue }
  public func cancel(_ id: UUID) {
    lock.lock()
    let current = activeID == id ? request : nil
    if activeID == id { cancelled = true }
    lock.unlock(); current?.cancel()
  }
  public func process(uprightImage: CGImage, accessory: FaceAccessory, requestID: UUID = UUID(),
                      completion: @escaping (Result<AppleFaceEffectsOutput, AppleFaceEffectsError>) -> Void) {
    if accessory == .none {
      lock.lock(); cancelled = activeID != nil; let previous = request; lock.unlock(); previous?.cancel()
      completion(.success(AppleFaceEffectsOutput(image: uprightImage, jpegData: nil, placements: [], visionRevision: nil)))
      return
    }
    lock.lock()
    guard activeID == nil else { lock.unlock(); completion(.failure(.busy)); return }
    activeID = requestID; cancelled = false; lock.unlock()
    queue.async { [self] in
      let result: Result<AppleFaceEffectsOutput, AppleFaceEffectsError> = autoreleasepool {
        do {
          try check(requestID)
          guard uprightImage.width > 0, uprightImage.height > 0, uprightImage.width <= 24000,
            uprightImage.height <= 24000, uprightImage.width * uprightImage.height <= 24_000_000 else { throw AppleFaceEffectsError.invalidImage }
          guard VNDetectFaceLandmarksRequest.supportedRevisions.contains(Self.pinnedVisionRevision) else {
            throw AppleFaceEffectsError.unsupportedRevision
          }
          let detection = VNDetectFaceLandmarksRequest(); detection.revision = Self.pinnedVisionRevision
          // Public but deprecated API: bounded Mac CPU prototype, not a performance claim.
          detection.usesCPUOnly = true
          lock.lock(); request = detection; lock.unlock()
          try check(requestID)
          // Image is explicitly upright; applying EXIF here again would rotate twice.
          do { try VNImageRequestHandler(cgImage: uprightImage, orientation: .up, options: [:]).perform([detection]) }
          catch { try check(requestID); throw AppleFaceEffectsError.detectionFailed }
          try check(requestID)
          let observations = detection.results ?? []
          // Too many observations is a safe no-effect outcome, never silently ignore neighbors.
          guard observations.count <= 64 else {
            return .success(AppleFaceEffectsOutput(image: uprightImage, jpegData: nil, placements: [], visionRevision: Self.pinnedVisionRevision,
              detectedFaceCount: observations.count, landmarkedFaceCount: 0))
          }
          var anchors = [FaceAnchors](), obstructingBounds = [UnitRect]()
          for observation in observations {
            let box = observation.boundingBox
            let raw = UnitRect(x: Double(box.minX), y: Double(box.minY), width: Double(box.width), height: Double(box.height))
            let uprightBounds = UnitRect(x: raw.x, y: 1 - raw.y - raw.height, width: raw.width, height: raw.height)
            func points(_ region: VNFaceLandmarkRegion2D) -> [UnitPoint] {
              guard region.pointCount <= 128 else { return [] }
              return (0..<region.pointCount).map { let p = region.normalizedPoints[$0]; return UnitPoint(x: Double(p.x), y: Double(p.y)) }
            }
            if let left = observation.landmarks?.leftEye, let right = observation.landmarks?.rightEye,
              let face = FaceGeometry.fromVision(bounds: raw, leftEye: points(left), rightEye: points(right),
                confidence: Double(observation.confidence)) {
              anchors.append(face)
            } else if uprightBounds.valid {
              // A detected face without usable eyes is still protected from someone else's art.
              obstructingBounds.append(uprightBounds)
            }
          }
          let placements = FaceGeometry.placements(faces: anchors,
            image: ImageSize(width: Double(uprightImage.width), height: Double(uprightImage.height)),
            accessory: accessory, obstructingBounds: obstructingBounds)
          try check(requestID)
          if placements.isEmpty {
            return .success(AppleFaceEffectsOutput(image: uprightImage, jpegData: nil, placements: [], visionRevision: Self.pinnedVisionRevision,
              detectedFaceCount: observations.count, landmarkedFaceCount: anchors.count))
          }
          let rendered = try Self.renderPlacements(uprightImage: uprightImage, placements: placements)
          try check(requestID)
          return .success(AppleFaceEffectsOutput(image: rendered.image, jpegData: rendered.jpegData,
            placements: placements, visionRevision: Self.pinnedVisionRevision,
            detectedFaceCount: observations.count, landmarkedFaceCount: anchors.count))
        } catch let error as AppleFaceEffectsError { return .failure(error) }
        catch {
          lock.lock(); let wasCancelled = cancelled; lock.unlock()
          return .failure(wasCancelled ? .cancelled : .encodingFailed)
        }
      }
      // Keep admission owned until native work actually completed, including cancellation.
      lock.lock()
      let stale = cancelled || activeID != requestID
      request = nil; activeID = nil; cancelled = false
      lock.unlock()
      completion(stale ? .failure(.cancelled) : result)
    }
  }
  private func check(_ id: UUID) throws {
    lock.lock(); defer { lock.unlock() }
    if cancelled || activeID != id { throw AppleFaceEffectsError.cancelled }
  }
  /// Controlled-anchor renderer for tests/future adapters. Must run off main.
  /// No source metadata is accepted; a fresh JPEG destination receives orientation1 only.
  public static func renderPlacements(uprightImage: CGImage, placements: [AccessoryPlacement]) throws -> AppleFaceEffectsOutput {
    guard !Thread.isMainThread else { throw AppleFaceEffectsError.requiresBackground }
    guard placements.count <= FaceGeometry.maximumFaces, placements.allSatisfy({ $0.finite && $0.accessory != .none }),
      uprightImage.width > 0, uprightImage.height > 0, uprightImage.width <= 24000, uprightImage.height <= 24000,
      uprightImage.width * uprightImage.height <= 24_000_000 else { throw AppleFaceEffectsError.invalidImage }
    if placements.isEmpty { return AppleFaceEffectsOutput(image: uprightImage, jpegData: nil, placements: [], visionRevision: nil) }
    let width = uprightImage.width, height = uprightImage.height
    let color = CGColorSpace(name: CGColorSpace.sRGB)!
    guard let canvas = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
      space: color, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { throw AppleFaceEffectsError.encodingFailed }
    canvas.setFillColor(CGColor(gray: 1, alpha: 1)); canvas.fill(CGRect(x: 0, y: 0, width: CGFloat(width), height: CGFloat(height)))
    canvas.draw(uprightImage, in: CGRect(x: 0, y: 0, width: CGFloat(width), height: CGFloat(height)))
    // Vectors use the same top-left/upright placement coordinates as FaceGeometry.
    canvas.translateBy(x: 0, y: CGFloat(height)); canvas.scaleBy(x: 1, y: -1)
    for placement in placements {
      canvas.saveGState()
      // Intersect one outside-of-hole clip at a time in global TOP-LEFT image coordinates.
      // A single even-odd path containing all holes would re-include overlapping exclusions.
      for excluded in placement.excludedFaceBounds {
        let x = floor(excluded.x * Double(width)), y = floor(excluded.y * Double(height))
        let right = ceil((excluded.x + excluded.width) * Double(width))
        let bottom = ceil((excluded.y + excluded.height) * Double(height))
        canvas.beginPath()
        canvas.addRect(CGRect(x: 0, y: 0, width: CGFloat(width), height: CGFloat(height)))
        canvas.addRect(CGRect(x: CGFloat(x), y: CGFloat(y), width: CGFloat(right - x), height: CGFloat(bottom - y)))
        canvas.clip(using: .evenOdd)
      }
      canvas.translateBy(x: CGFloat(placement.center.x * Double(width)), y: CGFloat(placement.center.y * Double(height)))
      canvas.rotate(by: CGFloat(placement.rotation))
      canvas.scaleBy(x: CGFloat(placement.width * Double(width)), y: CGFloat(placement.height * Double(height)))
      canvas.setLineWidth(0.0275); canvas.setLineJoin(.round); canvas.setLineCap(.round)
      switch placement.accessory {
      case .none: break
      case .glasses:
        // Whole width is 2*d: local lens centers +/-0.25 land on the actual eyes +/-0.5*d.
        canvas.setStrokeColor(CGColor(red: 0.19, green: 0.13, blue: 0.11, alpha: 1))
        canvas.strokeEllipse(in: CGRect(x: -0.42, y: -0.45, width: 0.34, height: 0.90))
        canvas.strokeEllipse(in: CGRect(x: 0.08, y: -0.45, width: 0.34, height: 0.90))
        canvas.move(to: CGPoint(x: -0.08, y: -0.05)); canvas.addQuadCurve(to: CGPoint(x: 0.08, y: -0.05), control: CGPoint(x: 0, y: -0.18))
        canvas.move(to: CGPoint(x: -0.49, y: -0.13)); canvas.addLine(to: CGPoint(x: -0.42, y: -0.08))
        canvas.move(to: CGPoint(x: 0.42, y: -0.08)); canvas.addLine(to: CGPoint(x: 0.49, y: -0.13)); canvas.strokePath()
      case .crown:
        // Symmetric scalloped diadem: smooth circlet, thin gold base, three small round pearls.
        let gold = CGColor(red: 0.79, green: 0.60, blue: 0.25, alpha: 1)
        canvas.setStrokeColor(gold); canvas.setLineWidth(0.065)
        canvas.move(to: CGPoint(x: -0.45, y: 0.27))
        canvas.addQuadCurve(to: CGPoint(x: 0, y: 0.34), control: CGPoint(x: -0.23, y: 0.36))
        canvas.addQuadCurve(to: CGPoint(x: 0.45, y: 0.27), control: CGPoint(x: 0.23, y: 0.36)); canvas.strokePath()
        canvas.setLineWidth(0.035)
        canvas.move(to: CGPoint(x: -0.45, y: 0.27))
        canvas.addCurve(to: CGPoint(x: -0.27, y: -0.08), control1: CGPoint(x: -0.44, y: 0.09), control2: CGPoint(x: -0.39, y: -0.13))
        canvas.addCurve(to: CGPoint(x: 0, y: -0.29), control1: CGPoint(x: -0.17, y: 0.02), control2: CGPoint(x: -0.16, y: -0.29))
        canvas.addCurve(to: CGPoint(x: 0.27, y: -0.08), control1: CGPoint(x: 0.16, y: -0.29), control2: CGPoint(x: 0.17, y: 0.02))
        canvas.addCurve(to: CGPoint(x: 0.45, y: 0.27), control1: CGPoint(x: 0.39, y: -0.13), control2: CGPoint(x: 0.44, y: 0.09)); canvas.strokePath()
        // Counter-scale each circle so the non-square accessory transform does not squash physical pearls.
        let pearlYRadius: CGFloat = 0.038
        canvas.setFillColor(CGColor(red: 0.97, green: 0.94, blue: 0.85, alpha: 1))
        canvas.setLineWidth(0.016)
        for center in [CGPoint(x: -0.27, y: -0.11), CGPoint(x: 0, y: -0.33), CGPoint(x: 0.27, y: -0.11)] {
          canvas.saveGState(); canvas.translateBy(x: center.x, y: center.y)
          canvas.scaleBy(x: CGFloat((placement.height * Double(height)) / (placement.width * Double(width))), y: 1)
          canvas.addEllipse(in: CGRect(x: -pearlYRadius, y: -pearlYRadius,
            width: pearlYRadius * 2, height: pearlYRadius * 2)); canvas.drawPath(using: .fillStroke)
          canvas.restoreGState()
        }
      case .hearts:
        canvas.setFillColor(CGColor(red: 0.78, green: 0.27, blue: 0.36, alpha: 1))
        for x in [CGFloat(-0.30), CGFloat(0), CGFloat(0.30)] {
          canvas.move(to: CGPoint(x: x, y: 0.28))
          canvas.addCurve(to: CGPoint(x: x - 0.11, y: -0.06), control1: CGPoint(x: x - 0.02, y: 0.14), control2: CGPoint(x: x - 0.16, y: 0.02))
          canvas.addCurve(to: CGPoint(x: x, y: -0.12), control1: CGPoint(x: x - 0.12, y: -0.27), control2: CGPoint(x: x - 0.03, y: -0.25))
          canvas.addCurve(to: CGPoint(x: x + 0.11, y: -0.06), control1: CGPoint(x: x + 0.03, y: -0.25), control2: CGPoint(x: x + 0.12, y: -0.27))
          canvas.addCurve(to: CGPoint(x: x, y: 0.28), control1: CGPoint(x: x + 0.16, y: 0.02), control2: CGPoint(x: x + 0.02, y: 0.14)); canvas.closePath(); canvas.fillPath()
        }
      }
      canvas.restoreGState()
    }
    guard let output = canvas.makeImage() else { throw AppleFaceEffectsError.encodingFailed }
    let bytes = NSMutableData()
    guard let destination = CGImageDestinationCreateWithData(bytes as CFMutableData, UTType.jpeg.identifier as CFString, 1, nil) else { throw AppleFaceEffectsError.encodingFailed }
    CGImageDestinationAddImage(destination, output, [kCGImageDestinationLossyCompressionQuality: 0.95, kCGImagePropertyOrientation: 1] as CFDictionary)
    guard CGImageDestinationFinalize(destination) else { throw AppleFaceEffectsError.encodingFailed }
    return AppleFaceEffectsOutput(image: output, jpegData: bytes as Data, placements: placements, visionRevision: nil)
  }
}
#endif
