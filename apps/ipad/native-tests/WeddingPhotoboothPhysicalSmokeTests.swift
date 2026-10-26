import XCTest

/// Private, owner-armed physical rehearsal of an already installed Release.
/// No fixture, reset, cloud action or host-authentication bypass.
final class WeddingPhotoboothPhysicalSmokeTests: XCTestCase {
  private var targetBundleID = ""
  private lazy var booth = XCUIApplication(bundleIdentifier: targetBundleID)
  private enum RehearsalBlocker: Error { case ownerAction(String) }

  override func setUpWithError() throws {
    continueAfterFailure = false
    executionTimeAllowance = 240
    #if targetEnvironment(simulator)
    throw RehearsalBlocker.ownerAction("This rehearsal requires the actual owner iPad.")
    #endif
    let configured = ProcessInfo.processInfo.environment["PHOTOBOOTH_APP_BUNDLE_ID"] ?? ""
    guard configured.range(of: #"^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$"#, options: .regularExpression) != nil,
          !configured.hasPrefix("com.example.") else {
      throw RehearsalBlocker.ownerAction("Configure the preserved installed app bundle identifier explicitly.")
    }
    targetBundleID = configured
    guard ProcessInfo.processInfo.environment["PHOTOBOOTH_PHYSICAL_REHEARSAL"] == "OWNER_READY" else {
      throw RehearsalBlocker.ownerAction("Owner must position a test card and explicitly arm this physical rehearsal.")
    }
  }

  private func element(_ id: String) -> XCUIElement {
    booth.descendants(matching: .any).matching(identifier: id).firstMatch
  }
  private func require(_ condition: Bool, _ message: String) throws {
    guard condition else { throw RehearsalBlocker.ownerAction(message) }
  }
  private func waitUntil(_ timeout: TimeInterval, _ condition: @escaping () -> Bool) -> Bool {
    let expectation = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in condition() }, object: nil)
    return XCTWaiter.wait(for: [expectation], timeout: timeout) == .completed
  }
  private func tap(_ id: String) throws {
    let target = element(id)
    try require(target.waitForExistence(timeout: 15) && target.isEnabled && target.isHittable,
                "Required app control unavailable; preserve the current session: \(id)")
    target.tap()
  }
  private func handleExpectedPermission() throws {
    let alert = XCUIApplication(bundleIdentifier: "com.apple.springboard").alerts.firstMatch
    guard alert.exists else { return }
    let text = ([alert.label] + alert.staticTexts.allElementsBoundByIndex.map { $0.label }).joined(separator: " ").lowercased()
    let camera = text.contains("wedding") && text.contains("camera")
    let addPhotos = text.contains("wedding") && text.contains("photo") && text.contains("add")
    try require(camera || addPhotos, "Unrecognized system prompt requires owner action; no security prompt is auto-approved.")
    let titles = camera ? ["Allow", "OK"] : ["Allow Photos to Be Added", "Add Photos Only", "Allow"]
    guard let button = titles.map({ alert.buttons[$0] }).first(where: { $0.exists && $0.isEnabled }) else {
      throw RehearsalBlocker.ownerAction("Owner must resolve camera or Photos add-only permission.")
    }
    button.tap()
  }
  private func setGuestTiming(_ prefix: String, seconds: Int) throws {
    for _ in 0..<6 {
      let text = element("\(prefix)-value").label
      guard let current = Int(text.filter { $0.isNumber }) else {
        throw RehearsalBlocker.ownerAction("Timing value was not readable; preserve host defaults.")
      }
      if current == seconds { return }
      try tap("\(prefix)-\(current < seconds ? "plus" : "minus")")
      try require(waitUntil(3) { self.element("\(prefix)-value").label != text }, "Timing did not respond.")
    }
    throw RehearsalBlocker.ownerAction("Requested guest timing could not be selected.")
  }
  private func requireFourSavedPhotos() throws {
    try require(element("review-gallery").waitForExistence(timeout: 30), "Four-photo review did not appear; leave saved data intact.")
    for slot in 1...4 {
      let thumb = element("photo-thumbnail-\(slot)")
      try require(thumb.waitForExistence(timeout: 10) && thumb.label == "Photo \(slot), saved on this iPad",
                  "Saved-state indicator missing for photo \(slot).")
    }
    try require(!element("photo-thumbnail-5").exists, "This is a legacy session, not the four-photo rehearsal.")
    try require(booth.staticTexts["4 originals saved on this iPad"].exists, "App did not report four durable originals.")
    for slot in 1...4 {
      try tap("photo-thumbnail-\(slot)")
      try require(waitUntil(10) { self.element("photo-preview").exists && self.element("photo-preview").label == "Saved photo \(slot)" },
                  "Review selection failed for photo \(slot).")
    }
  }

  func testFourPhysicalCapturesReviewAndRelaunch() throws {
    // Activate without initially terminating a possible existing guest capture.
    booth.activate()
    try require(waitUntil(40) { self.element("start-session").exists || self.element("camera-stage").exists || self.element("review-gallery").exists || self.element("next-guest").exists },
                "Release did not show a known screen; owner should inspect it.")
    try require(!element("native-fixture-enabled").exists, "Refuse synthetic fixture on the event iPad.")
    try require(element("start-session").exists,
                "An existing active/recovered session is open. Owner must decide how to finish it; test will not advance or clear it.")
    try tap("start-session")
    if element("allow-camera").waitForExistence(timeout: 2) {
      try require(element("allow-camera").label == "Enable camera", "Camera denied in Settings; owner action required.")
      try tap("allow-camera")
      _ = XCUIApplication(bundleIdentifier: "com.apple.springboard").alerts.firstMatch.waitForExistence(timeout: 5)
      try handleExpectedPermission()
    }
    try require(waitUntil(30) { self.element("take-photo").exists && self.element("take-photo").isEnabled }, "Camera never became ready.")
    try require(element("take-photo").label == "Start 4 photos", "Refuse to continue or retake an existing session.")
    try require(element("capture-framing-hint").label == "Full original kept · screen preview crops the edges", "Patched camera capability is not active.")
    for slot in 1...4 {
      try require(element("photo-thumbnail-\(slot)").label == "Photo \(slot), not taken", "Existing captures found; owner attention required.")
    }
    try tap("timing-chip")
    try setGuestTiming("timing-first", seconds: 5)
    try setGuestTiming("timing-next", seconds: 3)
    try tap("timing-apply")
    try require(element("timing-chip").label.contains("5 seconds to prepare, 3 seconds for following photos"), "Guest timing did not apply.")
    try tap("take-photo")
    let deadline = Date().addingTimeInterval(100)
    while !element("review-gallery").exists && Date() < deadline {
      try handleExpectedPermission()
      if element("retry-save").exists {
        throw RehearsalBlocker.ownerAction("Local save needs retry. Preserve the exposed original; owner attention required.")
      }
      if element("take-photo").exists && element("take-photo").label.hasPrefix("Continue") {
        throw RehearsalBlocker.ownerAction("Capture was paused, possibly by a permission prompt. Owner must inspect and resume; the test preserves this session.")
      }
      _ = waitUntil(1) { self.element("review-gallery").exists }
    }
    try handleExpectedPermission()
    try requireFourSavedPhotos()
    // Terminate only this newly created rehearsal after all four saved indicators.
    booth.terminate()
    booth.launch()
    try requireFourSavedPhotos()
    // Leave review open. Never Next guests, delete, confirm, share or upload.
  }
}
