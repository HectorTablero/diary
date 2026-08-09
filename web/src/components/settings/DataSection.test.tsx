import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/renderWithProviders';
import { seed } from '@/test/seed';
import { getPreferences, resetPreferences } from '@/lib/preferences';

/* The opt-out switch, which is the user-facing half of everything in lib/telemetry.ts.
 *
 * Worth its own test for a reason particular to this control: both of its failure modes are
 * *silent*. A switch that doesn't persist leaves someone believing they turned reporting off while
 * it carries on, and a switch that renders in a build with nowhere to report to is a control that
 * cannot do anything. Neither shows up as an error anywhere. */

/* `isTelemetryConfigured()` reads the build-time env vars, which are absent under test — so the
   toggle is (correctly) hidden by default. Only that one function is replaced; `captureError` and
   the rest stay real, because ErrorBoundary and the db layer import them and a wholesale module
   mock would quietly disarm them. */
const configured = vi.hoisted(() => ({ value: true }));
vi.mock('@/lib/telemetry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/telemetry')>()),
  isTelemetryConfigured: () => configured.value,
}));

// better-auth's useSession would otherwise reach for the network on mount.
vi.mock('@/lib/authClient', () => ({ useSession: () => ({ data: null }) }));

const { DataSection } = await import('./DataSection');

const TOGGLE = 'Send crash reports';

beforeEach(async () => {
  configured.value = true;
  resetPreferences();
  await seed({});
});

afterEach(() => resetPreferences());

const setup = () => ({ user: userEvent.setup(), ...renderWithProviders(<DataSection />) });

describe('DataSection · crash reporting', () => {
  it('is on by default, because the build has somewhere to report to', () => {
    setup();

    expect(screen.getByRole('switch', { name: TOGGLE })).toBeChecked();
  });

  it('turning it off is remembered', async () => {
    const { user } = setup();

    await user.click(screen.getByRole('switch', { name: TOGGLE }));

    /* The preference store, not just the checkbox: lib/telemetry.ts reads `getPreferences()` per
       event rather than caching it at launch, precisely so switching off takes effect immediately.
       This is the assertion that the switch is wired to the thing that decides. */
    await waitFor(() => expect(getPreferences().telemetry).toBe(false));
    expect(screen.getByRole('switch', { name: TOGGLE })).not.toBeChecked();
  });

  it('is not offered at all when the build has nowhere to report to', () => {
    configured.value = false;

    setup();

    // A switch that cannot change anything is worse than an absent one.
    expect(screen.queryByRole('switch', { name: TOGGLE })).not.toBeInTheDocument();
  });

  it('promises in the description exactly what the code does — no content, ever', () => {
    setup();

    expect(
      screen.getByText(/Never entry text, names or notes\./, { exact: false }),
    ).toBeInTheDocument();
  });
});
