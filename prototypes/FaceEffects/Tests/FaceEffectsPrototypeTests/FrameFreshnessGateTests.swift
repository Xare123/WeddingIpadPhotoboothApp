import XCTest
@testable import FaceEffectsPrototype

/// Actor admission/freshness tests. No native camera or detector is exercised.
final class FrameFreshnessGateTests: XCTestCase {
  private func pose(_ accessory: FaceAccessory = .glasses) -> AccessoryPlacement {
    AccessoryPlacement(accessory: accessory, center: UnitPoint(x: 0.5, y: 0.5), width: 0.3, height: 0.1, rotation: 0)
  }
  private func admit(_ gate: FrameFreshnessGate, at time: Double) async throws -> FrameFreshnessGate.Ticket {
    let value = await gate.begin(capturedAt: time, now: time)
    return try XCTUnwrap(value)
  }
  func testDefaultNoneNeverAdmitsAndHasNoOverlay() async {
    let gate = FrameFreshnessGate()
    let ticket = await gate.begin(capturedAt: 0, now: 0), current = await gate.current(now: 0)
    XCTAssertNil(ticket); XCTAssertTrue(current.isEmpty)
    await gate.resume(); let resumed = await gate.begin(capturedAt: 0.1, now: 0.1)
    XCTAssertNil(resumed)
  }
  func testOnlyOnePhysicalRequestAndThrottleAfterCompletion() async throws {
    let gate = FrameFreshnessGate(); await gate.select(.glasses)
    let first = try await admit(gate, at: 0)
    let overlap = await gate.begin(capturedAt: 0.01, now: 0.01); XCTAssertNil(overlap)
    let accepted = await gate.complete(first, placements: [pose()], now: 0.02); XCTAssertTrue(accepted)
    let throttled = await gate.begin(capturedAt: 0.09, now: 0.09); XCTAssertNil(throttled)
    let next = await gate.begin(capturedAt: 0.11, now: 0.11); XCTAssertNotNil(next)
  }
  func testStaleCaptureAndFutureCaptureCannotAdmit() async {
    let gate = FrameFreshnessGate(); await gate.select(.glasses)
    for (capture, now) in [(0.0, 0.2), (0.3, 0.2), (-1.0, 0.2), (Double.nan, 0.2), (Double.infinity, 0.2)] {
      let ticket = await gate.begin(capturedAt: capture, now: now); XCTAssertNil(ticket)
    }
    let fresh = await gate.begin(capturedAt: 0.21, now: 0.21); XCTAssertNotNil(fresh)
  }
  func testExpiredCompletionReleasesOwnershipWithoutPainting() async throws {
    let gate = FrameFreshnessGate(); await gate.select(.glasses)
    let ticket = try await admit(gate, at: 0)
    let accepted = await gate.complete(ticket, placements: [pose()], now: 0.16)
    let overlay = await gate.current(now: 0.17), next = await gate.begin(capturedAt: 0.18, now: 0.18)
    XCTAssertFalse(accepted); XCTAssertTrue(overlay.isEmpty); XCTAssertNotNil(next)
  }
  func testOverlayExpiresFromCaptureTimestampNotCompletionTimestamp() async throws {
    let gate = FrameFreshnessGate(); await gate.select(.glasses)
    let ticket = try await admit(gate, at: 0)
    let accepted = await gate.complete(ticket, placements: [pose()], now: 0.1); XCTAssertTrue(accepted)
    let fresh = await gate.current(now: 0.149), expired = await gate.current(now: 0.151)
    XCTAssertEqual(fresh, [pose()]); XCTAssertTrue(expired.isEmpty)
  }
  func testEffectChangeRetainsPendingUntilOldAcknowledgementAndNeverPaintsOldEffect() async throws {
    let gate = FrameFreshnessGate(); await gate.select(.glasses)
    let old = try await admit(gate, at: 0); await gate.select(.crown)
    let blocked = await gate.begin(capturedAt: 0.02, now: 0.02); XCTAssertNil(blocked)
    let oldPaint = await gate.complete(old, placements: [pose()], now: 0.03); XCTAssertFalse(oldPaint)
    let next = try await admit(gate, at: 0.04)
    let duplicate = await gate.complete(old, placements: [pose()], now: 0.05)
    let overlap = await gate.begin(capturedAt: 0.06, now: 0.06)
    XCTAssertFalse(duplicate); XCTAssertNil(overlap)
    let painted = await gate.complete(next, placements: [pose(.crown)], now: 0.07)
    let overlay = await gate.current(now: 0.08)
    XCTAssertTrue(painted); XCTAssertEqual(overlay, [pose(.crown)])
  }
  func testSuspendResumeRetainsPhysicalPendingAndRequiresFreshResult() async throws {
    let gate = FrameFreshnessGate(); await gate.select(.glasses)
    let old = try await admit(gate, at: 0); await gate.suspend()
    let suspended = await gate.begin(capturedAt: 0.01, now: 0.01); XCTAssertNil(suspended)
    await gate.resume(); let blocked = await gate.begin(capturedAt: 0.02, now: 0.02); XCTAssertNil(blocked)
    let stale = await gate.complete(old, placements: [pose()], now: 0.03); XCTAssertFalse(stale)
    let next = try await admit(gate, at: 0.04)
    let accepted = await gate.complete(next, placements: [pose()], now: 0.05); XCTAssertTrue(accepted)
  }
  func testSelectingNoneClearsOverlayAndCannotResurrectItOnResume() async throws {
    let gate = FrameFreshnessGate(); await gate.select(.glasses)
    let ticket = try await admit(gate, at: 0)
    let accepted = await gate.complete(ticket, placements: [pose()], now: 0.01); XCTAssertTrue(accepted)
    await gate.select(.none); await gate.resume()
    let overlay = await gate.current(now: 0.02), ticketAfterNone = await gate.begin(capturedAt: 0.03, now: 0.03)
    XCTAssertTrue(overlay.isEmpty); XCTAssertNil(ticketAfterNone)
  }
  func testDropoutClearsPreviousOverlayRatherThanHoldingLastFace() async throws {
    let gate = FrameFreshnessGate(); await gate.select(.glasses)
    let first = try await admit(gate, at: 0)
    let firstAccepted = await gate.complete(first, placements: [pose()], now: 0.01); XCTAssertTrue(firstAccepted)
    let next = try await admit(gate, at: 0.11)
    let dropout = await gate.complete(next, placements: [], now: 0.12)
    let overlay = await gate.current(now: 0.13)
    XCTAssertTrue(dropout); XCTAssertTrue(overlay.isEmpty)
  }
  func testRewindAndNonfiniteClockInvalidateButDoNotReleasePhysicalPending() async throws {
    for invalid in [Double.nan, .infinity, -1, 0.5] {
      let gate = FrameFreshnessGate(); await gate.select(.glasses)
      let old = try await admit(gate, at: 1)
      let invalidOverlay = await gate.current(now: invalid); XCTAssertTrue(invalidOverlay.isEmpty)
      let blocked = await gate.begin(capturedAt: 1.01, now: 1.01); XCTAssertNil(blocked)
      let stale = await gate.complete(old, placements: [pose()], now: 1.02); XCTAssertFalse(stale)
      let next = await gate.begin(capturedAt: 1.03, now: 1.03); XCTAssertNotNil(next)
    }
  }
  func testUnknownCompletionCannotClearNewPendingOrReplaceCurrentOverlay() async throws {
    let gate = FrameFreshnessGate(); await gate.select(.glasses)
    let first = try await admit(gate, at: 0)
    let firstAccepted = await gate.complete(first, placements: [pose()], now: 0.01); XCTAssertTrue(firstAccepted)
    let next = try await admit(gate, at: 0.11)
    let duplicate = await gate.complete(first, placements: [], now: 0.12)
    let overlap = await gate.begin(capturedAt: 0.13, now: 0.13), overlay = await gate.current(now: 0.14)
    XCTAssertFalse(duplicate); XCTAssertNil(overlap); XCTAssertEqual(overlay, [pose()])
    let accepted = await gate.complete(next, placements: [pose()], now: 0.145); XCTAssertTrue(accepted)
  }
  func testWrongEffectNonfiniteAndOverloadPlacementsAreRejected() async throws {
    let invalid = AccessoryPlacement(accessory: .glasses, center: UnitPoint(x: .nan, y: 0.5), width: 0.3, height: 0.1, rotation: 0)
    for placements in [[pose(.crown)], [invalid], Array(repeating: pose(), count: 7)] {
      let gate = FrameFreshnessGate(); await gate.select(.glasses)
      let ticket = try await admit(gate, at: 0)
      let accepted = await gate.complete(ticket, placements: placements, now: 0.01)
      let overlay = await gate.current(now: 0.02)
      XCTAssertFalse(accepted); XCTAssertTrue(overlay.isEmpty)
    }
    let gate = FrameFreshnessGate(); await gate.select(.glasses)
    let ticket = try await admit(gate, at: 0)
    let accepted = await gate.complete(ticket, placements: Array(repeating: pose(), count: 6), now: 0.01)
    XCTAssertTrue(accepted)
  }
  func testInvalidConfigurationUsesSafeDefaultAgeAndThrottle() async throws {
    let gate = FrameFreshnessGate(maximumAge: .nan, minimumInterval: -1); await gate.select(.glasses)
    let first = try await admit(gate, at: 0)
    let accepted = await gate.complete(first, placements: [pose()], now: 0.01); XCTAssertTrue(accepted)
    let throttled = await gate.begin(capturedAt: 0.05, now: 0.05); XCTAssertNil(throttled)
    let expired = await gate.current(now: 0.151); XCTAssertTrue(expired.isEmpty)
    let next = await gate.begin(capturedAt: 0.16, now: 0.16); XCTAssertNotNil(next)
  }
}
