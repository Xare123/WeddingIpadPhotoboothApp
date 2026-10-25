export type CaptureState = {
  phase: 'camera' | 'countdown' | 'saving' | 'preview' | 'confirmed';
  attempt: number;
  remaining?: number;
  photoId?: string;
  guestUrl?: string;
};
export type CaptureEvent =
  | { type: 'start' }
  | { type: 'tick'; attempt: number }
  | { type: 'interrupt' }
  | { type: 'saved'; attempt: number; photoId: string }
  | { type: 'failed'; attempt: number }
  | { type: 'confirm'; photoId: string }
  | { type: 'ready'; photoId: string; guestUrl: string }
  | { type: 'reset' }
  | { type: 'restore'; photoId: string; confirmed: boolean };

export const createCaptureState = (): CaptureState => ({ phase: 'camera', attempt: 0 });

// The identity return on rejected events lets the native handler atomically
// ignore duplicate taps before React has committed a disabled-button render.
export function captureTransition(state: CaptureState, event: CaptureEvent): CaptureState {
  switch (event.type) {
    case 'start': return state.phase === 'camera'
      ? { phase: 'countdown', attempt: state.attempt + 1, remaining: 3 } : state;
    case 'tick':
      if (state.phase !== 'countdown' || event.attempt !== state.attempt) return state;
      return state.remaining === 1
        ? { phase: 'saving', attempt: state.attempt }
        : { ...state, remaining: (state.remaining ?? 3) - 1 };
    case 'interrupt': return state.phase === 'countdown'
      ? { phase: 'camera', attempt: state.attempt + 1 } : state;
    case 'saved': return state.phase === 'saving' && state.attempt === event.attempt
      ? { phase: 'preview', attempt: state.attempt, photoId: event.photoId } : state;
    case 'failed': return state.attempt === event.attempt && ['countdown', 'saving'].includes(state.phase)
      ? { phase: 'camera', attempt: state.attempt + 1 } : state;
    case 'confirm': return state.phase === 'preview' && state.photoId === event.photoId
      ? { ...state, phase: 'confirmed' } : state;
    case 'ready': return state.phase === 'confirmed' && state.photoId === event.photoId
      ? { ...state, guestUrl: event.guestUrl } : state;
    case 'reset': return state.phase === 'saving' ? state : { phase: 'camera', attempt: state.attempt + 1 };
    case 'restore': return { phase: event.confirmed ? 'confirmed' : 'preview', photoId: event.photoId, attempt: state.attempt + 1 };
  }
}
