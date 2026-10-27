/** Native adapter stays separate so the OS policy/error contract can be tested without Expo. */
export type HostAuthenticationAPI = {
  getEnrolledLevelAsync(): Promise<number>;
  authenticateAsync(options: {
    promptMessage: string; cancelLabel: string; disableDeviceFallback: false;
  }): Promise<{ success: boolean; error?: string }>;
};
const codes = ['passcode_not_set', 'user_cancel', 'system_cancel', 'app_cancel', 'user_fallback',
  'lockout', 'not_enrolled', 'not_available', 'authentication_failed', 'unknown'] as const;
export type HostAuthenticationCode = typeof codes[number];
class HostAuthenticationError extends Error {
  constructor(readonly code: HostAuthenticationCode, message: string) { super(message); }
}
function safeCode(code?: string): HostAuthenticationCode {
  return codes.find(value => value === code) ?? 'unknown';
}
export function hostAuthenticationCode(error: unknown): HostAuthenticationCode {
  return error instanceof HostAuthenticationError ? error.code : 'unknown';
}

function failureMessage(code?: string): string {
  switch (code) {
    case 'passcode_not_set': return 'Enable an iPad passcode in Settings before opening host settings.';
    case 'user_cancel': return 'Host settings stayed locked. Tap Host when you are ready to unlock them.';
    case 'system_cancel':
    case 'app_cancel': return 'The iPad interrupted authentication. Return to the booth and tap Host to try again.';
    case 'user_fallback': return 'The iPad did not complete passcode authentication. Tap Host again and use the system passcode option.';
    case 'lockout': return 'Unlock this iPad with its device passcode, then return to the booth and tap Host again.';
    case 'not_enrolled':
    case 'not_available': return 'Device authentication is unavailable. Check this iPad’s passcode settings, then try Host again.';
    case 'authentication_failed': return 'The iPad could not verify you. Tap Host to try the device passcode or biometrics again.';
    default: return 'Host authentication did not complete. Tap Host to try this iPad’s passcode or biometrics again.';
  }
}

export function createHostAuthenticator(api: HostAuthenticationAPI): () => Promise<void> {
  return async () => {
    let level: number;
    try { level = await api.getEnrolledLevelAsync(); }
    catch { throw new HostAuthenticationError('not_available', 'Device authentication is unavailable. Return to the booth and tap Host to try again.'); }
    if (level === 0) throw new HostAuthenticationError('passcode_not_set', 'Enable an iPad passcode before configuring booth sharing.');
    let result: Awaited<ReturnType<HostAuthenticationAPI['authenticateAsync']>>;
    try {
      result = await api.authenticateAsync({
        promptMessage: 'Unlock booth host settings', cancelLabel: 'Cancel', disableDeviceFallback: false,
      });
    } catch { throw new HostAuthenticationError('not_available', 'The iPad could not open authentication. Return to the booth and tap Host to try again.'); }
    // The system owns passcode entry. SDK58 maps false to deviceOwnerAuthentication;
    // leave its fallback title/route at the OS default rather than handling an app PIN.
    if (result.success !== true) throw new HostAuthenticationError(safeCode(result.error), failureMessage(result.error));
  };
}
