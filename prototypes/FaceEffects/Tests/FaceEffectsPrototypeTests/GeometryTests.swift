import XCTest
@testable import FaceEffectsPrototype

/// Pure geometry regressions only; no camera, Vision detector or live rendering.
final class GeometryTests: XCTestCase {
  private let image = ImageSize(width: 1000, height: 500)
  private func face(_ x: Double = 0.1, width: Double = 0.8, confidence: Double = 1,
                    left: UnitPoint = UnitPoint(x: 0.3, y: 0.3),
                    right: UnitPoint = UnitPoint(x: 0.6, y: 0.5)) -> FaceAnchors {
    FaceAnchors(bounds: UnitRect(x: x, y: 0.1, width: width, height: 0.8),
      leftEye: left, rightEye: right, confidence: confidence)
  }
  func testVisionLocalBottomLeftConvertsOnceToUprightTopLeft() throws {
    let converted = try XCTUnwrap(FaceGeometry.fromVision(
      bounds: UnitRect(x: 0.2, y: 0.1, width: 0.5, height: 0.6),
      leftEye: [UnitPoint(x: 0.2, y: 0.4), UnitPoint(x: 0.4, y: 0.6)],
      rightEye: [UnitPoint(x: 0.7, y: 0.4), UnitPoint(x: 0.9, y: 0.6)], confidence: 0.8))
    XCTAssertEqual(converted.bounds.x, 0.2, accuracy: 1e-12)
    XCTAssertEqual(converted.bounds.y, 0.3, accuracy: 1e-12)
    XCTAssertEqual(converted.bounds.width, 0.5); XCTAssertEqual(converted.bounds.height, 0.6)
    XCTAssertEqual(converted.leftEye.x, 0.35, accuracy: 1e-12)
    XCTAssertEqual(converted.leftEye.y, 0.6, accuracy: 1e-12)
    XCTAssertEqual(converted.rightEye.x, 0.6, accuracy: 1e-12)
    XCTAssertEqual(converted.rightEye.y, 0.6, accuracy: 1e-12)
    XCTAssertEqual(converted.confidence, 0.8)
  }
  func testVisionRejectsInvalidBoundsNonfiniteConfidenceAndPoints() {
    let good = UnitRect(x: 0.1, y: 0.1, width: 0.8, height: 0.8)
    let eye = [UnitPoint(x: 0.3, y: 0.6)]
    for bounds in [UnitRect(x: -0.1, y: 0, width: 0.5, height: 0.5),
      UnitRect(x: 0, y: 0, width: 0, height: 0.5), UnitRect(x: 0.6, y: 0, width: 0.5, height: 0.5),
      UnitRect(x: .nan, y: 0, width: 0.5, height: 0.5), UnitRect(x: 0, y: 0, width: 0.5, height: .infinity)] {
      XCTAssertNil(FaceGeometry.fromVision(bounds: bounds, leftEye: eye, rightEye: eye, confidence: 1))
    }
    for confidence in [Double.nan, .infinity, -0.1, 1.1] {
      XCTAssertNil(FaceGeometry.fromVision(bounds: good, leftEye: eye, rightEye: eye, confidence: confidence))
    }
    for point in [UnitPoint(x: .nan, y: 0.5), UnitPoint(x: 0.5, y: .infinity), UnitPoint(x: -0.1, y: 0.5), UnitPoint(x: 0.5, y: 1.1)] {
      XCTAssertNil(FaceGeometry.fromVision(bounds: good, leftEye: [point], rightEye: eye, confidence: 1))
      XCTAssertNil(FaceGeometry.fromVision(bounds: good, leftEye: eye, rightEye: [point], confidence: 1))
    }
  }
  func testVisionMissingOrOversizedEyeLandmarksFailClosed() {
    let bounds = UnitRect(x: 0.1, y: 0.1, width: 0.8, height: 0.8), eye = [UnitPoint(x: 0.5, y: 0.5)]
    XCTAssertNil(FaceGeometry.fromVision(bounds: bounds, leftEye: [], rightEye: eye, confidence: 1))
    XCTAssertNil(FaceGeometry.fromVision(bounds: bounds, leftEye: eye, rightEye: [], confidence: 1))
    XCTAssertNotNil(FaceGeometry.fromVision(bounds: bounds, leftEye: Array(repeating: eye[0], count: 128), rightEye: eye, confidence: 1))
    XCTAssertNil(FaceGeometry.fromVision(bounds: bounds, leftEye: Array(repeating: eye[0], count: 129), rightEye: eye, confidence: 1))
    XCTAssertNil(FaceGeometry.fromVision(bounds: bounds, leftEye: eye, rightEye: Array(repeating: eye[0], count: 129), confidence: 1))
  }
  func testNonsquarePixelsDetermineRollAndPhysicalAccessoryDimensions() throws {
    // Eye displacement is 300px right, 100px down: not the unit-space 3:2 angle.
    let result = try XCTUnwrap(FaceGeometry.placements(faces: [face()], image: image, accessory: .glasses).first)
    XCTAssertEqual(result.rotation, atan(1.0 / 3.0), accuracy: 1e-12)
    XCTAssertEqual(result.center.x, 0.45, accuracy: 1e-12); XCTAssertEqual(result.center.y, 0.4, accuracy: 1e-12)
    XCTAssertEqual(result.width * 1000, 2.4 * sqrt(100000.0), accuracy: 1e-9)
    XCTAssertEqual(result.height * 500, 0.72 * sqrt(100000.0), accuracy: 1e-9)
    XCTAssertEqual(result.width * 1000 / (result.height * 500), 2.4 / 0.72, accuracy: 1e-12)
  }
  func testCrownAndHeartsOffsetAlongRolledFaceAxisInPixelSpace() throws {
    let crown = try XCTUnwrap(FaceGeometry.placements(faces: [face()], image: image, accessory: .crown).first)
    XCTAssertEqual(crown.center.x, 0.555, accuracy: 1e-12)
    XCTAssertEqual(crown.center.y, -0.23, accuracy: 1e-12)
    XCTAssertTrue(crown.finite) // Forehead accessories may extend beyond the image.
    let hearts = try XCTUnwrap(FaceGeometry.placements(faces: [face()], image: image, accessory: .hearts).first)
    XCTAssertEqual(hearts.center.x, 0.565, accuracy: 1e-12)
    XCTAssertEqual(hearts.center.y, -0.29, accuracy: 1e-12)
  }
  func testAnatomicalEyeOrderingDoesNotIntroducePiRotationOrMirroring() {
    let original = face(), swapped = face(left: original.rightEye, right: original.leftEye)
    for accessory in [FaceAccessory.glasses, .crown, .hearts] {
      XCTAssertEqual(FaceGeometry.placements(faces: [original], image: image, accessory: accessory),
        FaceGeometry.placements(faces: [swapped], image: image, accessory: accessory))
    }
  }
  func testNoneNoEyesProfileSmallAndLowConfidenceFallBackWithoutOverlay() {
    XCTAssertTrue(FaceGeometry.placements(faces: [face()], image: image, accessory: .none).isEmpty)
    XCTAssertTrue(FaceGeometry.placements(faces: [], image: image, accessory: .glasses).isEmpty)
    for candidate in [face(confidence: 0.499), face(confidence: .nan), face(confidence: 1.1),
      face(left: UnitPoint(x: 0.3, y: 0.3), right: UnitPoint(x: 0.3, y: 0.3)),
      face(left: UnitPoint(x: 0.4, y: 0.2), right: UnitPoint(x: 0.41, y: 0.8)),
      face(left: UnitPoint(x: 0, y: 0.3)),
      face(0.1, width: 0.02, left: UnitPoint(x: 0.105, y: 0.3), right: UnitPoint(x: 0.115, y: 0.3))] {
      XCTAssertTrue(FaceGeometry.placements(faces: [candidate], image: image, accessory: .glasses).isEmpty)
    }
    XCTAssertEqual(FaceGeometry.placements(faces: [face(confidence: 0.5)], image: image, accessory: .glasses).count, 1)
  }
  func testSixFaceCapStableAreaPriorityAndExplicitOverloadFallback() {
    let large = face(), small = face(0.2, width: 0.5, left: UnitPoint(x: 0.3, y: 0.3), right: UnitPoint(x: 0.5, y: 0.3))
    let smallPlacement = FaceGeometry.placements(faces: [small], image: image, accessory: .glasses)
    let largePlacement = FaceGeometry.placements(faces: [large], image: image, accessory: .glasses)
    let ranked = FaceGeometry.placements(faces: [small, large], image: image, accessory: .glasses)
    XCTAssertEqual(ranked, largePlacement + smallPlacement)
    XCTAssertEqual(FaceGeometry.placements(faces: Array(repeating: large, count: 64), image: image, accessory: .glasses).count, 6)
    XCTAssertTrue(FaceGeometry.placements(faces: Array(repeating: large, count: 65), image: image, accessory: .glasses).isEmpty)
    XCTAssertEqual(FaceGeometry.placements(faces: [large, small], image: image, accessory: .glasses, maximum: 1), largePlacement)
    for maximum in [0, -1, 7, 100] { XCTAssertTrue(FaceGeometry.placements(faces: [large], image: image, accessory: .glasses, maximum: maximum).isEmpty) }
  }
  func testInvalidImageMetricsAndNonfinitePlacementNeverEscape() {
    for size in [ImageSize(width: 0, height: 1), ImageSize(width: .nan, height: 1),
      ImageSize(width: 1, height: .infinity), ImageSize(width: 24001, height: 100)] {
      XCTAssertTrue(FaceGeometry.placements(faces: [face()], image: size, accessory: .glasses).isEmpty)
      XCTAssertNil(FaceGeometry.previewPoint(UnitPoint(x: 0.5, y: 0.5), image: size, viewport: image, mirrored: false))
    }
    XCTAssertFalse(AccessoryPlacement(accessory: .glasses, center: UnitPoint(x: .nan, y: 0), width: 1, height: 1, rotation: 0).finite)
    XCTAssertFalse(AccessoryPlacement(accessory: .glasses, center: UnitPoint(x: 0, y: 0), width: 0, height: 1, rotation: 0).finite)
  }
  func testAspectFillPortraitAndLandscapePositionsAndMirrorsExactlyOnce() throws {
    let source = ImageSize(width: 400, height: 300), portrait = ImageSize(width: 300, height: 600)
    let point = UnitPoint(x: 0.25, y: 0.25)
    let plain = try XCTUnwrap(FaceGeometry.previewPoint(point, image: source, viewport: portrait, mirrored: false))
    let mirror = try XCTUnwrap(FaceGeometry.previewPoint(point, image: source, viewport: portrait, mirrored: true))
    XCTAssertEqual(plain.x, -50, accuracy: 1e-12); XCTAssertEqual(plain.y, 150, accuracy: 1e-12)
    XCTAssertEqual(mirror.x, 350, accuracy: 1e-12); XCTAssertEqual(mirror.y, plain.y)
    XCTAssertEqual(plain.x + mirror.x, 300, accuracy: 1e-12)
    let tallSource = ImageSize(width: 300, height: 400), wideView = ImageSize(width: 800, height: 400)
    let wide = try XCTUnwrap(FaceGeometry.previewPoint(point, image: tallSource, viewport: wideView, mirrored: false))
    let wideMirror = try XCTUnwrap(FaceGeometry.previewPoint(point, image: tallSource, viewport: wideView, mirrored: true))
    XCTAssertEqual(wide.x, 200, accuracy: 1e-12); XCTAssertEqual(wide.y, -200.0 / 3.0, accuracy: 1e-10)
    XCTAssertEqual(wideMirror.x, 600, accuracy: 1e-12); XCTAssertEqual(wideMirror.y, wide.y)
    XCTAssertNil(FaceGeometry.previewPoint(UnitPoint(x: 1.1, y: 0.5), image: source, viewport: portrait, mirrored: false))
    XCTAssertNil(FaceGeometry.previewPoint(point, image: source, viewport: ImageSize(width: 0, height: 600), mirrored: false))
  }
}
