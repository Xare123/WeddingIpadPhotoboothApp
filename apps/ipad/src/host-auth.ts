import * as LocalAuthentication from 'expo-local-authentication';

export async function authenticateHost(): Promise<void> {
  const level = await LocalAuthentication.getEnrolledLevelAsync();
  if (level === LocalAuthentication.SecurityLevel.NONE) {
    throw new Error('Enable an iPad passcode before configuring booth sharing.');
  }
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: 'Unlock booth host settings',
    cancelLabel: 'Cancel',
    fallbackLabel: 'Use iPad passcode',
    disableDeviceFallback: false,
  });
  if (!result.success) throw new Error('Host authentication is required to change sharing settings.');
}
