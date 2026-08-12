import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  changeLanguage,
  isAutomaticLanguage,
  LANGUAGES,
  resolveLanguage,
  useLanguageAvailability,
  type LanguageCode,
} from '@/i18n';
import { languageFlag } from '@/i18n/flags';
import { notifyError } from '@/lib/notify';
import { cn } from '@/lib/utils';

/**
 * The first screen: is the app in the right language?
 *
 * A list of radios rather than the `Select` that Settings uses, for three reasons that all happen
 * to point the same way. A Radix `Select` portals content with `role="listbox"`, which the Android
 * back listener in App.tsx does not match — so pressing back with the picker open would fall past
 * it and quit the app. An "Automatic" option is meaningless here: the app is *already* in the
 * detected language, so the question on this screen is "did we guess right?", which is a list of
 * answers and not a dropdown with a redundant entry at the top. And a 12rem trigger is a settings
 * control; a first-run screen wants rows a thumb can hit.
 *
 * The availability logic *is* reused, along with its two strings — a language whose file is not on
 * the device and cannot be fetched says so rather than silently doing nothing when tapped.
 */
export function LanguageStep() {
  const { t, i18n } = useTranslation();
  const isAvailable = useLanguageAvailability();
  const current = resolveLanguage(i18n.language);

  const pick = (code: LanguageCode) => {
    /* Tapping the language that is already active, while still following the device, is a
       deliberate no-op. `changeLanguage` writes the `lang` key, and the *absence* of that key is
       what "follow the device" means — so confirming the guess would quietly opt the user out of
       ever following a later system-language change, in exchange for nothing on screen. Choosing a
       different language is a real choice and does write it. */
    if (code === current && isAutomaticLanguage()) return;
    // changeLanguage from @/i18n, not i18n.changeLanguage: that one fetches the strings first, so
    // the switch never lands on an empty bundle and flashes raw keys.
    void changeLanguage(code).catch(() =>
      notifyError(t('settings.general.languageDownloadFailed')),
    );
  };

  /**
   * Arrow keys move between the options instead of between the tour's steps.
   *
   * The shell binds Left/Right to Back/Next, which inside a group of options is the wrong answer to
   * the same key — hence `stopPropagation`. Focus moves *without* selecting, which is the ARIA
   * variant rather than the usual selection-follows-focus one, and deliberately: selecting here
   * downloads a locale, so arrowing down the list would fire four fetches on the way past.
   */
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const delta =
      event.key === 'ArrowDown' || event.key === 'ArrowRight'
        ? 1
        : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
          ? -1
          : 0;
    if (!delta) return;
    event.preventDefault();
    event.stopPropagation();
    const radios = [
      ...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]:not([disabled])'),
    ];
    if (radios.length === 0) return;
    const from = radios.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      from === -1
        ? delta > 0
          ? 0
          : radios.length - 1
        : (from + delta + radios.length) % radios.length;
    radios[next].focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={t('settings.general.language')}
      onKeyDown={onKeyDown}
      className="flex flex-col gap-1.5 lg:grid lg:grid-cols-2 lg:gap-2"
    >
      {LANGUAGES.map((language) => {
        const available = isAvailable(language.code);
        const selected = language.code === current;
        const flag = languageFlag(language.code);
        return (
          <button
            key={language.code}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={!available}
            onClick={() => pick(language.code)}
            className={cn(
              'flex min-h-11 items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-sm transition-colors',
              selected ? 'border-ring bg-accent font-medium' : 'hover:bg-accent/60',
              !available && 'opacity-50',
            )}
          >
            {/* Decorative: the language's name sits right beside it, in that language, and a flag
                is a poor name for a language even when it is the right flag. The empty branch keeps
                the box so labels don't start at different offsets. */}
            {flag ? (
              <img src={flag} alt="" aria-hidden className="size-4 shrink-0 rounded-full" />
            ) : (
              <span aria-hidden className="size-4 shrink-0" />
            )}
            <span className="min-w-0 flex-1 truncate">{language.label}</span>
            {/* Folded into the row's accessible name rather than left to the grey text alone: the
                reason a row cannot be chosen has to reach someone who is not reading the colour. */}
            {!available && (
              <span className="text-xs text-muted-foreground">
                {t('settings.general.languageNeedsConnection')}
              </span>
            )}
            {selected && <Check aria-hidden className="size-4 shrink-0" />}
          </button>
        );
      })}
    </div>
  );
}
