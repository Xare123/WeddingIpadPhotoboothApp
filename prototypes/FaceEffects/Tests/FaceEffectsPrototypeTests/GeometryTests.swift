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
    XCTAssertEqual(result.width * 1000, 2.0 * sqrt(100000.0), accuracy: 1e-9)
    XCTAssertEqual(result.height * 500, 0.60 * sqrt(100000.0), accuracy: 1e-9)
    XCTAssertEqual(result.width * 1000 / (result.height * 500), 2.0 / 0.60, accuracy: 1e-12)
  }
  func testCrownAndHeartsOffsetAlongRolledFaceAxisInPixelSpace() throws {
    let rolled = face(left: UnitPoint(x: 0.4, y: 0.6), right: UnitPoint(x: 0.5, y: 0.7))
    let crown = try XCTUnwrap(FaceGeometry.placements(faces: [rolled], image: image, accessory: .crown).first)
    XCTAssertEqual(crown.center.x, 0.52, accuracy: 1e-12)
    XCTAssertEqual(crown.center.y, 0.37, accuracy: 1e-12)
    XCTAssertTrue(crown.finite)
    let hearts = try XCTUnwrap(FaceGeometry.placements(faces: [rolled], image: image, accessory: .hearts).first)
    XCTAssertEqual(hearts.center.x, 0.5175, accuracy: 1e-12)
    XCTAssertEqual(hearts.center.y, 0.38, accuracy: 1e-12)
  }

  func testAnatomicalEyeOrderingDoesNotIntroducePiRotationOrMirroring() {
    let original = face(left: UnitPoint(x: 0.4, y: 0.6), right: UnitPoint(x: 0.5, y: 0.7))
    let swapped = face(left: original.rightEye, right: original.leftEye)
    for accessory in [FaceAccessory.glasses, .crown, .hearts] {
      XCTAssertEqual(FaceGeometry.placements(faces: [original], image: image, accessory: accessory).count, 1)
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
    let square = ImageSize(width: 1000, height: 1000)
    func separated(_ x: Double, _ y: Double, width: Double = 0.16) -> FaceAnchors {
      FaceAnchors(bounds: UnitRect(x: x - width / 2, y: y - 0.05, width: width, height: 0.20),
        leftEye: UnitPoint(x: x - 0.025, y: y), rightEye: UnitPoint(x: x + 0.025, y: y), confidence: 1)
    }
    let six = [0.35,0.75].flatMap { y in [0.15,0.5,0.85].map { separated($0, y) } }
    let capacity = FaceGeometry.placements(faces: six, image: square, accessory: .glasses)
    XCTAssertEqual(capacity.count, 6)
    XCTAssertTrue(FaceGeometry.placements(faces: Array(repeating: six[0], count: 64), image: square, accessory: .glasses).isEmpty,
      "duplicate face boxes protect each other rather than drawing overlapping accessories")
    XCTAssertTrue(FaceGeometry.placements(faces: Array(repeating: six[0], count: 65), image: square, accessory: .glasses).isEmpty)
    let small = separated(0.75, 0.35, width: 0.14), large = separated(0.25, 0.35, width: 0.22)
    let first = FaceGeometry.placements(faces: [large], image: square, accessory: .glasses)
    let last = FaceGeometry.placements(faces: [small], image: square, accessory: .glasses)
    XCTAssertEqual(FaceGeometry.placements(faces: [small, large], image: square, accessory: .glasses), first + last)
    XCTAssertEqual(FaceGeometry.placements(faces: [small, large], image: square, accessory: .glasses, maximum: 1), first)
    for maximum in [0, -1, 7, 100] { XCTAssertTrue(FaceGeometry.placements(faces: six, image: square, accessory: .glasses, maximum: maximum).isEmpty) }
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
  func testOtherFacesAndExplicitObstructionsSuppressAccessoriesWithoutUsableEyes() {
    let primary = FaceAnchors(bounds: UnitRect(x: 0.2, y: 0.3, width: 0.22, height: 0.28),
      leftEye: UnitPoint(x: 0.26, y: 0.42), rightEye: UnitPoint(x: 0.36, y: 0.42), confidence: 1)
    let neighborBounds = UnitRect(x: 0.41, y: 0.24, width: 0.20, height: 0.30)
    let unusable = FaceAnchors(bounds: neighborBounds, leftEye: UnitPoint(x: .nan, y: .nan),
      rightEye: UnitPoint(x: .nan, y: .nan), confidence: 0.9)
    XCTAssertEqual(FaceGeometry.placements(faces: [primary], image: image, accessory: .glasses).count, 1)
    XCTAssertTrue(FaceGeometry.placements(faces: [primary, unusable], image: image, accessory: .glasses).isEmpty)
    // Protective geometry is independent of decoration confidence. A valid box
    // cannot disappear just because this neighbor falls below the eye gate.
    for confidence in [0.0, 0.4, 0.5] {
      let neighbor = FaceAnchors(bounds: neighborBounds, leftEye: UnitPoint(x: 0.46, y: 0.40),
        rightEye: UnitPoint(x: 0.56, y: 0.40), confidence: confidence)
      XCTAssertTrue(FaceGeometry.placements(faces: [primary, neighbor], image: image, accessory: .glasses).isEmpty)
    }
    XCTAssertTrue(FaceGeometry.placements(faces: [primary], image: image, accessory: .glasses, obstructingBounds: [neighborBounds]).isEmpty)
    let invalid = UnitRect(x: .nan, y: 0, width: 0.1, height: 0.1)
    XCTAssertTrue(FaceGeometry.placements(faces: [primary], image: image, accessory: .glasses, obstructingBounds: [invalid]).isEmpty)
    let far = UnitRect(x: 0.8, y: 0.8, width: 0.1, height: 0.1)
    XCTAssertEqual(FaceGeometry.placements(faces: [primary], image: image, accessory: .glasses, obstructingBounds: Array(repeating: far, count: 64)).count, 1)
    XCTAssertTrue(FaceGeometry.placements(faces: [primary], image: image, accessory: .glasses, obstructingBounds: Array(repeating: far, count: 65)).isEmpty)
  }
  func testRotatedNeighborAndAccessoryCollisionsUsePixelSpaceAndStablePriority() throws {
    func rolled(_ x: Double, width: Double = 0.08) -> FaceAnchors {
      FaceAnchors(bounds: UnitRect(x: x - width / 2, y: 0.64, width: width, height: 0.16),
        leftEye: UnitPoint(x: x - 0.03, y: 0.64), rightEye: UnitPoint(x: x + 0.03, y: 0.68), confidence: 1)
    }
    let left = rolled(0.45), right = rolled(0.55)
    let one = FaceGeometry.placements(faces: [left], image: image, accessory: .crown)
    let two = FaceGeometry.placements(faces: [right], image: image, accessory: .crown)
    XCTAssertEqual(one.count, 1); XCTAssertEqual(two.count, 1)
    XCTAssertEqual(FaceGeometry.placements(faces: [left,right], image: image, accessory: .crown), one)
    XCTAssertEqual(FaceGeometry.placements(faces: [right,left], image: image, accessory: .crown), two,
      "equal-area collision priority is stable input order")
    XCTAssertEqual(FaceGeometry.placements(faces: [left,rolled(0.55, width: 0.09)], image: image, accessory: .crown), two,
      "larger face wins even when it appears later")
    // In the rotated envelope's lower-right AABB corner, this tiny box is
    // physically separated from the actual rotated rectangle. SAT must keep it.
    let outsideRotatedBox = UnitRect(x: 0.536, y: 0.55, width: 0.004, height: 0.008)
    XCTAssertEqual(FaceGeometry.placements(faces: [left], image: image, accessory: .crown,
      obstructingBounds: [outsideRotatedBox]), one)
    let acrossRotatedBox = UnitRect(x: 0.50, y: 0.49, width: 0.02, height: 0.02)
    XCTAssertTrue(FaceGeometry.placements(faces: [left], image: image, accessory: .crown,
      obstructingBounds: [acrossRotatedBox]).isEmpty)
  }
  func testImageEdgesSuppressClippedOrnamentsBeforeCapacityLimit() {
    let square = ImageSize(width: 1000, height: 1000)
    func head(_ y: Double) -> FaceAnchors {
      FaceAnchors(bounds: UnitRect(x: 0.30, y: y - 0.01, width: 0.40, height: 0.10),
        leftEye: UnitPoint(x: 0.45, y: y), rightEye: UnitPoint(x: 0.55, y: y), confidence: 1)
    }
    let atTop = head(0.12), safe = head(0.60)
    XCTAssertTrue(FaceGeometry.placements(faces: [atTop], image: square, accessory: .crown).isEmpty)
    let expected = FaceGeometry.placements(faces: [safe], image: square, accessory: .crown)
    XCTAssertEqual(expected.count, 1)
    XCTAssertEqual(FaceGeometry.placements(faces: [atTop,safe], image: square, accessory: .crown, maximum: 1), expected,
      "unsafe higher-priority candidate cannot consume the output capacity")
    let leftEdge = FaceAnchors(bounds: UnitRect(x: 0, y: 0.3, width: 0.20, height: 0.30),
      leftEye: UnitPoint(x: 0.01, y: 0.45), rightEye: UnitPoint(x: 0.11, y: 0.45), confidence: 1)
    XCTAssertTrue(FaceGeometry.placements(faces: [leftEdge], image: square, accessory: .glasses).isEmpty)
  }
  func testV2CrownGeometryIsCompactAndAboveEyes() throws {
    let square = ImageSize(width: 1000, height: 1000)
    let candidate = FaceAnchors(bounds: UnitRect(x: 0.25, y: 0.45, width: 0.5, height: 0.35),
      leftEye: UnitPoint(x: 0.45, y: 0.6), rightEye: UnitPoint(x: 0.55, y: 0.6), confidence: 1)
    let crown = try XCTUnwrap(FaceGeometry.placements(faces: [candidate], image: square, accessory: .crown).first)
    XCTAssertEqual(FaceGeometry.recipeVersion, "wedding-face-prototype-v2")
    XCTAssertEqual(crown.width, 0.172, accuracy: 1e-12); XCTAssertEqual(crown.height, 0.05, accuracy: 1e-12)
    XCTAssertEqual(crown.center.x, 0.5, accuracy: 1e-12); XCTAssertEqual(crown.center.y, 0.46, accuracy: 1e-12)
    XCTAssertLessThan(crown.center.y + crown.height / 2, 0.6)
  }

}
