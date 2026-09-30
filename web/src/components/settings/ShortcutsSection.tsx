import { RotateCcw, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useThreadsEnabled } from '@/api/hooks';
import { notifyDeviceSaved, Section, ToggleRow } from '@/components/settings/Section';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { setPreference, usePreferences } from '@/lib/preferences';
import { cn } from '@/lib/utils';
import { usePluginNav } from '@/plugins/usePluginNav';
import {
  importanceShortcuts,
  navShortcuts,
  resolveBinding,
  type ShortcutAction,
} from '@/shortcuts/actions';
import {
  canonicalBinding,
  formatBinding,
  hasCommandModifier,
  modifiersOf,
  recordFromEvent,
  type Binding,
} from '@/shortcuts/bindings';

const HINT_DELAYS = [250, 500, 1000] as const;

/** A stored delay that is no longer offered (2s once was) shows as the nearest one that is, rather
    than as an empty select. */
const nearestDelay = (ms: number) =>
  HINT_DELAYS.reduce((best, option) =>
    Math.abs(option - ms) < Math.abs(best - ms) ? option : best,
  );

/**
 * Turning shortcuts off, how long a held key takes to show the hints, and every binding — each one
 * re-recordable, resettable and removable on its own.
 *
 * Rendered on the web build only (see SettingsPage): the native app registers no shortcuts.
 */
