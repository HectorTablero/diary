import { useMemo } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useThreadsEnabled } from '@/api/hooks';
import { usePreferences } from '@/lib/preferences';
import type { PluginNavItem } from '@/plugins/usePluginNav';
import { navShortcuts, nextInCycle, resolveBinding } from './actions';
import { canonicalBinding, type Binding } from './bindings';
import { useShortcutsEnabled } from './ShortcutHints';

/** A modal owns the keyboard: navigating out from under an open dialog would leave it open over a
    screen it has nothing to do with. */
const dialogOpen = () => !!document.querySelector('[role="dialog"], [role="alertdialog"]');

/** `/diary/2026-09-30` is still the diary. */
const isAt = (pathname: string, to: string) => pathname === to || pathname.startsWith(`${to}/`);

/**
 * Registers the navigation shortcuts and returns the binding in effect for each destination, so the
 * sidebar can put a hint on each link.
 *
 * Takes the plugin nav from its caller rather than calling usePluginNav again: the sidebar already
 * has it, and a second instance would load the same plugin locales a second time.
 *
 * One useHotkeys call for all of them, not one per link, because the list changes length as
 * plugins are turned on and off and a hook can't be called a varying number of times.
 */
export function useNavShortcuts(pluginNav: readonly PluginNavItem[]): ReadonlyMap<string, Binding> {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const threadsOn = useThreadsEnabled();
  const enabled = useShortcutsEnabled();
  const { shortcutOverrides } = usePreferences();

  const { bindingByPath, pathsByBinding } = useMemo(() => {
    const byPath = new Map<string, Binding>();
    const byBinding = new Map<Binding, string[]>();
    for (const action of navShortcuts(pluginNav, threadsOn, t)) {
      const binding = resolveBinding(action.id, action.defaultBinding, shortcutOverrides);
      if (!binding) continue;
      byPath.set(action.to, binding);
      const canonical = canonicalBinding(binding);
      // In sidebar order, which is the order a shared key cycles through them in.
      byBinding.set(canonical, [...(byBinding.get(canonical) ?? []), action.to]);
    }
    return { bindingByPath: byPath, pathsByBinding: byBinding };
  }, [pluginNav, threadsOn, t, shortcutOverrides]);

  const keys = [...pathsByBinding.keys()];

  useHotkeys(
    keys,
    (event, hotkey) => {
      if (event.repeat) return;
      const paths = pathsByBinding.get(canonicalBinding(hotkey.hotkey));
      if (!paths) return;
      /* The address bar, not useLocation(). The router runs navigations as transitions, so while
         a lazy page's chunk loads the URL has already moved on but React's location hasn't — and a
         second quick press, read against the stale one, would cycle from the wrong place. */
      const { pathname } = window.location;
      const to = nextInCycle(paths, (path) => isAt(pathname, path));
      if (!isAt(pathname, to)) void navigate(to);
    },
    {
      enabled: enabled && keys.length > 0,
      // Every binding needs Ctrl, Alt or ⌘, so none of them is something a person types.
      enableOnFormTags: true,
      enableOnContentEditable: true,
      ignoreEventWhen: dialogOpen,
      preventDefault: true,
    },
  );

  return enabled ? bindingByPath : EMPTY;
}

const EMPTY: ReadonlyMap<string, Binding> = new Map();
