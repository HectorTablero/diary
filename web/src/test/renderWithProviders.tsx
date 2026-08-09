import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { StrictMode, type ReactNode } from 'react';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { queryClient as appQueryClient } from '@/lib/queryClient';

/* The provider stack from main.tsx, minus the parts that would make a test lie.
 *
 * Every component test before this one wired its own context by hand, which is why none of them
 * could render anything reaching `api/hooks.ts` (no QueryClientProvider), a tooltip (no
 * TooltipProvider) or a link (no router — DeleteAccountDialog.test.tsx has to `vi.mock` react-router
 * wholesale to get around it). */

export interface RenderOptions {
  /** Route pattern to mount `ui` at, e.g. 'diary/:date'. Default '/'. */
  path?: string;
  /** Memory history to start from. Must match `path` when that has parameters. */
  initialEntries?: string[];
  /** A whole route table instead of path+ui — for layouts that render an <Outlet/>. */
  routes?: RouteObject[];
  /** Override the app singleton. Only for a test that touches neither toasts nor undo. */
  client?: QueryClient;
  /** Mount the real Toaster so toasts can be asserted as DOM. Default true. */
  toaster?: boolean;
  /** Default false — see the note below. */
  errorBoundary?: boolean;
  /** Default false — see the note below. */
  strict?: boolean;
}

/**
 * Render a component with everything the app gives it.
 *
 * **Uses the app's singleton QueryClient, not a fresh one.** That looks like the wrong default and
 * isn't: `lib/notify.ts` reads `queryClient.getQueryData(['settings'])` off the *singleton* to decide
 * whether a routine success toast is suppressed, and `lib/undo.ts` invalidates the singleton after a
 * restore (deliberately — the component that owned the deletion has usually unmounted by then).
 * Hand a test its own client and the app fills that one while those two keep reading the singleton:
 * `quietNotifications` falls back to its `true` default, every success toast silently never renders,
 * and Undo restores a row that nothing re-reads. Both failures look like component bugs. The cost is
 * shared state, which `setup.ts` clears between tests.
 *
 * **ErrorBoundary and StrictMode are opt-in.** The boundary catches render errors and shows a
 * friendly message, which turns a crashing component into a *passing* test with a confidently wrong
 * assertion — only `ErrorBoundary.test.tsx` should want it. StrictMode double-invokes every effect,
 * so anything asserting that something happened exactly once (AppLayout fires `kick('signin')` from
 * an effect) becomes untestable.
 *
 * **Reduced motion is forced on.** Framer animates in JavaScript, on a real clock, and jsdom will
 * happily let a test assert against a half-finished transition. `useReducedMotion()` isn't used to
 * decide this because it reaches `@capacitor/core`'s `registerPlugin` at module scope.
 *
 * Returns the router alongside the usual RTL result, so a redirect is asserted as
 * `router.state.location.pathname` rather than by mocking `useNavigate`.
 */
export function renderWithProviders(
  ui: ReactNode,
  options: RenderOptions = {},
): RenderResult & { router: ReturnType<typeof createMemoryRouter> } {
  const {
    path = '/',
    initialEntries = ['/'],
    routes,
    client = appQueryClient,
    toaster = true,
    errorBoundary = false,
    strict = false,
  } = options;

  /* A data router (createMemoryRouter + RouterProvider) rather than <MemoryRouter>, because App.tsx
     uses createBrowserRouter: same router class means <Navigate>, useNavigate, NavLink, pathless
     layout routes and lazy children behave here exactly as they do in the app, and a route table can
     be lifted straight out of App.tsx. Built fresh per render — a router carries navigation state. */
  const router = createMemoryRouter(routes ?? [{ path, element: ui }], { initialEntries });

  let tree: ReactNode = (
    <QueryClientProvider client={client}>
      <MotionConfig reducedMotion="always">
        <TooltipProvider delayDuration={300}>
          <RouterProvider router={router} />
          {toaster && <Toaster position="top-center" />}
        </TooltipProvider>
      </MotionConfig>
    </QueryClientProvider>
  );
  if (errorBoundary) tree = <ErrorBoundary>{tree}</ErrorBoundary>;
  if (strict) tree = <StrictMode>{tree}</StrictMode>;

  return { ...render(tree), router };
}

/* One gotcha worth knowing before writing an assertion against a navigation: react-router 7+ wraps
   navigations in React.startTransition, so the new route is not on screen synchronously after a
   click. Use `await screen.findBy…` (or waitFor on router.state) rather than getBy — the latter will
   find the *old* route and fail in a way that reads like the link is broken. */
