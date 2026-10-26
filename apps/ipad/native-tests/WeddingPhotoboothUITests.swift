import XCTest

/// Updated five-shot source; UNRUN until a macOS/Xcode simulator execution.
/// Synthetic camera only, with actual Expo document files, journal and SQLite.
/// Metro supplies Debug JavaScript/fixture bytes. This does not test physical
/// camera output, standalone offline launch, biometrics, Keychain or the API.
final class WeddingPhotoboothUITests: XCTestCase {
  private let app = XCUIApplication(bundleIdentifier: "com.example.weddingphotobooth")
  private let fixtureMD5 = "2619d8590042d44e0786109755db2bf5"

  override func setUpWithError() throws {
    continueAfterFailure = false
    executionTimeAllowance = 300
    app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
    addUIInterruptionMonitor(withDescription: "Camera, Photos or local-network permission") { alert in
      Self.dismissPermission(alert)
    }
  }

  /// Prefer denying optional Photos export so durable-local proof is independent
  /// of Photos access. Camera/local-network permission remains necessary here.
  private static func dismissPermission(_ alert: XCUIElement) -> Bool {
    let text = ([alert.label] + alert.staticTexts.allElementsBoundByIndex.map { $0.label }).joined(separator: " ").lowercased()
    // Camera usage text may itself mention "photos"; preserve camera priority.
    let required = text.contains("camera") || text.contains("local network")
    let photos = !required && (text.contains("photos") || text.contains("photo library"))
    let denyPhotos = ["Don’t Allow", "Don't Allow", "Don’t Allow Access", "Don't Allow Access", "Not Now"]
    let allow = ["Allow", "OK", "Allow While Using App", "Allow Photos to Be Added", "Add Photos Only", "Allow Access to All Photos", "Allow Full Access", "Allow Access"]
    for title in (photos ? denyPhotos + allow : allow) {
      let button = alert.buttons[title]
      if button.exists { button.tap(); return true }
    }
    return false
  }

  private func dismissSystemPermission(timeout: TimeInterval = 0) {
    let alert = XCUIApplication(bundleIdentifier: "com.apple.springboard").alerts.firstMatch
    if alert.waitForExistence(timeout: timeout) { _ = Self.dismissPermission(alert) }
  }

  private func element(_ identifier: String, timeout: TimeInterval = 40) -> XCUIElement {
    dismissSystemPermission()
    let result = app.descendants(matching: .any).matching(identifier: identifier).firstMatch
    XCTAssertTrue(result.waitForExistence(timeout: timeout), "Missing native element: \(identifier)\n\(app.debugDescription)")
    return result
  }

  private func tap(_ identifier: String) {
    let target = element(identifier)
    dismissSystemPermission()
    if !target.isHittable {
      for _ in 0..<4 { app.swipeUp(); if target.isHittable { break } }
    }
    if !target.isHittable {
      for _ in 0..<5 { app.swipeDown(); if target.isHittable { break } }
    }
    XCTAssertTrue(target.isHittable, "Native control is not reachable: \(identifier)")
    target.tap()
  }

