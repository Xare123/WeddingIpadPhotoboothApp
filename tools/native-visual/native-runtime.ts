/** DEV ONLY: RN-web rendering plus explicit in-memory device lifecycle and settings markers. */
export * from 'react-native-web';
export { AppState } from './fixture-controls';
import { Linking as WebLinking } from 'react-native-web';
import { fixtureControls } from './fixture-controls';
export const Linking = { ...WebLinking, async openSettings() { fixtureControls.openSettingsCalls++; } };
