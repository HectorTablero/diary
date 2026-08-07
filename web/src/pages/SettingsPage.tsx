import type { SettingsDto, SettingsInput } from '@diary/shared';
import { DEFAULT_SETTINGS, MAX_SUB_ENTRY_DEPTH } from '@diary/shared';
import { BellRing, ChevronDown, Download, FileText, Hash, LogOut, Moon, RotateCcw, Sun, SunMoon, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useSaveSettings, useSettings, useTags } from '@/api/hooks';
import { GoogleIcon } from '@/components/icons/GoogleIcon';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { Spinner } from '@/components/common/Spinner';
import { TagChip } from '@/components/entry/chips';
import { EntityPicker } from '@/components/entry/EntityPicker';
import { useImportanceMarkerClass } from '@/components/entry/ImportanceDot';
import { PageContainer, PageHeader } from '@/components/layout/PageHeader';
import { SecuritySection } from '@/components/security/SecuritySection';
import { ApiKeyField } from '@/components/settings/ApiKeyField';
import { MarkdownExportDialog } from '@/components/settings/MarkdownExportDialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { NumberInput } from '@/components/ui/number-input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { TimePicker } from '@/components/ui/time-picker';
import { clearLocalData } from '@/db/db';
import { closeLiveChannel } from '@/db/sync';
import { useSyncStatus } from '@/db/useSyncStatus';
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
import { notifyError, notifySuccess } from '@/lib/notify';
import { signOut, useSession } from '@/lib/authClient';
import { setAuthToken } from '@/lib/authToken';
import { buildBackupEnvelope } from '@/lib/backup/export';
import { backupEnvelopeSchema } from '@/lib/backup/schema';
import { saveTextFile } from '@/lib/fileSave';
import { googleSignIn } from '@/lib/googleSignIn';
import { setLocalOnly } from '@/lib/localOnly';
import { isNative } from '@/lib/native';
import {
  getExactAlarmStatus,
  getNotificationPermission,
  requestExactAlarms,
  requestNotificationPermission,
} from '@/lib/notifications';
import { capitalize, localeWeekStart, weekdayName, type WeekStart } from '@/lib/dates';
import {
  resolveHour12,
  setPreference,
  usePreferences,
  type Preferences,
} from '@/lib/preferences';
import { cacheUser } from '@/lib/sessionCache';
import { isTelemetryConfigured } from '@/lib/telemetry';
import { applyTheme, getTheme, type Theme } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { getVersionInfo, type VersionInfo } from '@/lib/version';

/**
 * One titled block of settings, with an optional second tier behind an "Advanced" disclosure.
 *
 * That tier used to be a section of its own at the bottom of the page, which meant a setting was
 * filed by how obscure it is rather than by what it belongs to — "how deep sub-entries nest" sat
 * two screens away from the rest of the entry defaults. Keeping the split *inside* each block
 * gives both: nothing rare is in the way, and everything about entries is in the entries block.
 *
 * Collapsed on every visit, and per-section rather than one page-wide switch, so opening one
 * doesn't quietly unfold the rest of the page.
 */