export function ShortcutsSection() {
  const { t, i18n } = useTranslation();
  const { shortcuts, shortcutHintDelay, shortcutOverrides } = usePreferences();
  const pluginNav = usePluginNav();
  const threadsOn = useThreadsEnabled();
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [needsModifier, setNeedsModifier] = useState(false);

  const groups = useMemo(
    () => [
      {
        title: t('settings.shortcuts.groupNavigation'),
        actions: navShortcuts(pluginNav, threadsOn, t),
      },
      { title: t('settings.shortcuts.groupEntry'), actions: importanceShortcuts(t) },
    ],
    [pluginNav, threadsOn, t],
  );

  const bindingOf = (action: ShortcutAction) =>
    resolveBinding(action.id, action.defaultBinding, shortcutOverrides);

  /* Flagged rather than prevented: a shared key cycles through its actions (see nextInCycle), so it
     can be what someone wants. But it can as easily be a slip, and moving a binding silently off
     another action is how a shortcut gets lost without anyone noticing — so every row involved
     names the others. */
  const conflicts = useMemo(() => {
    const owners = new Map<Binding, ShortcutAction[]>();
    for (const action of groups.flatMap((group) => group.actions)) {
      const binding = resolveBinding(action.id, action.defaultBinding, shortcutOverrides);
      if (!binding) continue;
      const key = canonicalBinding(binding);
      owners.set(key, [...(owners.get(key) ?? []), action]);
    }
    const list = new Intl.ListFormat(i18n.language, { type: 'conjunction' });
    const byId = new Map<string, string>();
    for (const actions of owners.values()) {
      if (actions.length < 2) continue;
      for (const action of actions) {
        const others = actions.filter((other) => other.id !== action.id);
        byId.set(action.id, list.format(others.map((other) => other.label)));
      }
    }
    return byId;
  }, [groups, shortcutOverrides, i18n.language]);

  const save = (action: ShortcutAction, binding: Binding | null) => {
    const next = { ...shortcutOverrides };
    const isDefault =
      binding === action.defaultBinding ||
      (!!binding &&
        !!action.defaultBinding &&
        canonicalBinding(binding) === canonicalBinding(action.defaultBinding));
    // Only differences are stored, so a later change to a default still reaches anyone who
    // happened to pick the old one by hand.
    if (isDefault) delete next[action.id];
    else next[action.id] = binding;
    setPreference('shortcutOverrides', next);
    notifyDeviceSaved(t('settings.general.savedOnDevice'));
  };

  const recording = groups
    .flatMap((group) => group.actions)
    .find((action) => action.id === recordingId);

  useEffect(() => {
    if (!recording) return;
    /* Capture phase on window, ahead of everything: the combination being recorded must not also
     *do* what it's currently bound to — pressing Alt+2 here shouldn't leave for the calendar. */
    const onKeyDown = (event: KeyboardEvent) => {
      const mods = modifiersOf(event);
      // Plain Tab still moves on and plain Escape backs out, so the recorder is never a trap.
      if (event.key === 'Tab' && !hasCommandModifier(mods)) {
        setRecordingId(null);
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape' && !hasCommandModifier(mods)) {
        setRecordingId(null);
        return;
      }
      const result = recordFromEvent(event);
      if (result.kind === 'pending') return;
      if (result.kind === 'needsModifier') {
        setNeedsModifier(true);
        return;
      }
      save(recording, result.binding);
      setRecordingId(null);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
    // `save` closes over the overrides, which is what the dependency on them is for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording, shortcutOverrides]);

  const startRecording = (id: string) => {
    setNeedsModifier(false);
    setRecordingId((current) => (current === id ? null : id));
  };

  const customised = Object.keys(shortcutOverrides).length > 0;

  return (
    <Section
      title={t('settings.shortcuts.title')}
      description={t('settings.shortcuts.description')}
    >
      <div className="flex flex-col gap-4">
        <ToggleRow
          id="shortcuts-enabled"
          label={t('settings.shortcuts.enabled')}
          checked={shortcuts}
          onCheckedChange={(checked) => {
            setPreference('shortcuts', checked);
            notifyDeviceSaved(t('settings.general.savedOnDevice'));
          }}
        />
        {shortcuts && (
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="shortcut-hint-delay">{t('settings.shortcuts.hintDelay')}</Label>
              <p className="text-xs text-muted-foreground">
                {t('settings.shortcuts.hintDelayDescription')}
              </p>
              <Select
                value={
                  shortcutHintDelay === null ? 'never' : String(nearestDelay(shortcutHintDelay))
                }
                onValueChange={(value) => {
                  setPreference('shortcutHintDelay', value === 'never' ? null : Number(value));
                  notifyDeviceSaved(t('settings.general.savedOnDevice'));
                }}
              >
                <SelectTrigger
                  id="shortcut-hint-delay"
                  className="w-48"
                  aria-label={t('settings.shortcuts.hintDelay')}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HINT_DELAYS.map((ms) => (
                    <SelectItem key={ms} value={String(ms)}>
                      {t('settings.shortcuts.hintDelaySeconds', {
                        // 0,25 in Spanish and Italian.
                        seconds: new Intl.NumberFormat(i18n.language).format(ms / 1000),
                      })}
                    </SelectItem>
                  ))}
                  <SelectItem value="never">{t('settings.shortcuts.hintDelayNever')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {groups.map((group) => (
              <div key={group.title} className="flex flex-col gap-1">
                <h3 className="text-xs font-medium text-muted-foreground">{group.title}</h3>
                <ul className="flex flex-col divide-y">
                  {group.actions.map((action) => {
                    const binding = bindingOf(action);
                    const isRecording = recordingId === action.id;
                    const conflict = conflicts.get(action.id);
                    const overridden = Object.hasOwn(shortcutOverrides, action.id);
                    return (
                      <li key={action.id} className="flex items-center gap-3 py-1.5">
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="truncate text-sm">{action.label}</span>
                          {isRecording && needsModifier && (
                            <span role="alert" className="text-xs text-destructive">
                              {t('settings.shortcuts.needsModifier')}
                            </span>
                          )}
                          {!isRecording && conflict && (
                            <span className="text-xs text-amber-600 dark:text-amber-400">
                              {t('settings.shortcuts.conflict', { actions: conflict })}
                            </span>
                          )}
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          aria-pressed={isRecording}
                          aria-label={t('settings.shortcuts.record', { action: action.label })}
                          onClick={() => startRecording(action.id)}
                          onBlur={() => isRecording && setRecordingId(null)}
                          className={cn(
                            'min-w-24 justify-center font-mono text-xs',
                            isRecording && 'ring-[1.5px] ring-ring ring-inset',
                            !isRecording && !binding && 'text-muted-foreground',
                          )}
                        >
                          {isRecording
                            ? t('settings.shortcuts.recording')
                            : binding
                              ? formatBinding(binding)
                              : t('settings.shortcuts.none')}
                        </Button>
                        {/* Fixed-width slots, so the record buttons stay a column whichever of
                            these a row happens to have. */}
                        <div className="flex w-14 shrink-0 items-center justify-end">
                          {overridden && (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={t('settings.shortcuts.reset', { action: action.label })}
                              title={t('settings.shortcuts.reset', { action: action.label })}
                              onClick={() => save(action, action.defaultBinding)}
                            >
                              <RotateCcw className="size-3.5" />
                            </Button>
                          )}
                          {binding && (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={t('settings.shortcuts.clear', { action: action.label })}
                              title={t('settings.shortcuts.clear', { action: action.label })}
                              onClick={() => save(action, null)}
                            >
                              <X className="size-3.5" />
                            </Button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}

            {customised && (
              <Button
                variant="ghost"
                size="sm"
                className="w-fit gap-1.5 text-muted-foreground"
                onClick={() => {
                  setPreference('shortcutOverrides', {});
                  notifyDeviceSaved(t('settings.general.savedOnDevice'));
                }}
              >
                <RotateCcw className="size-3.5" />
                {t('settings.shortcuts.resetAll')}
              </Button>
            )}
          </>
        )}
      </div>
    </Section>
  );
}
