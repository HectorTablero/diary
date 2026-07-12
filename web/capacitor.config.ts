import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'es.tablerus.diary',
  appName: 'Diary',
  webDir: 'dist',
  plugins: {
    SplashScreen: {
      // The native splash is a plain themed background; the animated logo
      // lives in the web boot overlay (index.html), which takes over instantly.
      launchShowDuration: 200,
      // launchShowDuration: 0,
      launchAutoHide: true,
      backgroundColor: '#18181b',
    },
  },
};

export default config;