function Section({
  title,
  description,
  children,
  advanced,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  advanced?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <section className="rounded-xl border bg-card p-4 shadow-xs">
      <h2 className="text-sm font-semibold">{title}</h2>
      {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
      <div className="mt-3">{children}</div>
      {advanced && (
        <>
          <button
            type="button"
            aria-expanded={showAdvanced}
            onClick={() => setShowAdvanced((open) => !open)}
            className="mt-3 flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronDown
              className={cn('size-3.5 transition-transform', showAdvanced && 'rotate-180')}
            />
            {t('settings.advanced.title')}
          </button>
          {showAdvanced && (
            <div className="mt-3 flex flex-col gap-4 border-t pt-4">{advanced}</div>
          )}
        </>
      )}
    </section>
  );
}

/** Which day every month grid starts on: Monday, Sunday, or whatever the chosen language does —
    which is right for almost everyone, and is why it's the default. */
/* Theme, language and the week start never reach the server — they describe this device, not the
   diary. Saying so on every change is what stops "why didn't my phone pick this up?" from being
   a mystery, and it is a confirmation the user asked for, so quiet mode does not drop it. */
const notifyDeviceSaved = (message: string) => notifySuccess(message, { important: true });

function WeekStartSetting() {
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

function LanguageSetting() {
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

/** Label, optional explanation, and a switch on the right — the shape every on/off setting on this
    page had been repeating. `children` hangs an extra control under the row when one is on. */
function ToggleRow({
  id,
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
  children,
}: {
  id: string;
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <Label htmlFor={id}>{label}</Label>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
        <Switch id={id} disabled={disabled} checked={checked} onCheckedChange={onCheckedChange} />
      </div>
      {children}
    </div>
  );
}

/** Whether times read as 09:00 or 9 AM. Same shape as the week start: 'auto' follows the language,
    which is right for almost everyone, and is why it's the default. */
function HourCycleSetting() {
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

/**
 * The time a reminder fires, under the switch that turns it on.
 *
 * Indented behind a rule, and led by a word rather than standing alone. A bare picker sitting
 * full-width below a row whose switch is at the far right reads as the next setting down rather
 * than as part of the one above it — the two are the same distance apart as any two settings in
 * the section, so nothing says they belong together.
 */
function ReminderTime({
  value,
  onChange,
  minHour,
}: {
  value: string;
  onChange: (value: string) => void;
  minHour?: number;
}) {
  const { t } = useTranslation();
  return (
    <div className="ml-1 flex items-center gap-2 border-l pl-3">
      <span className="text-xs text-muted-foreground">{t('settings.reminders.sendAt')}</span>
      <TimePicker
        value={value}
        minHour={minHour}
        aria-label={t('settings.reminders.sendAt')}
        onChange={onChange}
      />
    </div>
  );
}

/**
 * Every alarm this device sends. Rendered only on the phone build — a switch that cannot do
 * anything is worse than an absent one, and the web has no local notifications at all.
 *
 * All device-local, so none of this touches the page's draft or its save path. The reason is
 * blunter than it looks: signing out wipes the account settings back to their defaults, and a
 * synced "off" would quietly become "on" again — a phone buzzing at a time the user turned off.
 */
function RemindersSection() {
  const { t } = useTranslation();
  const prefs = usePreferences();
  const [permission, setPermission] = useState<'granted' | 'denied' | 'prompt'>('granted');
  const [exactAlarms, setExactAlarms] = useState<'granted' | 'denied' | 'unsupported'>('unsupported');

  // Both are changed from outside the app, so re-read whenever the user comes back to it.
  useEffect(() => {
    const check = () => {
      void getNotificationPermission().then(setPermission);
      void getExactAlarmStatus().then(setExactAlarms);
    };
    check();
    const onVisible = () => document.visibilityState === 'visible' && check();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  const set = <K extends keyof Preferences>(key: K, value: Preferences[K]) => {
    setPreference(key, value);
    notifyDeviceSaved(t('settings.general.savedOnDevice'));
  };

  return (
    <Section title={t('settings.reminders.title')} description={t('settings.reminders.description')}>
      <div className="flex flex-col gap-5">
        {permission === 'denied' && (
          <p className="text-xs text-amber-600 dark:text-amber-400">{t('settings.reminders.blocked')}</p>
        )}
        {/* Full width and in the primary colour, unlike every other button on this page. Nothing
            below it can do anything until it has been pressed, so it is not one option among the
            settings — it is the door in front of them. */}
        {permission === 'prompt' && (
          <Button
            className="w-full gap-1.5"
            onClick={() =>
              void requestNotificationPermission().then(() =>
                getNotificationPermission().then(setPermission),
              )
            }
          >
            <BellRing className="size-4" />
            {t('settings.reminders.allow')}
          </Button>
        )}

        {/* Ordered by how much of the diary each one knows about, which is also roughly how often
            it fires: checkups watch every person, birthdays a date each, the daily nudge only
            whether today is empty — and quiet hours last, since it is the rule over the other
            three rather than a reminder of its own. */}
        <ToggleRow
          id="checkup-reminders"
          label={t('settings.reminders.checkups')}
          description={t('settings.reminders.checkupsDescription')}
          checked={prefs.checkupReminders}
          onCheckedChange={(checked) => set('checkupReminders', checked)}
        />

        <ToggleRow
          id="birthday-reminders"
          label={t('settings.reminders.birthdays')}
          description={t('settings.reminders.birthdaysDescription')}
          checked={prefs.birthdayReminders}
          onCheckedChange={(checked) => set('birthdayReminders', checked)}
        >
          {prefs.birthdayReminders && (
            <ReminderTime
              value={prefs.birthdayReminderTime}
              onChange={(value) => set('birthdayReminderTime', value)}
            />
          )}
        </ToggleRow>

        <ToggleRow
          id="daily-reminder"
          label={t('settings.reminders.daily')}
          description={t('settings.reminders.dailyDescription')}
          checked={prefs.dailyReminder}
          onCheckedChange={(checked) => set('dailyReminder', checked)}
        >
          {prefs.dailyReminder && (
            /* Afternoon onwards only: at 08:00 "you haven't written today" is trivially true, so
               an unrestricted picker would invite a setting that guarantees a useless daily nudge. */
            <ReminderTime
              value={prefs.dailyReminderTime}
              minHour={12}
              onChange={(value) => set('dailyReminderTime', value)}
            />
          )}
        </ToggleRow>

        <div className="flex flex-col gap-2">
          <Label>{t('settings.reminders.quietHours')}</Label>
          <p className="text-xs text-muted-foreground">
            {t('settings.reminders.quietHoursDescription')}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">{t('settings.reminders.quietFrom')}</span>
            <TimePicker
              aria-label={t('settings.reminders.quietFrom')}
              value={prefs.quietHoursStart}
              onChange={(value) => set('quietHoursStart', value)}
            />
            <span className="text-xs text-muted-foreground">{t('settings.reminders.quietUntil')}</span>
            <TimePicker
              aria-label={t('settings.reminders.quietUntil')}
              value={prefs.quietHoursEnd}
              onChange={(value) => set('quietHoursEnd', value)}
            />
          </div>
        </div>

        {exactAlarms === 'denied' && (
          <div className="flex flex-col gap-1.5">
            <p className="text-xs text-muted-foreground">
              {t('settings.reminders.exactAlarmsDescription')}
            </p>
            <Button variant="outline" size="sm" className="w-fit" onClick={() => void requestExactAlarms()}>
              {t('settings.reminders.exactAlarms')}
            </Button>
          </div>
        )}
      </div>
    </Section>
  );
}

/** Build identity, quietly, at the very bottom — the thing to ask for first in a bug report.
    On Android the JS bundle can be newer than the APK it runs inside, so show both when
    they've drifted apart. */
function VersionFooter() {
  const [info, setInfo] = useState<VersionInfo | null>(null);

  useEffect(() => {
    void getVersionInfo().then(setInfo);
  }, []);

  if (!info) return null;
  const parts = [`v${info.version}`];
  if (info.apkVersion && info.apkVersion !== info.version) parts.push(`APK v${info.apkVersion}`);

  return (
    <p className="mt-6 text-center text-xs text-muted-foreground">Diary {parts.join(' · ')}</p>
  );
}

const LEVELS = ['1', '2', '3', '4', '5'] as const;

const clampDays = (value: number, min: number) => Math.min(3650, Math.max(min, Math.round(value)));

/**
 * The draft as a payload the API will accept, or null while a number is mid-edit.
 *
 * That null is the whole reason this is a function rather than an inline object: clearing an
 * input to retype it leaves `valueAsNumber` as NaN for as long as the field is empty, and saving
 * *that* would quietly write a default over the value the user is halfway through replacing.
 * With a Save button the user chose when to submit and never noticed; without one, an invalid
 * draft simply isn't saved until it becomes valid again.
 */
function buildPayload(
  draft: SettingsDto,
  checkupsEnabled: boolean,
  checkupIntervalDays: number,
): SettingsInput | null {
  const numbers = [
    ...LEVELS.map((level) => draft.halfLifeDays[level]),
    draft.memoryMinAgeDays,
    ...(checkupsEnabled ? [checkupIntervalDays] : []),
  ];
  if (numbers.some((value) => !Number.isFinite(value))) return null;

  return {
    halfLifeDays: {
      1: clampDays(draft.halfLifeDays['1'], 1),
      2: clampDays(draft.halfLifeDays['2'], 1),
      3: clampDays(draft.halfLifeDays['3'], 1),
      4: clampDays(draft.halfLifeDays['4'], 1),
      5: clampDays(draft.halfLifeDays['5'], 1),
    },
    epsilon: draft.epsilon,
    talkingPointsLimit: draft.talkingPointsLimit,
    memoryImportanceThreshold: draft.memoryImportanceThreshold,
    memoryMinAgeDays: clampDays(draft.memoryMinAgeDays, 0),
    broadcastLifeChangingEvents: draft.broadcastLifeChangingEvents,
    broadcastTagIds: draft.broadcastTagIds,
    forceEnglishAIEvents: draft.forceEnglishAIEvents,
    quietNotifications: draft.quietNotifications,
    defaultImportance: draft.defaultImportance,
    autoSaidOnMention: draft.autoSaidOnMention,
    maxSubEntryDepth: Math.min(MAX_SUB_ENTRY_DEPTH, Math.max(1, Math.round(draft.maxSubEntryDepth))),
    defaultCheckupIntervalDays: checkupsEnabled ? clampDays(checkupIntervalDays, 1) : null,
    /* No provider keys here on purpose. They are write-only and are not part of the draft at
       all, so the autosave below has nothing to send — and, more to the point, cannot resend a
       stale one. Setting a key is its own explicit save; see `saveApiKey`. */
  };
}

export default function SettingsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { data: session } = useSession();
  const { data: settings, isLoading } = useSettings();
  const { data: allTags = [] } = useTags();
  const saveSettings = useSaveSettings();

  const prefs = usePreferences();
  const markerClass = useImportanceMarkerClass();
  const [theme, setTheme] = useState<Theme>(getTheme());
  const [draft, setDraft] = useState<SettingsDto | null>(null);
  const [checkupsEnabled, setCheckupsEnabled] = useState(false);
  const [checkupIntervalDays, setCheckupIntervalDays] = useState(30);
  const [exportingBackup, setExportingBackup] = useState(false);
  const [markdownDialogOpen, setMarkdownDialogOpen] = useState(false);
  const [linkingAccount, setLinkingAccount] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [signOutConfirmOpen, setSignOutConfirmOpen] = useState(false);
  const { pending: pendingOps } = useSyncStatus();
  /* Bumped by every control that considers its change settled. It exists because a handler
     can't save the value it just set — setDraft hasn't been applied yet — so the request rides
     the same render as the change and is picked up by the effect below. */
  const [commitSignal, setCommitSignal] = useState(0);
  const importFileRef = useRef<HTMLInputElement>(null);
  /** Serialized payload last written; null until the first load has settled. */
  const lastSaved = useRef<string | null>(null);
  const aiDisabled = !session?.user;

  const requestCommit = () => setCommitSignal((signal) => signal + 1);

  useEffect(() => {
    if (settings && !draft) {
      setDraft(settings);
      setCheckupsEnabled(settings.defaultCheckupIntervalDays != null);
      setCheckupIntervalDays(settings.defaultCheckupIntervalDays ?? 30);
    }
  }, [settings, draft]);

  const changeTheme = (value: Theme) => {
    if (value === theme) return; // re-clicking the active button isn't a change to confirm
    setTheme(value);
    applyTheme(value);
    notifyDeviceSaved(t('settings.general.savedOnDevice'));
  };

  /** Writes the current draft if it differs from what was last written. Safe to call freely:
      an unchanged draft, an invalid one, or one saved already is a no-op. */
  const commit = () => {
    if (!draft) return;
    const payload = buildPayload(draft, checkupsEnabled, checkupIntervalDays);
    if (!payload) return;
    const serialized = JSON.stringify(payload);
    // Null means the loaded settings haven't been recorded yet, so there is nothing to compare
    // against and nothing the user has changed.
    if (lastSaved.current === null || lastSaved.current === serialized) return;

    /* Recorded before the write, and rewound on failure so the next commit sends this payload
       again. The draft is deliberately never replaced with the response: a reply landing while
       the user is still typing would yank the field back to what the server had a moment ago.

       mutateAsync rather than mutate's callbacks, because react-query drops those once the
       component unmounts — and the save on the way out of the page is precisely the one whose
       confirmation the user has no other way of seeing. */
    const previous = lastSaved.current;
    lastSaved.current = serialized;
    void saveSettings
      .mutateAsync(payload)
      .then(() => notifySuccess(t('settings.settingsSaved'), { important: true }))
      .catch(() => {
        lastSaved.current = previous;
        notifyError(t('errors.unknown'));
      });
  };

  // Record the settings as loaded, so the first real edit has something to differ from.
  useEffect(() => {
    if (!draft || lastSaved.current !== null) return;
    const payload = buildPayload(draft, checkupsEnabled, checkupIntervalDays);
    if (payload) lastSaved.current = JSON.stringify(payload);
  }, [draft, checkupsEnabled, checkupIntervalDays]);

  useEffect(() => {
    if (commitSignal > 0) commit();
    // Runs only when a commit is asked for.
  }, [commitSignal]);

  /* The last save. Leaving the Settings page is the normal way to finish with it, and a field
     edited and then navigated away from never blurs — so unmount is a real save point, not just
     a safety net. pagehide covers the tab going away and visibilitychange the app being
     backgrounded on Android, neither of which unmounts anything. */
  const commitRef = useRef(commit);
  useEffect(() => {
    commitRef.current = commit;
  });
  useEffect(() => {
    const flush = () => commitRef.current();
    const flushIfHidden = () => document.visibilityState === 'hidden' && flush();
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', flushIfHidden);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', flushIfHidden);
      flush();
    };
  }, []);

  /**
   * Store or clear one provider key.
   *
   * Its own write rather than a field on the draft: the draft is what the autosave resends, and a
   * key must be sent exactly once, when the user chooses to. The rest of the payload rides along
   * because PUT /settings replaces the document — sending only the key would blank everything
   * else. The optimistic local mirror keeps just the has*Key flag (see mutations.saveSettings).
   */
  const saveApiKey = (field: 'groqApiKey' | 'openRouterApiKey' | 'cerebrasApiKey', value: string) => {
    if (!draft) return;
    const payload = buildPayload(draft, checkupsEnabled, checkupIntervalDays);
    if (!payload) return;
    void saveSettings
      .mutateAsync({ ...payload, [field]: value })
      .then(() =>
        notifySuccess(value ? t('settings.ai.keySaved') : t('settings.ai.keyRemoved'), {
          important: true,
        }),
      )
      .catch(() => notifyError(t('errors.unknown')));
  };

  const resetDefaults = () => {
    if (!draft) return;
    setDraft({
      ...draft,
      halfLifeDays: { ...DEFAULT_SETTINGS.halfLifeDays } as SettingsDto['halfLifeDays'],
      epsilon: DEFAULT_SETTINGS.epsilon,
      talkingPointsLimit: DEFAULT_SETTINGS.talkingPointsLimit,
      memoryImportanceThreshold: DEFAULT_SETTINGS.memoryImportanceThreshold,
      memoryMinAgeDays: DEFAULT_SETTINGS.memoryMinAgeDays,
      broadcastLifeChangingEvents: DEFAULT_SETTINGS.broadcastLifeChangingEvents,
      broadcastTagIds: [...DEFAULT_SETTINGS.broadcastTagIds],
      forceEnglishAIEvents: DEFAULT_SETTINGS.forceEnglishAIEvents,
    });
    setCheckupsEnabled(DEFAULT_SETTINGS.defaultCheckupIntervalDays != null);
    setCheckupIntervalDays(DEFAULT_SETTINGS.defaultCheckupIntervalDays ?? 30);
    requestCommit();
  };

  const handleSignOut = async () => {
    await signOut();
    // Local data belongs to the signed-in account: wipe it all.
    closeLiveChannel();
    await clearLocalData();
    setAuthToken(null);
    cacheUser(null);
    setLocalOnly(false);
    navigate('/login');
  };

  /**
   * Sign-out ends in `clearLocalData()`, which takes the outbox with it — so anything still queued
   * is not "unsynced", it is gone. Writing offline and then signing out is exactly the sequence
   * that produces a non-empty queue, so the count is checked rather than assumed to be zero.
   *
   * A drained queue signs out with no ceremony, as before: the confirmation only exists to name a
   * loss that is about to happen.
   */
  const requestSignOut = () => {
    if (pendingOps > 0) setSignOutConfirmOpen(true);
    else void handleSignOut();
  };

  const handleLinkAccount = async () => {
    setLinkingAccount(true);
    try {
      await googleSignIn('/settings');
      // Native resolves in place and stays on this page; AppLayout's session effect clears
      // local-only mode and kicks the sync engine, which drains anything queued while offline.
      setLinkingAccount(false);
    } catch (err) {
      notifyError(err instanceof Error ? err.message : t('errors.unknown'));
      setLinkingAccount(false);
    }
  };

  const handleExportBackup = async () => {
    setExportingBackup(true);
    try {
      const envelope = await buildBackupEnvelope();
      await saveTextFile(
        `diary-backup-${envelope.exportedAt.slice(0, 10)}.json`,
        JSON.stringify(envelope, null, 2),
        'application/json',
      );
      notifySuccess(t('settings.data.exportDone'), { important: true });
    } catch {
      notifyError(t('errors.unknown'));
    } finally {
      setExportingBackup(false);
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // clears the input so re-selecting the same file still fires onChange
    if (!file) return;
    try {
      const parsed = backupEnvelopeSchema.parse(JSON.parse(await file.text()));
      void navigate('/settings/import-backup', { state: { envelope: parsed } });
    } catch {
      notifyError(t('settings.data.invalidFile'));
    }
  };

  const toggleBroadcastTag = (id: string) => {
    if (!draft) return;
    setDraft({
      ...draft,
      broadcastTagIds: draft.broadcastTagIds.includes(id)
        ? draft.broadcastTagIds.filter((tagId) => tagId !== id)
        : [...draft.broadcastTagIds, id],
    });
    requestCommit();
  };

  return (
    <PageContainer>
      <PageHeader title={t('settings.title')} />
      <div className="flex flex-col gap-4">
        <Section
          title={t('settings.general.title')}
          advanced={
            /* Guarded rather than always rendered: on the web, before the settings land, there is
               nothing in here — and an Advanced button that opens onto an empty box is worse than
               one that appears a moment later. */
            (draft || isNative) && (
              <>
                {draft && (
                  <ToggleRow
                    id="quiet-notifications"
                    label={t('settings.general.quietNotifications')}
                    description={t('settings.general.quietNotificationsDescription')}
                    checked={draft.quietNotifications}
                    onCheckedChange={(checked) => {
                      setDraft({ ...draft, quietNotifications: checked });
                      requestCommit();
                    }}
                  />
                )}
                {isNative && (
                  <>
                    <ToggleRow
                      id="haptics"
                      label={t('settings.general.haptics')}
                      description={t('settings.general.hapticsDescription')}
                      checked={prefs.haptics}
                      onCheckedChange={(checked) => {
                        setPreference('haptics', checked);
                        notifyDeviceSaved(t('settings.general.savedOnDevice'));
                      }}
                    />
                    <ToggleRow
                      id="sync-wifi-only"
                      label={t('settings.advanced.wifiOnly')}
                      description={t('settings.advanced.wifiOnlyDescription')}
                      checked={prefs.syncOnWifiOnly}
                      onCheckedChange={(checked) => {
                        setPreference('syncOnWifiOnly', checked);
                        notifyDeviceSaved(t('settings.general.savedOnDevice'));
                      }}
                    >
                      {/* Nested under the setting it qualifies, and rendered only while that
                          setting is on — a switch for hiding a pill that cannot appear would be
                          a control with no effect. ToggleRow's `children` already stack under the
                          row, so this reads as belonging to it.

                          Deliberately narrow: it hides the "waiting for Wi-Fi" pill and nothing
                          else. Going offline and the server being unreachable are failures rather
                          than a setting working as asked, and they keep announcing themselves. */}
                      {prefs.syncOnWifiOnly && (
                        <ToggleRow
                          id="sync-hide-paused"
                          label={t('settings.advanced.hidePausedStatus')}
                          description={t('settings.advanced.hidePausedStatusDescription')}
                          checked={prefs.hidePausedSyncStatus}
                          onCheckedChange={(checked) => {
                            setPreference('hidePausedSyncStatus', checked);
                            notifyDeviceSaved(t('settings.general.savedOnDevice'));
                          }}
                        />
                      )}
                    </ToggleRow>
                  </>
                )}
              </>
            )
          }
        >
          <div className="flex flex-col gap-4 sm:flex-wrap sm:items-baseline">
            <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-8">
              <div className="flex flex-col gap-1.5">
                <Label>{t('settings.general.theme')}</Label>
                <div className="flex gap-1">
                  {(
                    [
                      ['light', Sun, t('settings.general.themeLight')],
                      ['dark', Moon, t('settings.general.themeDark')],
                      ['auto', SunMoon, t('settings.general.themeAuto')],
                    ] as const
                  ).map(([value, Icon, label]) => (
                    <Button
                      key={value}
                      variant={theme === value ? 'secondary' : 'outline'}
                      size="sm"
                      className={cn('gap-1.5 h-8', theme === value && 'ring-[1.5px] ring-inset ring-ring')}
                      onClick={() => changeTheme(value)}
                    >
                      <Icon className="size-4" />
                      {label}
                    </Button>
                  ))}
                </div>
              </div>
              <LanguageSetting />
            </div>
            <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-8">
              <WeekStartSetting />
              <HourCycleSetting />
            </div>
            {/* Not behind "Advanced": an accessibility setting that only the people who don't
                need it can find is no setting at all.

                Written out rather than passed to ToggleRow, because the five-shape preview belongs
                *inside* the left column with the label it illustrates — ToggleRow's `children`
                stack underneath the whole row, which would leave the switch floating above it
                instead of level with every other switch on the page. */}
            <div className="flex items-center justify-between gap-3 w-full">
              <div className="flex min-w-0 flex-col gap-0.5">
                <Label htmlFor="importance-shapes">{t('settings.general.importanceShapes')}</Label>
                <p className="text-xs text-muted-foreground">
                  {t('settings.general.importanceShapesDescription')}
                </p>
                {/* The description cannot say what the shapes look like, so it shows them. */}
                <div className="mt-1.5 flex items-center gap-2" aria-hidden>
                  {[1, 2, 3, 4, 5].map((importance) => (
                    <span key={importance} className={cn('size-3', markerClass(importance))} />
                  ))}
                </div>
              </div>
              <Switch
                id="importance-shapes"
                checked={prefs.importanceShapes}
                onCheckedChange={(checked) => {
                  setPreference('importanceShapes', checked);
                  notifyDeviceSaved(t('settings.general.savedOnDevice'));
                }}
              />
            </div>
            <ToggleRow
              id="entity-links"
              label={t('settings.entries.entityLinks')}
              description={t('settings.entries.entityLinksDescription')}
              checked={prefs.entityLinks}
              onCheckedChange={(checked) => {
                setPreference('entityLinks', checked);
                notifyDeviceSaved(t('settings.general.savedOnDevice'));
              }}
            />
          </div>
        </Section>

        {isNative && <RemindersSection />}

        <Section
          title={t('settings.entries.title')}
          advanced={
            <>
              <ToggleRow
                id="entries-expanded"
                label={t('settings.entries.expanded')}
                description={t('settings.entries.expandedDescription')}
                checked={prefs.entriesExpanded}
                onCheckedChange={(checked) => {
                  setPreference('entriesExpanded', checked);
                  notifyDeviceSaved(t('settings.general.savedOnDevice'));
                }}
              />
              {draft && (
                <div className="flex flex-col gap-1.5">
                  <Label>{t('settings.advanced.nestingDepth')}</Label>
                  <p className="text-xs text-muted-foreground">
                    {t('settings.advanced.nestingDepthDescription')}
                  </p>
                  <NumberInput
                    min={1}
                    max={MAX_SUB_ENTRY_DEPTH}
                    aria-label={t('settings.advanced.nestingDepth')}
                    stepDownLabel={t('settings.stepDown')}
                    stepUpLabel={t('settings.stepUp')}
                    value={draft.maxSubEntryDepth}
                    onCommit={requestCommit}
                    onChange={(value) => setDraft({ ...draft, maxSubEntryDepth: value })}
                  />
                </div>
              )}
            </>
          }
        >
          {isLoading || !draft ? (
            <Skeleton className="h-24" />
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label>{t('settings.entries.defaultImportance')}</Label>
                <Select
                  value={draft.defaultImportance === null ? 'last' : String(draft.defaultImportance)}
                  onValueChange={(value) => {
                    setDraft({
                      ...draft,
                      defaultImportance: value === 'last' ? null : Number(value),
                    });
                    requestCommit();
                  }}
                >
                  <SelectTrigger className="w-56">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LEVELS.map((level) => (
                      <SelectItem key={level} value={level}>
                        <span className={cn('mr-1 inline-block size-2.5', markerClass(Number(level)))} />
                        {t(`importance.levels.${level}`)}
                      </SelectItem>
                    ))}
                    {/* Kept last: it's the one option that isn't a level. */}
                    <SelectItem value="last">{t('settings.entries.importanceLastUsed')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <ToggleRow
                id="auto-said-on-mention"
                label={t('settings.entries.autoSaid')}
                description={t('settings.entries.autoSaidDescription')}
                checked={draft.autoSaidOnMention}
                onCheckedChange={(checked) => {
                  setDraft({ ...draft, autoSaidOnMention: checked });
                  requestCommit();
                }}
              />
            </div>
          )}
        </Section>

        <Section
          title={t('settings.decay.title')}
          description={t('settings.decay.description')}
          advanced={
            draft && (
              <div className="flex items-center gap-3">
                <span className="w-36 flex-1 text-sm sm:flex-none">{t('settings.decay.limit')}</span>
                <NumberInput
                  min={1}
                  max={200}
                  aria-label={t('settings.decay.limit')}
                  stepDownLabel={t('settings.stepDown')}
                  stepUpLabel={t('settings.stepUp')}
                  value={draft.talkingPointsLimit}
                  onCommit={requestCommit}
                  onChange={(value) => setDraft({ ...draft, talkingPointsLimit: value })}
                />
              </div>
            )
          }
        >
          {isLoading || !draft ? (
            <Skeleton className="h-40" />
          ) : (
            <div className="flex flex-col gap-2">
              {LEVELS.map((level) => (
                <div key={level} className="flex items-center gap-3">
                  <span className={cn('size-3 shrink-0', markerClass(Number(level)))} />
                  <span className="w-36 flex-1 text-sm sm:flex-none">{t(`importance.levels.${level}`)}</span>
                  <NumberInput
                    min={1}
                    max={3650}
                    aria-label={t(`importance.levels.${level}`)}
                    stepDownLabel={t('settings.stepDown')}
                    stepUpLabel={t('settings.stepUp')}
                    value={draft.halfLifeDays[level]}
                    onCommit={requestCommit}
                    onChange={(value) =>
                      setDraft({
                        ...draft,
                        halfLifeDays: { ...draft.halfLifeDays, [level]: value },
                      })
                    }
                  />
                  <span className="text-xs text-muted-foreground">{t('settings.memories.days')}</span>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title={t('settings.memories.title')} description={t('settings.memories.description')}>
          {isLoading || !draft ? (
            <Skeleton className="h-20" />
          ) : (
            <div className="flex flex-col gap-4 sm:flex-row sm:items-baseline sm:gap-8">
              <div className="flex flex-col gap-1.5">
                <Label>{t('settings.memories.threshold')}</Label>
                <Select
                  value={String(draft.memoryImportanceThreshold)}
                  onValueChange={(value) => {
                    setDraft({ ...draft, memoryImportanceThreshold: Number(value) });
                    requestCommit();
                  }}
                >
                  <SelectTrigger className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LEVELS.map((level) => (
                      <SelectItem key={level} value={level}>
                        <span className={cn('mr-1 inline-block size-2.5', markerClass(Number(level)))} />
                        {t(`importance.levels.${level}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{t('settings.memories.thresholdDescription')}</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="memory-age">{t('settings.memories.minAge')}</Label>
                <div className="flex items-center gap-2">
                  <NumberInput
                    id="memory-age"
                    min={0}
                    max={3650}
                    stepDownLabel={t('settings.stepDown')}
                    stepUpLabel={t('settings.stepUp')}
                    value={draft.memoryMinAgeDays}
                    onCommit={requestCommit}
                    onChange={(value) => setDraft({ ...draft, memoryMinAgeDays: value })}
                  />
                  <span className="text-xs text-muted-foreground">{t('settings.memories.days')}</span>
                </div>
              </div>
            </div>
          )}
        </Section>

        <Section title={t('settings.broadcast.title')} description={t('settings.broadcast.description')}>
          {isLoading || !draft ? (
            <Skeleton className="h-24" />
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <Label htmlFor="broadcast-life-changing">{t('settings.broadcast.lifeChanging')}</Label>
                  <p className="text-xs text-muted-foreground">
                    {t('settings.broadcast.lifeChangingDescription')}
                  </p>
                </div>
                <Switch
                  id="broadcast-life-changing"
                  checked={draft.broadcastLifeChangingEvents}
                  onCheckedChange={(checked) => {
                    setDraft({ ...draft, broadcastLifeChangingEvents: checked });
                    requestCommit();
                  }}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>{t('settings.broadcast.tags')}</Label>
                <p className="text-xs text-muted-foreground">{t('settings.broadcast.tagsDescription')}</p>
                <div className="flex flex-wrap items-center gap-1.5">
                  {draft.broadcastTagIds.map((id) => {
                    const tag = allTags.find((tg) => tg.id === id);
                    return tag ? (
                      <TagChip key={tag.id} tag={tag} onRemove={() => toggleBroadcastTag(tag.id)} />
                    ) : null;
                  })}
                  <EntityPicker
                    trigger={
                      <Button variant="outline" size="sm" className="h-6 gap-1 px-2 text-xs">
                        <Hash className="size-3" />
                        {t('common.add')}
                      </Button>
                    }
                    items={allTags.map((tag) => ({ id: tag.id, label: tag.name, color: tag.color }))}
                    selectedIds={draft.broadcastTagIds}
                    onToggle={toggleBroadcastTag}
                    placeholder={t('tags.namePlaceholder')}
                  />
                </div>
              </div>
            </div>
          )}
        </Section>

        <Section title={t('settings.checkups.title')} description={t('settings.checkups.description')}>
          {isLoading || !draft ? (
            <Skeleton className="h-16" />
          ) : (
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <Switch
                  id="checkups-enabled"
                  checked={checkupsEnabled}
                  onCheckedChange={(checked) => {
                    setCheckupsEnabled(checked);
                    requestCommit();
                  }}
                />
                <Label htmlFor="checkups-enabled">{t('settings.checkups.enable')}</Label>
              </div>
              {checkupsEnabled && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">{t('people.checkupEvery')}</span>
                  <NumberInput
                    min={1}
                    max={3650}
                    aria-label={t('people.checkupEvery')}
                    stepDownLabel={t('settings.stepDown')}
                    stepUpLabel={t('settings.stepUp')}
                    value={checkupIntervalDays}
                    onCommit={requestCommit}
                    onChange={setCheckupIntervalDays}
                  />
                  <span className="text-xs text-muted-foreground">{t('settings.memories.days')}</span>
                </div>
              )}
            </div>
          )}
        </Section>

        {/* `settings` is required here, not just `draft`: the has*Key flags below are read from
            the query rather than the draft, so the section waits for the query to have landed. */}
        <Section title={t('settings.ai.title')} description={t('settings.ai.description')}>
          {isLoading || !draft || !settings ? (
            <Skeleton className="h-32" />
          ) : (
            <div className="flex flex-col gap-4">
              {aiDisabled && (
                <p className="text-xs text-amber-600 dark:text-amber-400">{t('settings.ai.signInRequired')}</p>
              )}
              {/* hasKey comes from the query, never the draft: the draft is seeded once and then
                  held apart on purpose (see `commit`), so a key saved on this visit would leave it
                  — and only it — still describing the state the page opened in, until a trip off
                  the page remounted it. Nothing here is editable text, so there is no in-progress
                  edit for a fresh value to yank. */}
              <ApiKeyField
                id="groq-api-key"
                label={t('settings.ai.apiKey')}
                placeholder={t('settings.ai.apiKeyPlaceholder')}
                hasKey={settings.hasGroqKey}
                disabled={aiDisabled}
                onSave={(value) => saveApiKey('groqApiKey', value)}
                hint={
                  <>
                    {t('settings.ai.apiKeyHint')}{' '}
                    <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer" className="underline">
                      console.groq.com
                    </a>
                  </>
                }
              />
              <ApiKeyField
                id="cerebras-api-key"
                label={t('settings.ai.cerebrasApiKey')}
                placeholder={t('settings.ai.cerebrasApiKeyPlaceholder')}
                hasKey={settings.hasCerebrasKey}
                disabled={aiDisabled}
                onSave={(value) => saveApiKey('cerebrasApiKey', value)}
                hint={
                  <>
                    {t('settings.ai.cerebrasApiKeyHint')}{' '}
                    <a href="https://cloud.cerebras.ai/" target="_blank" rel="noreferrer" className="underline">
                      cloud.cerebras.ai
                    </a>
                  </>
                }
              />
              <ApiKeyField
                id="openrouter-api-key"
                label={t('settings.ai.openRouterApiKey')}
                placeholder={t('settings.ai.openRouterApiKeyPlaceholder')}
                hasKey={settings.hasOpenRouterKey}
                disabled={aiDisabled}
                onSave={(value) => saveApiKey('openRouterApiKey', value)}
                hint={
                  <>
                    {t('settings.ai.openRouterApiKeyHint')}{' '}
                    <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer" className="underline">
                      openrouter.ai/keys
                    </a>
                  </>
                }
              />
              {/* Below the keys rather than wedged between them: it is about what the AI writes,
                  not about which provider writes it, and it was splitting the three in two. */}
              <div className="flex items-center justify-between gap-2 border-t pt-4">
                <div className="flex flex-col gap-0.5">
                  <Label htmlFor="force-english-ai-events">{t('settings.ai.forceEnglishAIEvents')}</Label>
                  <p className="text-xs text-muted-foreground">{t('settings.ai.forceEnglishAIEventsDescription')}</p>
                </div>
                <Switch
                  id="force-english-ai-events"
                  disabled={aiDisabled}
                  checked={draft.forceEnglishAIEvents}
                  onCheckedChange={(checked) => {
                    setDraft({ ...draft, forceEnglishAIEvents: checked });
                    requestCommit();
                  }}
                />
              </div>
            </div>
          )}
        </Section>

        <div className="flex items-center justify-end">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-muted-foreground"
            disabled={!draft}
            onClick={() => setResetConfirmOpen(true)}
          >
            <RotateCcw className="size-3.5" />
            {t('settings.resetDefaults')}
          </Button>
        </div>

        <Section title={t('settings.account')}>
          {session?.user ? (
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                {session.user.image && (
                  <img src={session.user.image} alt="" className="size-9 rounded-full" referrerPolicy="no-referrer" />
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{session.user.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{session.user.email}</p>
                </div>
              </div>
              <Button variant="outline" size="sm" className="gap-1.5 h-8" onClick={requestSignOut}>
                <LogOut className="size-3.5" />
                {t('auth.signOut')}
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">{t('settings.accountLocalOnlyDescription')}</p>
              <Button
                size="sm"
                className="gap-1.5 h-8"
                disabled={linkingAccount}
                onClick={() => void handleLinkAccount()}
              >
                {linkingAccount ? <Spinner className="size-3.5" /> : <GoogleIcon />}
                {t('auth.signInWithGoogle')}
              </Button>
            </div>
          )}
        </Section>

        <SecuritySection Section={Section} />

        <Section title={t('settings.data.title')} description={t('settings.data.description')}>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 h-8"
                  disabled={exportingBackup}
                  onClick={() => void handleExportBackup()}
                >
                  {exportingBackup ? <Spinner className="size-3.5" /> : <Download className="size-3.5" />}
                  {t('settings.data.export')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 h-8"
                  onClick={() => importFileRef.current?.click()}
                >
                  <Upload className="size-3.5" />
                  {t('settings.data.import')}
                </Button>
                <input
                  ref={importFileRef}
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={(e) => void handleImportFile(e)}
                />
              </div>
              {/* Was a "include sensitive data" checkbox. There is nothing left for it to
                  include: provider keys never reach this device, and device preferences are not
                  part of a backup — so the honest control is a sentence, not a choice. */}
              <p className="text-xs text-muted-foreground">{t('settings.data.exportOmits')}</p>
            </div>

            <div className="flex flex-col gap-1">
              <Button
                variant="outline"
                size="sm"
                className="w-fit gap-1.5 h-8"
                onClick={() => setMarkdownDialogOpen(true)}
              >
                <FileText className="size-3.5" />
                {t('settings.data.exportMarkdown')}
              </Button>
              <p className="text-xs text-muted-foreground">{t('settings.data.exportMarkdownDescription')}</p>
            </div>

            {/* Only where the build actually reports somewhere. Telemetry used to be a decision
                made once, by whoever produced the bundle, with no way for the person running it
                to change their mind — this is that switch. */}
            {isTelemetryConfigured() && (
              <div className="border-t pt-4">
                <ToggleRow
                  id="telemetry"
                  label={t('settings.data.telemetry')}
                  description={t('settings.data.telemetryDescription')}
                  checked={prefs.telemetry}
                  onCheckedChange={(checked) => {
                    setPreference('telemetry', checked);
                    notifyDeviceSaved(t('settings.general.savedOnDevice'));
                  }}
                />
              </div>
            )}
          </div>
        </Section>
      </div>

      <VersionFooter />

      <MarkdownExportDialog open={markdownDialogOpen} onOpenChange={setMarkdownDialogOpen} />

      {/* Autosave took away the pause before a destructive change took effect, so the reset
          asks first — it's the one control on the page that can't be undone by retyping. */}
      <ConfirmDialog
        open={resetConfirmOpen}
        onOpenChange={setResetConfirmOpen}
        title={t('settings.resetDefaultsConfirmTitle')}
        description={t('settings.resetDefaultsConfirmDescription')}
        confirmLabel={t('settings.resetDefaults')}
        onConfirm={resetDefaults}
      />

      <ConfirmDialog
        open={signOutConfirmOpen}
        onOpenChange={setSignOutConfirmOpen}
        title={t('settings.signOutPendingTitle', { count: pendingOps })}
        description={t('settings.signOutPendingDescription')}
        confirmLabel={t('settings.signOutDiscard')}
        onConfirm={() => void handleSignOut()}
      />
    </PageContainer>
  );
}
