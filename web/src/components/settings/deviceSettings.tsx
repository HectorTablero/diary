import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import i18n, {
  changeLanguage,
  detectedLanguage,
  followDeviceLanguage,
  isAutomaticLanguage,
  LANGUAGES,
  resolveLanguage,
  useLanguageAvailability,
  type LanguageCode,
} from '@/i18n';
import { languageFlag as flag } from '@/i18n/flags';
import { capitalize, localeWeekStart, weekdayName, type WeekStart } from '@/lib/dates';
import { notifyError } from '@/lib/notify';
import { resolveHour12, setPreference, usePreferences, type Preferences } from '@/lib/preferences';
import { notifyDeviceSaved } from './Section';

/** Which day every month grid starts on: Monday, Sunday, or whatever the chosen language does —
    which is right for almost everyone, and is why it's the default. */
export function WeekStartSetting() {
  const { t, i18n } = useTranslation();
  const { weekStartsOn } = usePreferences();

  /* Weekday names come from date-fns rather than the locale files: they are already translated
     for every shipped language, so this control needs no strings of its own beyond its label.
     They arrive lowercase in Spanish and Italian, which is what "automático (lunes)" wants but
     not what an option standing on its own does — hence capitalize() on one and not the other. */
  const dayName = (day: number) => weekdayName(day, i18n.language);

  return (
    <div className="flex flex-col gap-1.5">
      <Label>{t('settings.general.weekStart')}</Label>
      <Select
        value={String(weekStartsOn)}
        onValueChange={(value) => {
          setPreference('weekStartsOn', value === 'auto' ? 'auto' : (Number(value) as WeekStart));
          notifyDeviceSaved(t('settings.general.savedOnDevice'));
        }}
      >
        <SelectTrigger className="w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="auto">
            {t('settings.general.weekStartAuto', { day: dayName(localeWeekStart(i18n.language)) })}
          </SelectItem>
          {([1, 0] as const).map((day) => (
            <SelectItem key={day} value={String(day)}>
              {capitalize(dayName(day))}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * The language picker, with anything this device can't switch to right now shown as such.
 *
 * Each locale is its own lazily-fetched chunk, so a language that has never been used on this
 * device needs a network the moment it is chosen. That used to be invisible in both directions:
 * the picker offered all five regardless, and a choice that couldn't be downloaded did nothing at
 * all — no change, no toast, an unhandled rejection in a console the user never opens. So the
 * unreachable ones now say why they're greyed out, and any switch that fails anyway says so.
 *
 * Nothing here can strand the user in a language they can't read: the one currently in use is by
 * definition already loaded, which is the first thing `useLanguageAvailability` checks.
 */
/** A language's flag, or a same-sized gap so labels don't start at different offsets. */
function LanguageFlag({ code }: { code: LanguageCode }) {
  /* Decorative: the language's own name is right beside it, in that language. A flag is a poor
     name for a language even when it's the right flag.

     The empty branch keeps the box rather than collapsing it — upstream has no flag for every
     language, and one label starting further left than the rest reads as a bug rather than as an
     absence. */
  const src = flag(code);
  if (!src) return <span aria-hidden className="size-3.5 shrink-0" />;
  return <img src={src} alt="" aria-hidden className="size-3.5 shrink-0 rounded-full" />;
}

export function LanguageSetting() {
  const { t, i18n: active } = useTranslation();
  const isAvailable = useLanguageAvailability();
  const unavailable = LANGUAGES.filter((language) => !isAvailable(language.code));

  /* Whether the picker is on "Automatic" is the absence of a stored override, which is not
     something React can subscribe to — so it is read once and then kept in step by the only thing
     that changes it, which is this control. Another tab could in principle disagree, exactly as it
     could about the theme. */
  const [automatic, setAutomatic] = useState(isAutomaticLanguage);
  const detected = detectedLanguage();

  /* Read after the switch so the confirmation arrives in the new language; the failure is read in
     the old one, because the language did not change. The download can fail even when the picker
     offered the language — a network that reaches the router and nothing else. */
  const announce = (done: Promise<unknown>, onDone: () => void) =>
    void done
      .then(() => {
        onDone();
        notifyDeviceSaved(i18n.t('settings.general.savedOnDevice'));
      })
      .catch(() => notifyError(t('settings.general.languageDownloadFailed')));

  return (
    <div className="flex flex-col gap-1.5">
      <Label>{t('settings.general.language')}</Label>
      <Select
        value={automatic ? 'auto' : resolveLanguage(active.language)}
        onValueChange={(lng) => {
          if (lng === 'auto') {
            announce(followDeviceLanguage(), () => setAutomatic(true));
            return;
          }
          // changeLanguage from i18n/index, not i18n.changeLanguage: that one fetches
          // the language's strings first, so the switch never lands on an empty bundle.
          announce(changeLanguage(lng as LanguageCode), () => setAutomatic(false));
        }}
      >
        <SelectTrigger className="w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {/* Follows the device instead of pinning a choice, and names what that currently means —
              the same shape the week-start and clock settings use. Its flag is the *resolved*
              language's, because that is the one this option would actually give you.

              Never disabled: whatever the device asks for resolves to a shipped language, and if
              that language's strings can't be fetched the switch reports it like any other. */}
          <SelectItem value="auto">
            <span className="inline-flex gap-1 items-center">
              <LanguageFlag code={detected} />
              {t('settings.general.languageAuto', {
                language: LANGUAGES.find((l) => l.code === detected)?.label ?? detected,
              })}
            </span>
          </SelectItem>
          {LANGUAGES.map((language) => {
            const available = isAvailable(language.code);
            return (
              <SelectItem key={language.code} value={language.code} disabled={!available}>
                {/* One element, because SelectItem puts its children inside ItemText — which is
                    also what the closed trigger renders. That is why the flag rides in here and
                    not beside it: the closed picker gets it for free. The "needs a connection"
                    note is only ever reached by a *disabled* item, which can never become the
                    selected one, so it cannot leak into the trigger the same way. */}
                <span className="inline-flex gap-1 items-center">
                  <LanguageFlag code={language.code} />
                  {language.label}
                  {!available && (
                    <span className="text-xs text-muted-foreground">
                      {t('settings.general.languageNeedsConnection')}
                    </span>
                  )}
                </span>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
      {/* Under the closed picker as well as inside it: the greyed-out rows explain themselves only
          once the list is open, and the reason is worth knowing before going looking. */}
      {unavailable.length > 0 && (
        <p className="max-w-64 text-xs text-muted-foreground">
          {t('settings.general.languageOfflineHint')}
        </p>
      )}
    </div>
  );
}

/** Whether times read as 09:00 or 9 AM. Same shape as the week start: 'auto' follows the language,
    which is right for almost everyone, and is why it's the default. */
export function HourCycleSetting() {
  const { t, i18n } = useTranslation();
  const { hourCycle } = usePreferences();
  /* Named rather than shown as a sample time. "21:00" and "9:00 PM" are the same clock reading in
     two notations, so as a pair of options they ask the user to spot the difference between them;
     "24-hour" and "12-hour (AM/PM)" is the distinction itself. Written out per branch rather than
     built from a template key, so checkI18n can see both keys are used. */
  const label = (cycle: '12' | '24') =>
    cycle === '12' ? t('settings.general.timeFormat12') : t('settings.general.timeFormat24');

  return (
    <div className="flex flex-col gap-1.5">
      <Label>{t('settings.general.timeFormat')}</Label>
      <Select
        value={hourCycle}
        onValueChange={(value) => {
          setPreference('hourCycle', value as Preferences['hourCycle']);
          notifyDeviceSaved(t('settings.general.savedOnDevice'));
        }}
      >
        <SelectTrigger className="w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="auto">
            {t('settings.general.timeFormatAuto', {
              format: label(resolveHour12('auto', i18n.language) ? '12' : '24'),
            })}
          </SelectItem>
          <SelectItem value="24">{label('24')}</SelectItem>
          <SelectItem value="12">{label('12')}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
