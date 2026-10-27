import Foundation

/// Future live-preview admission logic only: this owns no camera/session/output.
/// Callers supply monotonic seconds. Only transient accessory poses are held here.
public actor FrameFreshnessGate {
  public struct Ticket: Equatable, Sendable {
    public let epoch: UInt64, sequence: UInt64, capturedAt: Double
  }
  private let maximumAge: Double, minimumInterval: Double
  private var epoch: UInt64 = 0, sequence: UInt64 = 0
  private var accessory: FaceAccessory = .none
  private var enabled = false
  private var pending: Ticket?
  private var lastAdmission: Double?, lastTime: Double?, overlayAt: Double?
  private var overlay: [AccessoryPlacement] = []

  public init(maximumAge: Double = 0.15, minimumInterval: Double = 0.1) {
    self.maximumAge = maximumAge.isFinite && (0.02...1).contains(maximumAge) ? maximumAge : 0.15
    self.minimumInterval = minimumInterval.isFinite && (0.02...1).contains(minimumInterval) ? minimumInterval : 0.1
  }
  private func invalidate() {
    // Generation invalidation cannot prove a native request stopped. Keep its
    // ownership until its completion/cancellation is acknowledged.
    epoch &+= 1; overlay = []; overlayAt = nil; lastAdmission = nil
  }
  public func select(_ value: FaceAccessory) {
    invalidate(); accessory = value; enabled = value != .none
  }
  public func suspend() { invalidate(); enabled = false }
  public func resume() { invalidate(); enabled = accessory != .none }
  private func observe(_ now: Double) -> Bool {
    guard now.isFinite, now >= 0 else { invalidate(); return false }
    if let lastTime, now < lastTime { invalidate(); self.lastTime = now; return false }
    lastTime = now; return true
  }
  public func begin(capturedAt: Double, now: Double) -> Ticket? {
    guard observe(now), enabled, pending == nil, capturedAt.isFinite, capturedAt >= 0,
      capturedAt <= now, now - capturedAt <= maximumAge,
      lastAdmission.map({ now - $0 >= minimumInterval }) ?? true else { return nil }
    sequence &+= 1
    let ticket = Ticket(epoch: epoch, sequence: sequence, capturedAt: capturedAt)
    pending = ticket; lastAdmission = now; return ticket
  }
  @discardableResult
  public func complete(_ ticket: Ticket, placements: [AccessoryPlacement], now: Double) -> Bool {
    let clockValid = observe(now)
    guard pending == ticket else { return false }
    pending = nil
    guard clockValid, enabled, ticket.epoch == epoch,
      now - ticket.capturedAt >= 0, now - ticket.capturedAt <= maximumAge,
      placements.count <= FaceGeometry.maximumFaces,
      placements.allSatisfy({ $0.finite && $0.accessory == accessory }) else {
      overlay = []; overlayAt = nil; return false
    }
    overlay = placements; overlayAt = ticket.capturedAt; return true
  }
  public func current(now: Double) -> [AccessoryPlacement] {
    guard observe(now), enabled, let overlayAt, now - overlayAt >= 0,
      now - overlayAt <= maximumAge else { overlay = []; self.overlayAt = nil; return [] }
    return overlay
  }
}
