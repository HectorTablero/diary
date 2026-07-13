import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { toast } from 'sonner';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { Toaster } from './components/ui/sonner';
import { TooltipProvider } from './components/ui/tooltip';
import { initSync, onReconnected, onSyncApplied } from './db/sync';
import { initAuthToken } from './lib/authToken';
import { initGlobalHaptics } from './lib/haptics';
import { isNative } from './lib/native';
import { initLocalNotifications, refreshNotifications } from './lib/notifications';
import i18n from './i18n';
import './index.css';

// The Capacitor app ships its assets in the APK; a service worker would only
// fight app updates there.
if (!isNative) registerSW({ immediate: true });

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
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={300}>
          <App />
          <Toaster position="top-center" />
        </TooltipProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
  // Boot splash (index.html) finishes its morph and fades out.
  (window as unknown as { __bootSplashHide?: () => void }).__bootSplashHide?.();
}

void bootstrap();
