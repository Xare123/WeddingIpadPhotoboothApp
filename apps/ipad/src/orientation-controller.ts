export type OrientationChoice = 'auto' | 'portrait' | 'landscape';
export type RequestedOrientationLock = 'default' | 'portrait-up' | 'landscape';
export type ObservedOrientationLock = RequestedOrientationLock | 'other' | 'unknown';
export type ObservedOrientation = 'portrait-up' | 'portrait-down' | 'landscape-left' | 'landscape-right' | 'unknown';
export type OrientationBlocker = 'countdown' | 'capture' | 'save' | 'editor';
export type OrientationObservation = Readonly<{
  orientation: ObservedOrientation;
  lock: ObservedOrientationLock;
  width: number;
  height: number;
}>;
export type OrientationContext = Readonly<{ active: boolean; blockers: readonly OrientationBlocker[] }>;
type Cancel = () => void;
export type OrientationPort = {
  readonly available: boolean;
  /** Synchronous presentation/capture admission, including before React passive effects. */
  isRequestSafe?(): boolean;
  supports(lock: RequestedOrientationLock): Promise<boolean>;
  request(lock: RequestedOrientationLock): Promise<void>;
  readObservation(): Promise<OrientationObservation>;
  subscribe(listener: (observation: OrientationObservation) => void, onError?: (code: OrientationError) => void): Cancel;
  schedule(delayMs: number, callback: () => void): Cancel;
};
export type OrientationStatus = 'deferred' | 'requesting' | 'requested' | 'observed' | 'unconfirmed' | 'unsupported' | 'error' | 'disposed';
export type OrientationError = 'native-unavailable' | 'native-timeout' | 'support-unavailable' | 'request-failed' | 'observation-unavailable';
export type OrientationState = Readonly<{
  desired: OrientationChoice;
  status: OrientationStatus;
  observation: OrientationObservation | null;
  windowMismatch: boolean;
  error: OrientationError | null;
}>;
export type OrientationOptions = {
  initialPreference?: unknown;
  settleMs?: number;
  nativeTimeoutMs?: number;
  onState?: (state: OrientationState) => void;
};

export function parseOrientationChoice(value: unknown): OrientationChoice | null {
  return value === 'auto' || value === 'portrait' || value === 'landscape' ? value : null;
}
export function requestedOrientationLock(choice: OrientationChoice): RequestedOrientationLock {
  return choice === 'auto' ? 'default' : choice === 'portrait' ? 'portrait-up' : 'landscape';
}
function family(value: ObservedOrientation): 'portrait' | 'landscape' | 'unknown' {
  return value === 'portrait-up' || value === 'portrait-down' ? 'portrait'
    : value === 'landscape-left' || value === 'landscape-right' ? 'landscape' : 'unknown';
}
function validObservation(value: OrientationObservation): boolean {
  return value !== null && typeof value === 'object'
    && ['portrait-up', 'portrait-down', 'landscape-left', 'landscape-right', 'unknown'].includes(value.orientation)
    && ['default', 'portrait-up', 'landscape', 'other', 'unknown'].includes(value.lock)
    && Number.isFinite(value.width) && Number.isFinite(value.height)
    && value.width > 0 && value.height > 0;
}
function matches(choice: OrientationChoice, value: OrientationObservation | null): boolean {
  if (!value || value.lock !== requestedOrientationLock(choice) || value.orientation === 'unknown') return false;
  if (choice === 'auto') return true; // The Auto policy was observed, not future OS rotation.
  if (choice === 'portrait') return value.orientation === 'portrait-up' && value.height > value.width;
  return family(value.orientation) === 'landscape' && value.width > value.height;
}
function safeError(error: unknown, fallback: OrientationError): OrientationError {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'native-unavailable'
    ? 'native-unavailable' : fallback;
}

/** Receives committed preferences only. It never reads/writes preferences, photos or credentials.
 * "observed" is fresh policy/interface/window evidence, never a guaranteed permanent OS lock.
 */
export class OrientationController {
  private port: OrientationPort;
  private onState: (state: OrientationState) => void;
  private settleMs: number;
  private nativeTimeoutMs: number;
  private context: OrientationContext = { active: false, blockers: [] };
  private desired: OrientationChoice;
  private revision = 0;
  private retryRevision = 0;
  private epoch = 0;
  private disposed = false;
  private disposedState: OrientationState | null = null;
  private nativeBusy = false;
  private operation: { key: string; timedOut: boolean; finished: boolean; cancel: Cancel | null } | null = null;
  private attemptedKey: string | null = null;
  private acceptedKey: string | null = null;
  private outcome: { key: string; kind: 'requested' | 'unsupported' | 'error'; error?: OrientationError } | null = null;
  private observation: OrientationObservation | null = null;
  private observationError: OrientationError | null = null;
  private subscriptionError: OrientationError | null = null;
  private readTicket = 0;
  private unsubscribe: Cancel | null = null;
  private cancelTimer: Cancel | null = null;
  private timerRevision = 0;
  private settled = false;

