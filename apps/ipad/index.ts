import { probeNativeStartupModules } from './src/native-startup-diagnostics';

// A view import can eagerly create its NativeEventEmitter. Record only fixed
// presence states before App/Expo imports; never suppress their original errors.
probeNativeStartupModules(
  name => require('react-native/Libraries/TurboModule/TurboModuleRegistry').get(name),
  // React Native Release filters info-level logs; this fixed record has no data.
  message => console.error(message),
);
const { registerRootComponent } = require('expo');
const App = require('./App').default;
registerRootComponent(App);
