export type ShotSelection = { id: string; shotIndex?: number };
export type CaptureSession = { id: string; targetCount: number; shots: ShotSelection[]; confirmed: boolean };
export type PendingPhoto = { id: string; uri: string; slot: number };
export type CaptureRunEvent<S> =
  | { kind: 'countdown'; slot: number; remaining: number }
  | { kind: 'saving'; slot: number }
  | { kind: 'saved'; slot: number; session: S }
  | { kind: 'done'; slot: number; session: S; retake: boolean }
  | { kind: 'paused' }
  | { kind: 'error'; session: S; slot: number; photo?: PendingPhoto; error: unknown };

export function nextPhotoSlot(session: CaptureSession): number | null {
  const occupied = new Set(session.shots.map((shot, index) => shot.shotIndex ?? index));
  for (let slot = 0; slot < session.targetCount; slot++) if (!occupied.has(slot)) return slot;
  return null;
}

export function sessionIsComplete(session: CaptureSession): boolean {
  return session.shots.length === session.targetCount && new Set(session.shots.map(shot => shot.id)).size === session.targetCount && nextPhotoSlot(session) === null;
}

export function screenForSession(session: CaptureSession | null): 'attract' | 'camera' | 'review' | 'share' {
  return !session ? 'attract' : session.confirmed ? 'share' : sessionIsComplete(session) ? 'review' : 'camera';
}

export function createSessionCaptureRunner<S extends CaptureSession>(dependencies: {
  capture(slot: number): Promise<{ id: string; uri: string }>;
  save(session: S, photo: PendingPhoto): Promise<S>;
  wait(milliseconds: number): Promise<void>;
  isActive(): boolean;
  onEvent(event: CaptureRunEvent<S>): void;
}) {
  let generation = 0;
  let owner: number | null = null;
  let phase: 'idle' | 'countdown' | 'saving' | 'between' = 'idle';

  function interrupt() {
    if (owner === null) return;
    generation += 1;
    // Saving an exposed photo must finish even after the app leaves foreground.
    // A pending timer can release immediately; its continuation owns no UI flags.
    if (phase !== 'saving') {
      owner = null;
      phase = 'idle';
      dependencies.onEvent({ kind: 'paused' });
    }
  }

  return {
    isBusy: () => owner !== null,
    interrupt,
    cancel() { if (phase === 'saving') return false; interrupt(); return true; },
    async run(initial: S, options: { seconds: number; retakeSlot?: number }): Promise<void> {
      if (owner !== null || initial.confirmed) return;
      if (![2, 3, 5, 8, 10].includes(options.seconds)) throw new Error('Unsupported countdown');
      const attempt = ++generation;
      owner = attempt;
      let session = initial;
      let slot = options.retakeSlot ?? nextPhotoSlot(session);
      if (slot === null || slot < 0 || slot >= initial.targetCount) { owner = null; return; }
      let pending: PendingPhoto | undefined;
      try {
        while (slot !== null) {
          phase = 'countdown';
          for (let remaining = options.seconds; remaining > 0; remaining--) {
            dependencies.onEvent({ kind: 'countdown', slot, remaining });
            await dependencies.wait(1_000);
            if (attempt !== generation || !dependencies.isActive()) return;
          }
          phase = 'saving';
          dependencies.onEvent({ kind: 'saving', slot });
          pending = { ...await dependencies.capture(slot), slot };
          // No thumbnail, next countdown or completed state precedes this await.
          session = await dependencies.save(session, pending);
          dependencies.onEvent({ kind: 'saved', slot, session });
          pending = undefined;
          if (attempt !== generation || !dependencies.isActive()) {
            dependencies.onEvent({ kind: 'paused' });
            return;
          }
          if (options.retakeSlot !== undefined || sessionIsComplete(session)) {
            dependencies.onEvent({ kind: 'done', slot, session, retake: options.retakeSlot !== undefined });
            return;
          }
          phase = 'between';
          await dependencies.wait(300);
          if (attempt !== generation || !dependencies.isActive()) return;
          slot = nextPhotoSlot(session);
        }
      } catch (error) {
        dependencies.onEvent({ kind: 'error', slot: slot ?? 0, session, photo: pending, error });
      } finally {
        if (owner === attempt) { owner = null; phase = 'idle'; }
      }
    },
  };
}
