import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'es.tablerus.diary',
  appName: 'Diary',
  webDir: 'dist',
  // Capacitor's native bridge otherwise logs every plugin call (id, method, args) at
  // verbose level in debug builds — e.g. LocalNotifications.getPending() on every
  // refreshNotifications() reconcile. Silence it globally rather than per-call.
  android: {
    loggingBehavior: 'none',
  },
  plugins: {
    SplashScreen: {
      // The native splash is a plain themed background; the animated logo
      // lives in the web boot overlay (index.html), which takes over instantly.
      launchShowDuration: 200,
      // launchShowDuration: 0,
      launchAutoHide: true,
      backgroundColor: '#18181b',
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_notify',
      iconColor: '#0072FF',
    },
    CapacitorUpdater: {
      // Manual mode: web/src/lib/liveUpdate.ts decides what to download and when to apply it,
      // and the bundles come from our own GitHub release. The plugin never contacts Capgo.
      autoUpdate: false,
      // A bundle that does not reach notifyAppReady() within this window is assumed broken and
      // is automatically rolled back to the last working one. This is the OTA safety net.
      appReadyTimeout: 10_000,
    },
  },
};

export default config;
