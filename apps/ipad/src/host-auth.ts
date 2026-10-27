import * as LocalAuthentication from 'expo-local-authentication';
import { createHostAuthenticator } from './host-auth-policy';
export { hostAuthenticationCode } from './host-auth-policy';

export const authenticateHost = createHostAuthenticator(LocalAuthentication);
