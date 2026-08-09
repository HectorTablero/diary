import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* The last thing between a render-time crash and a blank white screen.
 *
 * It is the one component in the app whose entire job only ever runs when something else has
 * already gone wrong — which is exactly why it rots unnoticed. A boundary that stopped catching, or
 * stopped reporting, looks identical to one that simply never fires.
 *
 * `renderWithProviders` is deliberately not used here: it keeps the boundary *off* by default,
 * because a boundary around a test turns a crashing component into a passing test with a
 * confidently wrong assertion. This file is the one place that wants it, so it renders the
 * boundary directly.
 */

const telemetry = vi.hoisted(() => ({
  captured: [] as { error: unknown; fields: Record<string, unknown> }[],
}));
vi.mock('@/lib/telemetry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/telemetry')>()),
  captureError: (error: unknown, fields: Record<string, unknown> = {}) =>
    telemetry.captured.push({ error, fields }),
}));

const { ErrorBoundary } = await import('./ErrorBoundary');

function Boom(): never {
  throw new Error('render exploded');
}

/* React logs every caught error to console.error regardless of the boundary, so a passing run would
   otherwise print two stack traces per test and look like a failure. Silenced per test rather than
   globally, so a genuine unexpected console.error elsewhere still shows. */
let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  telemetry.captured = [];
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => consoleError.mockRestore());

describe('ErrorBoundary', () => {
  it('renders its children when nothing is wrong', () => {
    render(
      <ErrorBoundary>
        <p>The diary</p>
      </ErrorBoundary>,
    );

    expect(screen.getByText('The diary')).toBeInTheDocument();
  });

  it('replaces a crash with something a person can act on', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    // The sentence that matters most, and the one only this component can say: a render crash does
    // not touch IndexedDB, so nothing the user wrote is at risk.
    expect(screen.getByText(/entries are safe on this device/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
  });

  it('reports the crash, with the component stack', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );

    /* Without this a crash on somebody else's device is invisible forever — there is no other
       channel. The component stack is what makes one actionable rather than just a count. */
    expect(telemetry.captured).toHaveLength(1);
    expect((telemetry.captured[0].error as Error).message).toBe('render exploded');
    expect(telemetry.captured[0].fields.source).toBe('react');
    expect(telemetry.captured[0].fields.component_stack).toBeTruthy();
  });

  it('offers a reload, which is the only recovery a crashed tree has', async () => {
    const reload = vi.fn();
    /* jsdom's `location.reload` is not writable, so the property is replaced outright. Restored by
       nothing — each test file gets its own jsdom window. */
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload },
    });
    const user = userEvent.setup();
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );

    await user.click(screen.getByRole('button', { name: 'Reload' }));

    // Not a `setState` back to the children: whatever state produced the crash is still there, so
    // re-rendering the same tree would simply crash again.
    expect(reload).toHaveBeenCalled();
  });

  it('uses the i18next singleton, so its text survives the app failing to mount', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );

    /* Rendered without a `useTranslation` hook anywhere above it — deliberately, because the
       boundary has to be able to render when the tree that would have provided one is the thing
       that just crashed. Real English from the real bundle, so a renamed key fails here. */
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });
});
