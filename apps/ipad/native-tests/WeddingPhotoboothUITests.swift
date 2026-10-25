import XCTest

/// Synthetic camera only. The application uses actual Expo document files and
/// SQLite; Metro supplies JavaScript/fixture bytes. This does not test a physical
/// camera, standalone offline launch, biometrics, Keychain or the hosted API.
final class WeddingPhotoboothUITests: XCTestCase {
  private let app = XCUIApplication(bundleIdentifier: "com.example.weddingphotobooth")

  override func setUpWithError() throws {
    continueAfterFailure = false
    executionTimeAllowance = 300
    app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
    addUIInterruptionMonitor(withDescription: "Camera permission") { alert in
      for title in ["Allow", "OK", "Allow While Using App"] {
        let button = alert.buttons[title]
        if button.exists { button.tap(); return true }
      }
      return false
    }
  }

  private func element(_ identifier: String, timeout: TimeInterval = 40) -> XCUIElement {
    let result = app.descendants(matching: .any).matching(identifier: identifier).firstMatch
    XCTAssertTrue(result.waitForExistence(timeout: timeout), "Missing native element: \(identifier)\n\(app.debugDescription)")
    return result
  }

  private func tap(_ identifier: String) {
    let target = element(identifier)
    if !target.isHittable {
      for _ in 0..<4 { app.swipeUp(); if target.isHittable { break } }
    }
    if !target.isHittable {
      for _ in 0..<5 { app.swipeDown(); if target.isHittable { break } }
    }
    XCTAssertTrue(target.isHittable, "Native control is not reachable: \(identifier)")
    target.tap()
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

  private func assertDurableFile(_ snapshot: String) {
    XCTAssertEqual(field("file", in: snapshot), "present", snapshot)
    XCTAssertGreaterThan(Int(field("bytes", in: snapshot)) ?? 0, 0, snapshot)
    XCTAssertEqual(field("md5", in: snapshot), "2619d8590042d44e0786109755db2bf5", "Stored original must retain the committed synthetic JPEG bytes")
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

  func testSyntheticCameraAndRealNativePersistence() throws {
    app.launch()
    _ = element("native-fixture-enabled")
    let initial = waitFor("native-fixture-storage", containing: "state=none")
    XCTAssertEqual(field("uploads", in: initial), "0", "Use a fresh simulator/app install for this suite")

    // Actual iOS camera permission, even though the subsequent image is synthetic.
    let allow = app.descendants(matching: .any).matching(identifier: "allow-camera").firstMatch
    if allow.exists {
      tap("allow-camera")
      let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
      let prompt = springboard.alerts.firstMatch
      if prompt.waitForExistence(timeout: 8) {
        for title in ["Allow", "OK", "Allow While Using App"] {
          if prompt.buttons[title].exists { prompt.buttons[title].tap(); break }
        }
      }
    }
    let take = element("take-photo")
    let enabled = XCTNSPredicateExpectation(predicate: NSPredicate(format: "enabled == true"), object: take)
    XCTAssertEqual(XCTWaiter.wait(for: [enabled], timeout: 30), .completed)
    attach("permission granted and native launch")

    tap("take-photo")
    tap("cancel-countdown")
    // The canceled attempt must not take a late picture.
    Thread.sleep(forTimeInterval: 3.5)
    XCTAssertFalse(app.descendants(matching: .any).matching(identifier: "photo-preview").firstMatch.exists)
    XCTAssertTrue(element("take-photo").isEnabled)

    tap("take-photo")
    _ = element("photo-preview", timeout: 20)
    let draft = waitFor("native-fixture-storage", containing: "state=draft")
    assertDurableFile(draft)
    XCTAssertEqual(field("uploads", in: draft), "0", "Drafts must never upload")
    let draftID = field("photo", in: draft)

    relaunch()
    _ = element("photo-preview")
    let restoredDraft = waitFor("native-fixture-storage", containing: "state=draft")
    XCTAssertEqual(field("photo", in: restoredDraft), draftID)
    assertDurableFile(restoredDraft)
    attach("draft restored after native termination")

    tap("retake-photo")
    tap("take-photo")
    _ = element("photo-preview", timeout: 20)
    tap("use-photo")
    _ = element("next-guest")
    let confirmed = waitFor("native-fixture-storage", containing: "state=confirmed")
    assertDurableFile(confirmed)
    XCTAssertEqual(field("pending", in: confirmed), "1")
    XCTAssertEqual(field("originals", in: confirmed), "1")
    XCTAssertEqual(field("drafts", in: confirmed), "1", "Retake keeps its original draft")
    let confirmedID = field("photo", in: confirmed)

    relaunch()
    _ = element("next-guest")
    let restored = waitFor("native-fixture-storage", containing: "state=confirmed")
    XCTAssertEqual(field("photo", in: restored), confirmedID)
    XCTAssertEqual(field("pending", in: restored), "1")
    assertDurableFile(restored)
    XCTAssertFalse(app.descendants(matching: .any).matching(identifier: "guest-qr").firstMatch.exists)
    tap("retry-sharing")
    XCTAssertFalse(app.descendants(matching: .any).matching(identifier: "guest-qr").firstMatch.exists)
    attach("offline confirmed original and queue restored")

    tap("next-guest")
    relaunch()
    _ = element("take-photo")
    let cleared = waitFor("native-fixture-storage", containing: "state=none")
    XCTAssertEqual(field("pending", in: cleared), "1")
    XCTAssertEqual(field("originals", in: cleared), "1")
    XCTAssertFalse(app.descendants(matching: .any).matching(identifier: "photo-preview").firstMatch.exists)
    XCTAssertFalse(app.descendants(matching: .any).matching(identifier: "guest-qr").firstMatch.exists)

    // Real journal checkpoint: only rename the synthetic draft, then kill the
    // process before any SQLite queue/active metadata update occurs.
    tap("take-photo")
    _ = element("photo-preview", timeout: 20)
    let journalDraft = waitFor("native-fixture-storage", containing: "state=draft")
    let journalID = field("photo", in: journalDraft)
    tap("native-fixture-checkpoint")
    _ = waitFor("native-fixture-checkpoint-status", containing: "Confirmed-file checkpoint saved")
    relaunch()
    _ = element("next-guest")
    let recovered = waitFor("native-fixture-storage", containing: "state=confirmed")
    XCTAssertEqual(field("photo", in: recovered), journalID)
    XCTAssertEqual(field("pending", in: recovered), "2")
    XCTAssertEqual(field("originals", in: recovered), "2")
    assertDurableFile(recovered)
    relaunch()
    let recoveredAgain = waitFor("native-fixture-storage", containing: "state=confirmed")
    XCTAssertEqual(field("pending", in: recoveredAgain), "2", "Recovery must be idempotent")
    attach("confirmed-file journal recovered exactly once")
    tap("next-guest")
    XCTAssertFalse(app.descendants(matching: .any).matching(identifier: "guest-qr").firstMatch.exists)
  }
}
