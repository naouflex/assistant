import { installMobileEarlyErrorReporting } from "./lib/monitoring";

installMobileEarlyErrorReporting(require("expo-secure-store"), require("expo-application"));
require("./lib/startup").startMobileStartupWatchdog();
require("./lib/monitoring-bootstrap").startMobileMonitoring();
// While a reply is read aloud in the background, native holds this no-op task so React Native
// keeps firing JS timers (it stops them for a backgrounded app). It ends when native finishes it.
require("react-native").AppRegistry.registerHeadlessTask(
  "AtlasKeepTimers",
  () => () => new Promise<void>(() => undefined),
);
// Expo's entry registers the root component after the early error handler exists.
require("expo-router/entry");
