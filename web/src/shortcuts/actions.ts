import type { TFunction } from 'i18next';
import type { PluginNavItem } from '@/plugins/usePluginNav';
import type { Binding } from './bindings';

/**
 * Every shortcut the app has, with its default binding.
 *
 * The defaults split along the modifier on purpose, so holding one key shows one family of hints:
 *
 *  - **Alt + digit goes somewhere**, numbered down the sidebar: 1 is Entries, 2 Calendar… and 0 is
 *    Settings, which sits at the bottom whatever comes above it. Enabled plugins take 7, 8, 9 in
 *    sidebar order; a fourth has no default, and can be given one in Settings.
 *  - **Ctrl/⌘ + digit changes the entry being written**: 1–5 set its importance, the same numbers
 *    the levels already carry. Scoped to the composer, so the keys mean nothing anywhere else.
 *
 * Ctrl+digit is what browsers use to switch tabs, and some won't let a page take it back. That is
 * the main reason every binding here can be changed — a default that a browser swallows is one
 * visit to Settings from working.
 */

export type ShortcutGroup = 'navigation' | 'entry';

export interface ShortcutAction {
  /** Stable across releases: it is the key overrides are stored under. */
  id: string;
  group: ShortcutGroup;
  label: string;
  defaultBinding: Binding | null;
}

export interface NavShortcut extends ShortcutAction {
  to: string;
}

const BUILTIN_NAV: readonly {
  id: string;
  to: string;
  labelKey: string;
  defaultBinding: Binding;
}[] = [
  { id: 'nav.diary', to: '/diary', labelKey: 'nav.diary', defaultBinding: 'alt+1' },
  { id: 'nav.calendar', to: '/calendar', labelKey: 'nav.calendar', defaultBinding: 'alt+2' },
  { id: 'nav.people', to: '/people', labelKey: 'nav.people', defaultBinding: 'alt+3' },
  { id: 'nav.search', to: '/search', labelKey: 'nav.search', defaultBinding: 'alt+4' },
  { id: 'nav.tags', to: '/tags', labelKey: 'nav.tags', defaultBinding: 'alt+5' },
  { id: 'nav.threads', to: '/threads', labelKey: 'nav.threads', defaultBinding: 'alt+6' },
];

const SETTINGS_NAV = {
  id: 'nav.settings',
  to: '/settings',
  labelKey: 'nav.settings',
  defaultBinding: 'alt+0',
};

const PLUGIN_NAV_DEFAULTS: readonly Binding[] = ['alt+7', 'alt+8', 'alt+9'];

/** In sidebar order, which is also the order Settings lists them in. Threads only when the sidebar
    shows it: a shortcut to a hidden screen would be a way around the switch that hid it. */
export function navShortcuts(
  pluginNav: readonly PluginNavItem[],
  threadsOn: boolean,
  t: TFunction,
): NavShortcut[] {
  const builtin = (item: typeof SETTINGS_NAV): NavShortcut => ({
    id: item.id,
    to: item.to,
    group: 'navigation',
    label: t('settings.shortcuts.goTo', { name: t(item.labelKey) }),
    defaultBinding: item.defaultBinding,
  });
  return [
    ...BUILTIN_NAV.filter((item) => threadsOn || item.id !== 'nav.threads').map(builtin),
    ...pluginNav.map((plugin, index): NavShortcut => ({
      id: `nav.plugin.${plugin.id}`,
      to: plugin.to,
      group: 'navigation',
      label: t('settings.shortcuts.goTo', { name: plugin.label }),
      defaultBinding: PLUGIN_NAV_DEFAULTS[index] ?? null,
    })),
    builtin(SETTINGS_NAV),
  ];
}

export const IMPORTANCE_LEVELS = [1, 2, 3, 4, 5] as const;

export const importanceShortcutId = (level: number) => `importance.${level}`;

export const importanceDefaultBinding = (level: number): Binding => `mod+${level}`;

export function importanceShortcuts(t: TFunction): ShortcutAction[] {
  return IMPORTANCE_LEVELS.map((level) => ({
    id: importanceShortcutId(level),
    group: 'entry',
    label: t('settings.shortcuts.setImportance', { level: t(`importance.levels.${level}`) }),
    defaultBinding: importanceDefaultBinding(level),
  }));
}

/** The binding in effect: the user's override when there is one (null meaning "turned off"),
    otherwise the default. */
export function resolveBinding(
  id: string,
  defaultBinding: Binding | null,
  overrides: Readonly<Record<string, Binding | null>>,
): Binding | null {
  return Object.hasOwn(overrides, id) ? overrides[id] : defaultBinding;
}

/**
 * What a binding shared by several actions does: the first of them from anywhere else, then each
 * following one on every further press, and back round to the first after the last.
 *
 * So a clash is never a dead key. With Threads, Notebook and Expenses all on Alt+6, pressing it
 * walks the three in sidebar order — which is also why Settings flags a clash but doesn't refuse
 * it: sharing one key between related places is a reasonable thing to want.
 */
export function nextInCycle<T>(options: readonly T[], isCurrent: (option: T) => boolean): T {
  const index = options.findIndex(isCurrent);
  return options[(index + 1) % options.length];
}
