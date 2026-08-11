import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n, { LANGUAGES, seedCoreLanguage } from '@/i18n';
import es from '@/i18n/locales/es.json';
import { getPreferences, resetPreferences } from '@/lib/preferences';
import { renderWithProviders } from '@/test/renderWithProviders';
import { outboxOps } from '@/test/seed';
import OnboardingFlow from './OnboardingFlow';

/* The first-run tour.
 *
 * Most of what is worth asserting here is *absence*: that a screen full of a fake diary contains no
 * link that could navigate out of it, and that the one interactive demo writes nothing to the local
 * database. Both failures are invisible on screen — the tour would look exactly right and would
 * either abandon itself halfway through or leave a said-mark for a person who does not exist.
 *
 * The Escape test is the other one to keep: on Android the hardware back button arrives here as a
 * synthetic Escape (see App.tsx), so "Escape steps back" is the only coverage that key press has.
 */

/* Spanish is preloaded so the picker can actually switch. `changeLanguage` fetches a locale by URL,
   which in jsdom reaches nothing — seeded here, `ensureLanguage` has nothing left to fetch and the
   switch is the pure state change this file is about.

   `seedCoreLanguage` rather than a bare `addResourceBundle`: the two are not interchangeable any
   more, and the difference is a real bug's worth of meaning. Plugin strings share this bundle, so
   "some resources exist for `es`" stopped implying "the app's own `es` strings are loaded" —
   see the note on `coreLoaded` in i18n/index.ts. */
seedCoreLanguage('es', es);

const setup = () => {
  const onDone = vi.fn();
  return {
    onDone,
    user: userEvent.setup(),
    ...renderWithProviders(<OnboardingFlow onDone={onDone} />),
  };
};

/** The step you are on, read the way a screen reader reads it. */
const heading = () => screen.getByRole('heading', { level: 2 });

const next = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: 'Next' }));
};

beforeEach(async () => {
  resetPreferences();
  await i18n.changeLanguage('en');
  // The detector caches into `lang`, and its *absence* is what "follow the device" means — several
  // assertions below are about whether the tour writes it.
  localStorage.removeItem('lang');
});

afterEach(async () => {
  resetPreferences();
  await i18n.changeLanguage('en');
  localStorage.removeItem('lang');
});

