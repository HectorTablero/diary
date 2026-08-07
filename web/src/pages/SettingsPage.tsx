import type { SettingsDto } from '@diary/shared';
import { DEFAULT_SETTINGS, MAX_SUB_ENTRY_DEPTH } from '@diary/shared';
import { Hash, Moon, RotateCcw, Sun, SunMoon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useSaveSettings, useSettings, useTags } from '@/api/hooks';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { TagChip } from '@/components/entry/chips';
import { EntityPicker } from '@/components/entry/EntityPicker';
import { useImportanceMarkerClass } from '@/components/entry/ImportanceDot';
import { PageContainer, PageHeader } from '@/components/layout/PageHeader';
import { SecuritySection } from '@/components/security/SecuritySection';
import { AccountSection } from '@/components/settings/AccountSection';
import { DataSection } from '@/components/settings/DataSection';
import { ApiKeyField } from '@/components/settings/ApiKeyField';
/* The page's own building blocks. Everything that is a section rather than the page — the
   device-only pickers, the reminders block, the version line — lives beside them in
   components/settings, so this file is the draft, its save path, and the order of the sections. */
import { RemindersSection } from '@/components/settings/RemindersSection';
import { notifyDeviceSaved, Section, ToggleRow } from '@/components/settings/Section';
import { VersionFooter } from '@/components/settings/VersionFooter';
import {
  HourCycleSetting,
  LanguageSetting,
  WeekStartSetting,
} from '@/components/settings/deviceSettings';
import { buildPayload, LEVELS } from '@/components/settings/payload';
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
import { notifyError, notifySuccess } from '@/lib/notify';
import { isNative } from '@/lib/native';
import { useSession } from '@/lib/authClient';
import { setPreference, usePreferences } from '@/lib/preferences';
import { applyTheme, getTheme, type Theme } from '@/lib/theme';
import { cn } from '@/lib/utils';




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
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  /* Bumped by every control that considers its change settled. It exists because a handler
     can't save the value it just set — setDraft hasn't been applied yet — so the request rides
     the same render as the change and is picked up by the effect below. */
  const [commitSignal, setCommitSignal] = useState(0);
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

        <AccountSection />

        <SecuritySection />

        <DataSection />
      </div>

      <VersionFooter />


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

    </PageContainer>
  );
}
