import type { SettingsDto } from '@diary/shared';
import { DEFAULT_SETTINGS } from '@diary/shared';
import { Hash, LogOut, Moon, RotateCcw, Sun, SunMoon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { useSaveSettings, useSettings, useTags } from '@/api/hooks';
import { Spinner } from '@/components/common/Spinner';
import { TagChip } from '@/components/entry/chips';
import { EntityPicker } from '@/components/entry/EntityPicker';
import { importanceDotClass } from '@/components/entry/ImportanceDot';
import { PageContainer, PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { clearLocalData } from '@/db/db';
import { closeLiveChannel } from '@/db/sync';
import { signOut, useSession } from '@/lib/authClient';
import { setAuthToken } from '@/lib/authToken';
import { cacheUser } from '@/lib/sessionCache';
import { applyTheme, getTheme, type Theme } from '@/lib/theme';
import { cn } from '@/lib/utils';

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border bg-card p-4 shadow-xs">
      <h2 className="text-sm font-semibold">{title}</h2>
      {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

const LEVELS = ['1', '2', '3', '4', '5'] as const;

export default function SettingsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { data: session } = useSession();
  const { data: settings, isLoading } = useSettings();
  const { data: allTags = [] } = useTags();
  const saveSettings = useSaveSettings();

  const [theme, setTheme] = useState<Theme>(getTheme());
  const [draft, setDraft] = useState<SettingsDto | null>(null);
  const [checkupsEnabled, setCheckupsEnabled] = useState(false);
  const [checkupIntervalDays, setCheckupIntervalDays] = useState(30);

  useEffect(() => {
    if (settings && !draft) {
      setDraft(settings);
      setCheckupsEnabled(settings.defaultCheckupIntervalDays != null);
      setCheckupIntervalDays(settings.defaultCheckupIntervalDays ?? 30);
    }
  }, [settings, draft]);

  const changeTheme = (value: Theme) => {
    setTheme(value);
    applyTheme(value);
  };

  const save = () => {
    if (!draft) return;
    saveSettings.mutate(
      {
        halfLifeDays: {
          1: Number(draft.halfLifeDays['1']) || DEFAULT_SETTINGS.halfLifeDays[1],
          2: Number(draft.halfLifeDays['2']) || DEFAULT_SETTINGS.halfLifeDays[2],
          3: Number(draft.halfLifeDays['3']) || DEFAULT_SETTINGS.halfLifeDays[3],
          4: Number(draft.halfLifeDays['4']) || DEFAULT_SETTINGS.halfLifeDays[4],
          5: Number(draft.halfLifeDays['5']) || DEFAULT_SETTINGS.halfLifeDays[5],
        },
        epsilon: draft.epsilon,
        talkingPointsLimit: draft.talkingPointsLimit,
        memoryImportanceThreshold: draft.memoryImportanceThreshold,
        memoryMinAgeDays: Number(draft.memoryMinAgeDays) || DEFAULT_SETTINGS.memoryMinAgeDays,
        broadcastLifeChangingEvents: draft.broadcastLifeChangingEvents,
        broadcastTagIds: draft.broadcastTagIds,
        defaultCheckupIntervalDays: checkupsEnabled
          ? Math.min(3650, Math.max(1, Math.round(checkupIntervalDays) || 1))
          : null,
      },
      {
        onSuccess: (data) => {
          setDraft(data);
          setCheckupsEnabled(data.defaultCheckupIntervalDays != null);
          setCheckupIntervalDays(data.defaultCheckupIntervalDays ?? 30);
          toast.success(t('settings.settingsSaved'));
        },
        onError: () => toast.error(t('errors.unknown')),
      },
    );
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
    });
    setCheckupsEnabled(DEFAULT_SETTINGS.defaultCheckupIntervalDays != null);
    setCheckupIntervalDays(DEFAULT_SETTINGS.defaultCheckupIntervalDays ?? 30);
  };

  const handleSignOut = async () => {
    await signOut();
    // Local data belongs to the signed-in account: wipe it all.
    closeLiveChannel();
    await clearLocalData();
    setAuthToken(null);
    cacheUser(null);
    navigate('/login');
  };

  const toggleBroadcastTag = (id: string) => {
    if (!draft) return;
    setDraft({
      ...draft,
      broadcastTagIds: draft.broadcastTagIds.includes(id)
        ? draft.broadcastTagIds.filter((tagId) => tagId !== id)
        : [...draft.broadcastTagIds, id],
    });
  };

  return (
    <PageContainer>
      <PageHeader title={t('settings.title')} />
      <div className="flex flex-col gap-4">
        <Section title={t('settings.appearance')}>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-8">
            <div className="flex flex-col gap-1.5">
              <Label>{t('settings.theme')}</Label>
              <div className="flex gap-1">
                {(
                  [
                    ['light', Sun, t('settings.themeLight')],
                    ['dark', Moon, t('settings.themeDark')],
                    ['auto', SunMoon, t('settings.themeAuto')],
                  ] as const
                ).map(([value, Icon, label]) => (
                  <Button
                    key={value}
                    variant={theme === value ? 'secondary' : 'outline'}
                    size="sm"
                    className={cn('gap-1.5', theme === value && 'ring-1 ring-ring')}
                    onClick={() => changeTheme(value)}
                  >
                    <Icon className="size-4" />
                    {label}
                  </Button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>{t('settings.language')}</Label>
              <Select value={i18n.language.startsWith('en') ? 'en' : 'es'} onValueChange={(lng) => void i18n.changeLanguage(lng)}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="es">Español</SelectItem>
                  <SelectItem value="en">English</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </Section>

        <Section title={t('settings.decay.title')} description={t('settings.decay.description')}>
          {isLoading || !draft ? (
            <Skeleton className="h-40" />
          ) : (
            <div className="flex flex-col gap-2">
              {LEVELS.map((level) => (
                <div key={level} className="flex items-center gap-3">
                  <span className={cn('size-3 shrink-0 rounded-full', importanceDotClass(Number(level)))} />
                  <span className="w-36 flex-1 text-sm sm:flex-none">{t(`importance.levels.${level}`)}</span>
                  <Input
                    type="number"
                    min={1}
                    max={3650}
                    step={1}
                    value={draft.halfLifeDays[level]}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        halfLifeDays: { ...draft.halfLifeDays, [level]: e.target.valueAsNumber },
                      })
                    }
                    className="w-24"
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
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:gap-8">
              <div className="flex flex-col gap-1.5">
                <Label>{t('settings.memories.threshold')}</Label>
                <Select
                  value={String(draft.memoryImportanceThreshold)}
                  onValueChange={(value) =>
                    setDraft({ ...draft, memoryImportanceThreshold: Number(value) })
                  }
                >
                  <SelectTrigger className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LEVELS.map((level) => (
                      <SelectItem key={level} value={level}>
                        <span className={cn('mr-1 inline-block size-2.5 rounded-full', importanceDotClass(Number(level)))} />
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
                  <Input
                    id="memory-age"
                    type="number"
                    min={0}
                    max={3650}
                    step={1}
                    value={draft.memoryMinAgeDays}
                    onChange={(e) => setDraft({ ...draft, memoryMinAgeDays: e.target.valueAsNumber })}
                    className="w-24"
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
                  onCheckedChange={(checked) =>
                    setDraft({ ...draft, broadcastLifeChangingEvents: checked })
                  }
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
                  onCheckedChange={setCheckupsEnabled}
                />
                <Label htmlFor="checkups-enabled">{t('settings.checkups.enable')}</Label>
              </div>
              {checkupsEnabled && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">{t('people.checkupEvery')}</span>
                  <Input
                    type="number"
                    min={1}
                    max={3650}
                    step={1}
                    value={checkupIntervalDays}
                    onChange={(e) => setCheckupIntervalDays(e.target.valueAsNumber)}
                    className="w-24"
                  />
                  <span className="text-xs text-muted-foreground">{t('settings.memories.days')}</span>
                </div>
              )}
            </div>
          )}
        </Section>

        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={resetDefaults}>
            <RotateCcw className="size-3.5" />
            {t('settings.resetDefaults')}
          </Button>
          <Button onClick={save} disabled={!draft || saveSettings.isPending}>
            {saveSettings.isPending && <Spinner className="size-3.5" />}
            {t('common.save')}
          </Button>
        </div>

        <Section title={t('settings.account')}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              {session?.user.image && (
                <img src={session.user.image} alt="" className="size-9 rounded-full" referrerPolicy="no-referrer" />
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{session?.user.name}</p>
                <p className="truncate text-xs text-muted-foreground">{session?.user.email}</p>
              </div>
            </div>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void handleSignOut()}>
              <LogOut className="size-3.5" />
              {t('auth.signOut')}
            </Button>
          </div>
        </Section>
      </div>
    </PageContainer>
  );
}