describe('OnboardingFlow · moving through it', () => {
  it('opens on the language step with the focus already there', async () => {
    setup();
    await waitFor(() => expect(heading()).toHaveTextContent('Welcome to your diary'));
    expect(heading()).toHaveFocus();
  });

  it('walks four steps on the web and ends by handing off', async () => {
    const { user, onDone } = setup();

    expect(screen.getByRole('status')).toHaveTextContent('Step 1 of 4');
    await next(user);
    expect(await screen.findByText('Write down what happened')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Step 2 of 4');
    await next(user);
    expect(await screen.findByText('How much did it matter?')).toBeInTheDocument();
    await next(user);
    expect(await screen.findByText('Things worth telling')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Step 4 of 4');

    // The last step's button points at the app, not at another step.
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Get started' }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('moves the focus to the new heading, so the step change is announced', async () => {
    const { user } = setup();
    await next(user);
    const title = await screen.findByText('Write down what happened');
    await waitFor(() => expect(title).toHaveFocus());
  });

  it('goes back, and offers no way back from the first step', async () => {
    const { user } = setup();
    expect(screen.getByRole('button', { name: 'Back' })).toHaveClass('invisible');

    await next(user);
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByText('Welcome to your diary')).toBeInTheDocument();
  });

  it('steps back on Escape rather than closing — this is Android hardware back', async () => {
    const { user, onDone } = setup();
    await next(user);
    await screen.findByText('Write down what happened');

    await user.keyboard('{Escape}');
    expect(await screen.findByText('Welcome to your diary')).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();

    // Only from the first step does back leave the tour.
    await user.keyboard('{Escape}');
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('skips from any step, exactly once', async () => {
    const { user, onDone } = setup();
    await next(user);
    await screen.findByText('Write down what happened');
    await user.click(screen.getByRole('button', { name: 'Skip' }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});

describe('OnboardingFlow · the language step', () => {
  it('offers every shipped language and marks the active one', () => {
    setup();
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(LANGUAGES.length);
    expect(screen.getByRole('radio', { name: /English/ })).toBeChecked();
  });

  it('leaves the device language alone when the tour is simply walked through', async () => {
    const { user } = setup();
    await next(user);
    await screen.findByText('Write down what happened');
    /* The whole point: advancing is not a choice. Writing `lang` here would opt every user out of
       following their device's language for good, in exchange for nothing on screen. */
    expect(localStorage.getItem('lang')).toBeNull();
  });

  it('treats confirming the guessed language as the no-op it is', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('radio', { name: /English/ }));
    expect(localStorage.getItem('lang')).toBeNull();
  });

  it('switches, and the demo entries switch with it', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('radio', { name: /Español/ }));

    await waitFor(() => expect(localStorage.getItem('lang')).toBe('es'));
    expect(await screen.findByText('Te damos la bienvenida a tu diario')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    await screen.findByText('Escribe lo que ha pasado');
    // The demo is rebuilt from `t`, so the fake diary is in the new language too — this is the
    // screen the user is watching when they make the switch.
    expect(screen.getByRole('dialog')).toHaveTextContent('Reunión de #trabajo con @Ana');
  });

  it('moves between options with the arrows instead of stepping the tour', async () => {
    const { user } = setup();
    const [first, second] = screen.getAllByRole('radio');
    first.focus();

    await user.keyboard('{ArrowDown}');
    expect(second).toHaveFocus();
    // Still on step one: the arrow was consumed by the group.
    expect(screen.getByRole('status')).toHaveTextContent('Step 1 of 4');
  });
});

describe('OnboardingFlow · the demo is contained', () => {
  it('renders no link on any step, so nothing can navigate out mid-tour', async () => {
    const { user } = setup();
    for (const title of [
      'Write down what happened',
      'How much did it matter?',
      'Things worth telling',
    ]) {
      expect(screen.queryAllByRole('link')).toHaveLength(0);
      await next(user);
      await screen.findByText(title);
    }
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('shows the entry with its sub-entries, mentions highlighted', async () => {
    const { user } = setup();
    await next(user);
    await screen.findByText('Write down what happened');

    /* Asserted against the dialog rather than by text node: EntryContent puts every @/# token in a
       span of its own, which is the whole point of the screen — so the sentence only exists as the
       concatenation of its parts. */
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Had a #work meeting with @Ana');
    expect(dialog).toHaveTextContent('possible collaboration');
    /* The tokens really are tokens, not text that happens to contain an @ — the failure this
       guards is a locale where the name drifted out of the sentence and segmentContent stopped
       matching, leaving a tour of the sigils in which the sigils visibly do nothing.
       `getAllBy`/`some` because each name appears more than once: inline in the entry, again as a
       chip beneath it, and @Ana again in the sub-entry. */
    const hasClass = (text: string, className: string) =>
      screen.getAllByText(text).some((el) => el.classList.contains(className));
    expect(hasClass('@Ana', 'text-sky-700')).toBe(true);
    expect(hasClass('#work', 'text-emerald-700')).toBe(true);
    // Announced as an example rather than as the reader's own diary.
    expect(screen.getAllByText('Example').length).toBeGreaterThan(0);
  });

  it('fakes "mark as said" without touching the local database', async () => {
    const { user } = setup();
    await next(user);
    await next(user);
    await next(user);
    await screen.findByText('Things worth telling');

    const button = screen.getByRole('button', { name: 'Mark as said' });
    await user.click(button);

    expect(await screen.findByRole('button', { name: /Marked as said/ })).toBeInTheDocument();
    /* The reason this cannot reuse the real TalkingPointItem: its buttons queue an outbox op, which
       on a device that has not signed in yet would be a said-mark for a person who does not exist. */
    expect(await outboxOps()).toHaveLength(0);
  });

  it('previews the people list without making it a list you can get lost in', async () => {
    const { user } = setup();
    await next(user);
    await next(user);
    await next(user);
    await screen.findByText('Things worth telling');

    // The header count, and a third face clipped below so the list reads as a list.
    expect(screen.getByText('276')).toBeInTheDocument();
    expect(screen.getByText('Nadia')).toBeInTheDocument();

    /* Marco twice: once as the leading row, once as the profile that row opens. The whole step is
       the journey between those two, so both halves being on screen is the assertion. */
    expect(screen.getAllByText('Marco')).toHaveLength(2);

    /* And the badge is the tag one. Marco is nowhere in the entry's text — he is on this list
       because he shares its tag, which is the half of the model a mention cannot demonstrate, and
       swapping this for "Mentions them" would quietly make the step a repeat of step two. */
    // Disabled to save space in the onboarding demo. The pill is real on the pc website version
    // expect(screen.getByText('Shared tag')).toBeInTheDocument();
  });

  it('collapses the sub-entry behind the same toggle the profile uses', async () => {
    const { user } = setup();
    await next(user);
    await next(user);
    await next(user);
    await screen.findByText('Things worth telling');

    const dialog = screen.getByRole('dialog');
    // Context rather than something to say, so it is behind the toggle until asked for.
    expect(dialog).not.toHaveTextContent('possible collaboration');

    await user.click(screen.getByRole('button', { name: /1 hidden sub-entry/ }));
    expect(dialog).toHaveTextContent('possible collaboration');

    await user.click(screen.getByRole('button', { name: /Hide sub-entries/ }));
    expect(dialog).not.toHaveTextContent('possible collaboration');
  });
});

describe('OnboardingFlow · the accessibility toggle', () => {
  it('turns importance shapes on from inside the tour, silently', async () => {
    const { user } = setup();
    await next(user);
    await next(user);
    await screen.findByText('How much did it matter?');

    expect(getPreferences().importanceShapes).toBe(false);
    await user.click(screen.getByRole('switch'));
    expect(getPreferences().importanceShapes).toBe(true);

    // No "Saved on this device" toast: the five markers reshaping in place is the confirmation,
    // and a toast over a full-screen modal is noise. Diverges from the Settings switch on purpose.
    expect(screen.queryByText('Saved on this device')).not.toBeInTheDocument();
  });

  it('names all five levels, so the colours are never the only encoding', async () => {
    const { user } = setup();
    await next(user);
    await next(user);
    await screen.findByText('How much did it matter?');

    for (const name of ['Transformative', 'Significant', 'Notable', 'Minor', 'Routine']) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
  });
});
