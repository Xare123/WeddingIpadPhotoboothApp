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

  private func assertAttract(_ orientation: UIDeviceOrientation) {
    XCUIDevice.shared.orientation = orientation
    let rotated = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
      let frame = self.app.frame
      return orientation == .portrait ? frame.height > frame.width : frame.width > frame.height
    }, object: app)
    XCTAssertEqual(XCTWaiter.wait(for: [rotated], timeout: 15), .completed, "App must adopt the requested orientation")
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
