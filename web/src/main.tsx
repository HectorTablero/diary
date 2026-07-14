import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { toast } from 'sonner';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { Toaster } from './components/ui/sonner';
import { TooltipProvider } from './components/ui/tooltip';
import { initSync, onReconnected, onSyncApplied } from './db/sync';
import { initAuthToken } from './lib/authToken';
import { initGlobalHaptics } from './lib/haptics';
import { initLiveUpdate } from './lib/liveUpdate';
import { isNative } from './lib/native';
import { initLocalNotifications, refreshNotifications } from './lib/notifications';
import { initTelemetry } from './lib/telemetry';
import i18n from './i18n';
import './index.css';

// First, so that anything failing below is reported.
initTelemetry();

// The Capacitor app ships its assets in the APK and updates them via Capgo (lib/liveUpdate.ts);
// a service worker would only fight that. On the web the worker *is* the update mechanism.
if (!isNative) {
  registerSW({
    immediate: true,
    onRegisteredSW(_url, registration) {
      // autoUpdate only re-checks on page load, so an installed PWA left open for days would
      // never notice a deploy. Poll instead — update() is a no-op offline.
      if (!registration) return;
      const check = () => void registration.update().catch(() => {});
      setInterval(check, 60 * 60 * 1000);
      window.addEventListener('online', check);
    },
  });
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

initSync();
initGlobalHaptics();
initLocalNotifications();
// Server changes just landed in the local store: refresh everything on screen.
onSyncApplied(() => queryClient.invalidateQueries());
// Remote-origin changes (another device) can affect who's due for a checkup
// or whether today already has an entry, so re-arm reminders too.
onSyncApplied(() => refreshNotifications());
onReconnected(() => toast.success(i18n.t('sync.reconnected')));

async function bootstrap() {
  // The bearer token must be in memory before anything talks to the API.
  await initAuthToken();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider delayDuration={300}>
            <App />
            <Toaster position="top-center" />
          </TooltipProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </StrictMode>,
  );
  // Boot splash (index.html) finishes its morph and fades out.
  (window as unknown as { __bootSplashHide?: () => void }).__bootSplashHide?.();

  // Deliberately last: initLiveUpdate() calls Capgo's notifyAppReady(), which marks the running
  // bundle as healthy. Reaching this line means the app actually rendered — so a live-updated
  // bundle that crashes on boot never reports itself as good, and Capgo rolls it back.
  void initLiveUpdate();
}

void bootstrap();
