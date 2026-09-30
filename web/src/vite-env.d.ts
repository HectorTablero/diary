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

/** Every Lucide icon as data, served by scripts/lucideIcons.mjs. Imported only through
    src/components/icons/lucideIcons.ts, which is what keeps it out of the eager bundle. */
declare module 'virtual:lucide-icons' {
  const catalog: {
    marker: string;
    /** The lucide-react version the icons were read from. */
    version: string;
    /** Canonical kebab-case name → the icon's SVG children, without React keys. */
    icons: Record<string, [string, Record<string, string>][]>;
    /** A retired name → the canonical one it became. */
    aliases: Record<string, string>;
  };
  export default catalog;
}