  private func waitEnabled(_ identifier: String, timeout: TimeInterval = 40) {
    let target = element(identifier)
    let expectation = XCTNSPredicateExpectation(predicate: NSPredicate(format: "enabled == true"), object: target)
    XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: timeout), .completed, "Native control remains disabled: \(identifier)")
  }

  private func waitFor(_ identifier: String, containing value: String, timeout: TimeInterval = 40) -> String {
    let target = element(identifier)
    let expectation = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label CONTAINS %@", value), object: target)
    XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: timeout), .completed, "Expected \(identifier) to include \(value); actual: \(target.label)")
    return target.label
  }

  private func field(_ key: String, in snapshot: String) -> String {
    return snapshot.split(separator: ";").map(String.init).first(where: { $0.hasPrefix(key + "=") })?.dropFirst(key.count + 1).description ?? "missing"
  }

  /// Exact field comparisons avoid matching originals=1 against originals=10.
  private func storage(_ expected: [String: String], timeout: TimeInterval = 40) -> String {
    let target = element("native-fixture-storage")
    let predicate = NSPredicate { candidate, _ in
      guard let status = candidate as? XCUIElement else { return false }
      return expected.allSatisfy { self.field($0.key, in: status.label) == $0.value }
    }
    let expectation = XCTNSPredicateExpectation(predicate: predicate, object: target)
    XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: timeout), .completed, "Expected native storage \(expected); actual: \(target.label)")
    return target.label
  }

  private func assertDurableActiveFile(_ snapshot: String) {
    XCTAssertEqual(field("file", in: snapshot), "present", snapshot)
    XCTAssertGreaterThan(Int(field("bytes", in: snapshot)) ?? 0, 0, snapshot)
    XCTAssertEqual(field("md5", in: snapshot), fixtureMD5, "The active original must retain the committed synthetic JPEG bytes")
    XCTAssertTrue(field("photo", in: snapshot).hasPrefix("e2e00000-"), snapshot)
  }

  private func assertNoGuestQR() {
    XCTAssertFalse(app.descendants(matching: .any).matching(identifier: "guest-qr").firstMatch.exists, "Offline fixture must never expose an unready gallery QR")
  }

  private func attach(_ name: String) {
    let attachment = XCTAttachment(screenshot: app.screenshot())
    attachment.name = "SYNTHETIC native fixture — " + name
    attachment.lifetime = .keepAlways
    add(attachment)
  }

  private func relaunch() {
    app.terminate()
    app.launch()
    _ = element("native-fixture-enabled")
  }

  func testFiveShotSessionRetakeAndRealNativePersistence() throws {
    app.launch()
    _ = element("native-fixture-enabled")
    _ = storage(["state": "none", "uploads": "0", "pending": "0", "drafts": "0", "originals": "0", "verifiedOriginals": "0"])
    _ = element("start-session")
    tap("start-session")

    // The fixture still asks for real native camera permission; no host-auth bypass.
    let allowCamera = app.descendants(matching: .any).matching(identifier: "allow-camera").firstMatch
    if allowCamera.waitForExistence(timeout: 3) {
      tap("allow-camera")
      dismissSystemPermission(timeout: 8)
    }
    waitEnabled("take-photo")
    attach("attract to camera with native permission")

    // Cancel before exposure, then outwait the fresh-install three-second timer.
    tap("take-photo")
    tap("cancel-countdown")
    waitEnabled("take-photo")
    Thread.sleep(forTimeInterval: 4)
    _ = storage(["state": "none", "uploads": "0", "pending": "0", "drafts": "0", "originals": "0", "verifiedOriginals": "0"])
    XCTAssertFalse(app.descendants(matching: .any).matching(identifier: "photo-preview").firstMatch.exists)
    assertNoGuestQR()

    // Terminate immediately after the first *durable* original is observable,
    // before the following automatic exposure. Do not pause for a screenshot.
    tap("take-photo")
    let firstSaved = storage(["state": "draft", "uploads": "0", "pending": "0", "drafts": "0", "originals": "1", "verifiedOriginals": "1"], timeout: 25)
    assertDurableActiveFile(firstSaved)
    let firstID = field("photo", in: firstSaved)
    relaunch()
    waitEnabled("take-photo")
    let partial = storage(["state": "draft", "uploads": "0", "pending": "0", "drafts": "0", "originals": "1", "verifiedOriginals": "1"])
    XCTAssertEqual(field("photo", in: partial), firstID)
    assertDurableActiveFile(partial)
    _ = waitFor("take-photo", containing: "Continue")
    assertNoGuestQR()
    attach("one original survives termination and camera can resume")

    // Continue fills the four missing slots; it must not start five new shots.
    tap("take-photo")
    _ = element("photo-preview", timeout: 60)
    dismissSystemPermission(timeout: 3)
    let five = storage(["state": "draft", "uploads": "0", "pending": "0", "drafts": "0", "originals": "5", "verifiedOriginals": "5"])
    assertDurableActiveFile(five)
    XCTAssertNotEqual(field("photo", in: five), firstID)
    for slot in 1...5 { _ = element("photo-thumbnail-\(slot)") }
    _ = waitFor("use-photo", containing: "Keep all 5 photos")
    assertNoGuestQR()

    // Exercise paging and its selected-photo update, then deliberately retake
    // slot one. No assumption that a fast swipe advances exactly one page.
    let originalPreview = element("photo-preview").label
    element("review-gallery").swipeLeft()
    let movedPreview = element("photo-preview")
    let moved = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label != %@ AND label BEGINSWITH %@", originalPreview, "Saved photo "), object: movedPreview)
    XCTAssertEqual(XCTWaiter.wait(for: [moved], timeout: 10), .completed, "Swiping must select another saved original")
    tap("photo-thumbnail-1")
    _ = waitFor("retake-photo", containing: "Retake photo 1")
    waitEnabled("retake-photo")
    attach("five saved originals and swipeable review")
    tap("retake-photo")
    waitEnabled("take-photo")
    tap("take-photo")
    _ = element("photo-preview", timeout: 25)
    dismissSystemPermission(timeout: 3)
    let retaken = storage(["state": "draft", "uploads": "0", "pending": "0", "drafts": "0", "originals": "6", "verifiedOriginals": "6"])
    assertDurableActiveFile(retaken)
    let replacementID = field("photo", in: retaken)
    XCTAssertNotEqual(replacementID, firstID, "Retake must preserve the retired original and create a new ID")
    _ = waitFor("use-photo", containing: "Keep all 5 photos")

    // Six physical originals, but only the five selected shots enter the queue.
    tap("use-photo")
    _ = element("next-guest")
    let confirmed = storage(["state": "confirmed", "uploads": "5", "pending": "5", "drafts": "0", "originals": "6", "verifiedOriginals": "6"])
    assertDurableActiveFile(confirmed)
    XCTAssertEqual(field("photo", in: confirmed), replacementID)
    assertNoGuestQR()
    relaunch()
    _ = element("next-guest")
    let restored = storage(["state": "confirmed", "uploads": "5", "pending": "5", "drafts": "0", "originals": "6", "verifiedOriginals": "6"])
    XCTAssertEqual(field("photo", in: restored), replacementID)
    assertDurableActiveFile(restored)
    assertNoGuestQR()
    tap("retry-sharing")
    _ = storage(["state": "confirmed", "uploads": "5", "pending": "5", "originals": "6", "verifiedOriginals": "6"])
    assertNoGuestQR()
    attach("five queued selections and six originals survive offline relaunch")

    // Next guests clears only active presentation; retained originals and jobs
    // must survive another termination/recovery without acquiring a sixth job.
    tap("next-guest")
    _ = element("start-session")
    let cleared = storage(["state": "none", "photo": "none", "file": "none", "uploads": "5", "pending": "5", "drafts": "0", "originals": "6", "verifiedOriginals": "6"])
    XCTAssertEqual(field("bytes", in: cleared), "0")
    assertNoGuestQR()
    relaunch()
    _ = element("start-session")
    _ = storage(["state": "none", "photo": "none", "file": "none", "uploads": "5", "pending": "5", "drafts": "0", "originals": "6", "verifiedOriginals": "6"])
    XCTAssertFalse(app.descendants(matching: .any).matching(identifier: "photo-preview").firstMatch.exists)
    XCTAssertFalse(app.descendants(matching: .any).matching(identifier: "take-photo").firstMatch.exists)
    assertNoGuestQR()
    attach("next guests restores attract while preserving every original and five jobs")
  }
}
