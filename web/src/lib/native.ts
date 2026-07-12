import { Capacitor } from '@capacitor/core';

/** True when running inside the Capacitor app (Android webview). */
export const isNative = Capacitor.isNativePlatform();