  constructor(port: OrientationPort, options: OrientationOptions = {}) {
    this.port = port;
    this.desired = parseOrientationChoice(options.initialPreference) ?? 'auto';
    this.settleMs = options.settleMs ?? 2000;
    this.nativeTimeoutMs = options.nativeTimeoutMs ?? 5000;
    if (!Number.isFinite(this.settleMs) || this.settleMs <= 0) throw new TypeError('Invalid observation deadline');
    if (!Number.isFinite(this.nativeTimeoutMs) || this.nativeTimeoutMs <= 0) throw new TypeError('Invalid native deadline');
    this.onState = options.onState ?? (() => {});
  }
  setCommittedPreference(value: unknown): void {
    if (this.disposed) return;
    const choice = parseOrientationChoice(value) ?? 'auto';
    if (choice === this.desired) return;
    this.desired = choice;
    this.revision++;
    this.acceptedKey = null;
    this.observation = null;
    this.observationError = null;
    this.settled = false;
    this.stopTimer();
    this.emit();
    this.reconcile();
  }
  retry(): void {
    if (this.disposed) return;
    this.retryRevision++;
    this.acceptedKey = null;
    this.observation = null;
    this.observationError = null;
    this.settled = false;
    this.stopTimer();
    this.emit();
    this.reconcile();
  }
  setContext(next: OrientationContext): void {
    if (this.disposed) return;
    const blockers = [...new Set(next.blockers)].sort();
    if (next.active === this.context.active && blockers.length === this.context.blockers.length
      && blockers.every((value, index) => value === this.context.blockers[index])) return;
    const previousActive = this.context.active;
    const wasSafe = this.safe();
    this.context = { active: next.active, blockers };
    if (previousActive !== next.active) {
      this.epoch++;
      this.readTicket++;
      this.unsubscribe?.();
      this.unsubscribe = null;
      this.observation = null;
      this.observationError = null;
      this.subscriptionError = null;
      this.acceptedKey = null;
      if (next.active) {
        const epoch = this.epoch;
        try {
          this.unsubscribe = this.port.subscribe(value => {
            if (this.disposed || !this.context.active || epoch !== this.epoch) return;
            this.readTicket++; // A later event supersedes an older asynchronous snapshot.
            this.acceptObservation(value);
          }, code => {
            if (this.disposed || !this.context.active || epoch !== this.epoch) return;
            this.readTicket++;
            this.failObservation(code === 'native-unavailable' ? code : 'observation-unavailable');
          });
        } catch (error) {
          this.subscriptionError = safeError(error, 'observation-unavailable');
        }
      }
    }
    if (!this.safe()) { this.stopTimer(); this.settled = false; }
    this.emit();
    if (next.active && (!previousActive || (!wasSafe && this.safe()))) this.refresh();
    this.reconcile();
  }
  refresh(): void {
    if (this.disposed || !this.context.active) return;
    const ticket = ++this.readTicket;
    const epoch = this.epoch;
    void (async () => {
      try {
        const value = await this.port.readObservation();
        if (this.disposed || !this.context.active || epoch !== this.epoch || ticket !== this.readTicket) return;
        this.acceptObservation(value);
      } catch (error) {
        if (this.disposed || !this.context.active || epoch !== this.epoch || ticket !== this.readTicket) return;
        this.failObservation(safeError(error, 'observation-unavailable'));
      }
    })();
  }
  getState(): OrientationState {
    if (this.disposedState) return this.disposedState;
    const key = this.key();
    let status: OrientationStatus;
    if (this.disposed) status = 'disposed';
    else if (!this.safe()) status = 'deferred';
    else if (this.nativeBusy) status = this.operation?.timedOut ? 'error' : 'requesting';
    else if (this.outcome?.key === key && this.outcome.kind === 'unsupported') status = 'unsupported';
    else if (this.outcome?.key === key && this.outcome.kind === 'error') status = 'error';
    else if (this.subscriptionError) status = 'error';
    else if (this.acceptedKey === key && matches(this.desired, this.observation)) status = 'observed';
    else if (this.acceptedKey === key) status = this.settled ? 'unconfirmed' : 'requested';
    else status = 'requested';
    const geometry = this.observation && this.observation.width !== this.observation.height
      ? (this.observation.width > this.observation.height ? 'landscape' : 'portrait') : 'unknown';
    const screen = this.observation ? family(this.observation.orientation) : 'unknown';
    return Object.freeze({
      desired: this.desired, status, observation: this.observation,
      windowMismatch: geometry !== 'unknown' && screen !== 'unknown' && geometry !== screen,
      error: this.operation?.timedOut ? 'native-timeout'
        : this.subscriptionError ?? (this.outcome?.key === key ? this.outcome.error ?? this.observationError : this.observationError),
    });
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.readTicket++;
    this.epoch++;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.stopTimer();
    this.operation?.cancel?.();
    this.disposedState = this.getState();
    this.emit();
  }
  private safe(): boolean {
    try { return this.context.active && this.context.blockers.length === 0 && (this.port.isRequestSafe?.() ?? true); }
    catch { return false; }
  }
  private key(): string { return [this.revision, this.retryRevision, this.epoch].join(':'); }
  private emit(): void { this.onState(this.getState()); }
  private acceptObservation(value: OrientationObservation): void {
    if (!validObservation(value)) {
      this.failObservation('observation-unavailable');
      return;
    }
    this.observation = Object.freeze({
      orientation: value.orientation, lock: value.lock, width: value.width, height: value.height,
    });
    this.observationError = null;
    this.updateTimer();
    this.emit();
  }
  private failObservation(code: OrientationError): void {
    this.observation = null;
    this.observationError = code;
    this.updateTimer();
    this.emit();
  }
  private stopTimer(): void {
    this.timerRevision++;
    this.cancelTimer?.();
    this.cancelTimer = null;
  }
  private updateTimer(): void {
    if (this.disposed || !this.safe() || this.acceptedKey !== this.key()) return;
    if (matches(this.desired, this.observation)) {
      this.stopTimer();
      this.settled = false;
      return;
    }
    if (this.cancelTimer || this.settled) return;
    const revision = ++this.timerRevision;
    const key = this.key();
    this.cancelTimer = this.port.schedule(this.settleMs, () => {
      if (this.disposed || !this.safe() || key !== this.key() || revision !== this.timerRevision) return;
      this.cancelTimer = null;
      this.settled = true;
      this.emit();
    });
  }
  private reconcile(): void {
    if (this.disposed || !this.safe() || this.nativeBusy) return;
    const key = this.key();
    if (this.acceptedKey === key) { this.updateTimer(); return; }
    if (this.attemptedKey === key) return;
    this.attemptedKey = key;
    this.nativeBusy = true;
    const operation = { key, timedOut: false, finished: false, cancel: null as Cancel | null };
    this.operation = operation;
    operation.cancel = this.port.schedule(this.nativeTimeoutMs, () => {
      if (this.disposed || operation.finished || this.operation !== operation) return;
      operation.timedOut = true;
      this.readTicket++;
      this.acceptedKey = null;
      this.observation = null;
      this.stopTimer();
      this.outcome = { key, kind: 'error', error: 'native-timeout' };
      this.emit();
    });
    this.emit();
    const lock = requestedOrientationLock(this.desired);
    void (async () => {
      let stage: OrientationError = 'support-unavailable';
      try {
        const supported = await this.port.supports(lock);
        if (this.disposed || operation.timedOut || key !== this.key()) return;
        if (!this.safe()) { this.attemptedKey = null; return; }
        if (!supported) { this.outcome = { key, kind: 'unsupported' }; return; }
        stage = 'request-failed';
        this.readTicket++;
        this.observation = null; // Pre-request snapshots cannot establish this request's outcome.
        await this.port.request(lock);
        if (this.disposed || operation.timedOut || key !== this.key()) return;
        this.acceptedKey = key;
        this.outcome = { key, kind: 'requested' };
        this.settled = false;
        this.refresh();
        this.updateTimer();
      } catch (error) {
        if (!this.disposed && !operation.timedOut && key === this.key()) this.outcome = { key, kind: 'error', error: safeError(error, stage) };
      } finally {
        operation.finished = true;
        operation.cancel?.();
        if (this.operation === operation) this.operation = null;
        if (!this.disposed) { this.nativeBusy = false; this.emit(); this.reconcile(); }
      }
    })();
  }
}

export function createOrientationController(port: OrientationPort, options: OrientationOptions = {}): OrientationController {
  return new OrientationController(port, options);
}
