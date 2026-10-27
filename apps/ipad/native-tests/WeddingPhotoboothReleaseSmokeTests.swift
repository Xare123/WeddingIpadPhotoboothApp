import XCTest
import UIKit

#if DEBUG
#error("Release smoke tests must use the Release configuration")
#endif

/// Genuine Release app, embedded JavaScript, fixture disabled, no Metro server.
/// Fresh simulator only. No camera, photo saving, Photos or device claims.
final class WeddingPhotoboothReleaseSmokeTests: XCTestCase {
  private let app = XCUIApplication(bundleIdentifier: "com.example.weddingphotobooth")

  override func setUpWithError() throws {
    continueAfterFailure = false
    executionTimeAllowance = 180
    app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
  }

  override func tearDownWithError() throws {
    app.terminate()
    XCUIDevice.shared.orientation = .portrait
  }

  // Fresh simulator only. Fixed state/geometry fields provide useful failure
  // evidence without logging an accessibility tree, photo, path or credential.
  private func geometryDiagnostic(_ stage: String, requested: UIDeviceOrientation) -> String {
    func rectangle(_ value: CGRect) -> [String: Any] {
      var result: [String: Any] = [:]
      for (key, value) in [("x", value.origin.x), ("y", value.origin.y),
                           ("width", value.width), ("height", value.height)] {
        let number = Double(value)
        if number.isFinite { result[key] = number } else { result[key] = NSNull() }
      }
      return result
    }
    let exists = app.exists
    let foreground = app.state == .runningForeground
    let windows = foreground && exists ? Array(app.windows.allElementsBoundByIndex.prefix(4)) : []
    let identityExists = foreground && exists && app.staticTexts["wedding-identity"].exists
    let start = app.buttons["start-session"]
    let startExists = foreground && exists && start.exists
    let record: [String: Any] = [
      "stage": stage, "requestedOrientation": requested.rawValue,
      "deviceOrientation": XCUIDevice.shared.orientation.rawValue,
      "appState": app.state.rawValue, "appExists": exists,
      "applicationFrame": foreground && exists ? rectangle(app.frame) : [:],
      "windowFrames": windows.map { rectangle($0.frame) },
      "identityExists": identityExists, "startExists": startExists,
      "startHittable": startExists && start.isHittable,
      "systemAlertCount": XCUIApplication(bundleIdentifier: "com.apple.springboard").alerts.count,
    ]
    let data = try? JSONSerialization.data(withJSONObject: record, options: [.sortedKeys])
    let json = data.flatMap { String(data: $0, encoding: .utf8) } ?? "diagnostic-unavailable"
    print("PHOTOBOOTH_RELEASE_DIAGNOSTIC \(json)")
    let details = XCTAttachment(string: json)
    details.name = "Release simulator geometry — \(stage)"
    details.lifetime = .keepAlways
    add(details)
    return json
  }

  private func assertAttract(_ orientation: UIDeviceOrientation) {
    // Avoid an accessibility snapshot before the original orientation wait:
    // gathering diagnostics must not become an implicit startup-readiness gate.
    print("PHOTOBOOTH_RELEASE_REQUEST orientation=\(orientation.rawValue) appState=\(app.state.rawValue)")
    XCUIDevice.shared.orientation = orientation
    let rotated = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
      let frame = self.app.frame
      return orientation == .portrait ? frame.height > frame.width : frame.width > frame.height
    }, object: app)
    let result = XCTWaiter.wait(for: [rotated], timeout: 15)
    let diagnostic = geometryDiagnostic(result == .completed ? "orientation-observed" : "orientation-unconfirmed", requested: orientation)
    if result != .completed {
      let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
      screenshot.name = "Release simulator orientation failure"
      screenshot.lifetime = .keepAlways
      add(screenshot)
    }
    XCTAssertEqual(result, .completed, "App must adopt the requested orientation. \(diagnostic)")
    let identity = app.staticTexts["wedding-identity"]
    XCTAssertTrue(identity.waitForExistence(timeout: 40), "Release app must render embedded JavaScript without Metro")
    XCTAssertFalse(identity.label.isEmpty)
    let start = app.buttons["start-session"]
    XCTAssertTrue(start.waitForExistence(timeout: 15))
    let reachable = XCTNSPredicateExpectation(predicate: NSPredicate(format: "enabled == true AND hittable == true"), object: start)
    XCTAssertEqual(XCTWaiter.wait(for: [reachable], timeout: 20), .completed, "Primary attract action must be enabled and hittable")
    XCTAssertFalse(start.label.isEmpty)
    XCTAssertTrue(app.buttons["Open host controls"].isHittable)
    for identifier in ["native-fixture-enabled", "native-fixture-storage", "guest-qr", "photo-preview"] {
      XCTAssertFalse(app.descendants(matching: .any).matching(identifier: identifier).firstMatch.exists, "Unexpected private/fixture UI: \(identifier)")
    }
    let screenshot = XCTAttachment(screenshot: app.screenshot())
    screenshot.name = "Actual Release simulator attract UI — \(orientation == .portrait ? "portrait" : "landscape")"
    screenshot.lifetime = .keepAlways
    add(screenshot)
  }

  func testReleaseColdLaunchAndRelaunchWithoutMetro() {
    app.launch()
    assertAttract(.portrait)
    assertAttract(.landscapeLeft)
    app.terminate()
    app.launch()
    assertAttract(.landscapeLeft)
    assertAttract(.portrait)
  }
}
