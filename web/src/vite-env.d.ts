/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/* Build-time constants injected by `define` in vite.config.ts. They describe the *running*
   bundle, which after an Android live update is no longer the one shipped inside the APK. */

/** Root package.json version, e.g. "2.4.0" — the single source of truth for the app version. */
declare const __APP_VERSION__: string;
/** ISO timestamp of when this bundle was built. */
declare const __BUILD_TIME__: string;
/** Hash of the Capacitor plugin set + config this bundle was built against. */
declare const __NATIVE_FINGERPRINT__: string;
