import { Icon, type LucideIcon, type LucideIconNode, type LucideProps } from 'lucide-react';
import { forwardRef, useEffect, useSyncExternalStore } from 'react';
import { iconNameSchema } from './iconName';

/**
 * Drawing a Lucide icon that is known only by name — one a user picked, stored as a string.
 *
 * The app's own icons are static imports and cost nothing to draw. A *chosen* icon can be any of
 * ~1,800, so its shape lives in the lazily-loaded catalog (`lucideIcons.ts`) and is drawn once that
 * arrives. The catalog is one fetch for every chosen icon on every screen, not one per icon, and is
 * cached for offline use from then on.
 *
 * Until it arrives, a chosen icon is an empty box of the right size rather than its fallback: the
 * fallback is a *different* icon, and showing one and then swapping it is a flicker that reads as
 * the choice not having been saved. The fallback is for when the catalog cannot be had at all
 * (offline, never fetched) or no longer knows the name.
 */

export type IconCatalog = (typeof import('./lucideIcons'))['default'];

export { iconNameSchema };

/* --- Loading ----------------------------------------------------------------------------------- */

type State =
  | { status: 'idle' | 'loading' | 'failed'; catalog: null }
  | { status: 'ready'; catalog: IconCatalog };

let state: State = { status: 'idle', catalog: null };
let pending: Promise<IconCatalog> | null = null;
const listeners = new Set<() => void>();

const publish = (next: State) => {
  state = next;
  for (const listener of listeners) listener();
};

/** Fetch the catalog, once. A failure is not remembered: the next caller tries again. */
export function loadIconCatalog(): Promise<IconCatalog> {
  pending ??= import('./lucideIcons').then(
    (module) => {
      publish({ status: 'ready', catalog: module.default });
      return module.default;
    },
    (error: unknown) => {
      pending = null;
      publish({ status: 'failed', catalog: null });
      throw error;
    },
  );
  if (state.status !== 'ready') publish({ status: 'loading', catalog: null });
  return pending;
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** The catalog's load state, starting the load if nothing has yet. */
export function useIconCatalog(): State {
  const current = useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
  useEffect(() => {
    if (state.status === 'idle') void loadIconCatalog().catch(() => {});
  }, []);
  return current;
}

/** The canonical name for a stored one — itself, or what Lucide renamed it to — if it exists. */
export function canonicalIconName(catalog: IconCatalog, name: string): string | undefined {
  if (Object.hasOwn(catalog.icons, name)) return name;
  const renamed = Object.hasOwn(catalog.aliases, name) ? catalog.aliases[name] : undefined;
  return renamed && Object.hasOwn(catalog.icons, renamed) ? renamed : undefined;
}

/* The catalog carries no React keys (see scripts/lucideIcons.mjs) and lucide's renderer passes the
   children as an array, so they are added back here, once per icon rather than once per render. */
const keyed = new Map<string, LucideIconNode[]>();

export function iconNode(catalog: IconCatalog, name: string): LucideIconNode[] | undefined {
  const canonical = canonicalIconName(catalog, name);
  if (!canonical) return undefined;
  let node = keyed.get(canonical);
  if (!node) {
    node = catalog.icons[canonical].map(([tag, attrs], index) => [tag, { ...attrs, key: index }]);
    keyed.set(canonical, node);
  }
  return node;
}

/* --- Drawing ----------------------------------------------------------------------------------- */

const EMPTY: LucideIconNode[] = [];

/**
 * A component for a named icon, shaped exactly like one of lucide's own — so a caller that holds a
 * `LucideIcon` (a category's icon, say) needs no idea whether it was imported or chosen.
 *
 * Cached per name and fallback: the result is used as a component *type*, and a fresh one each
 * render would remount it every time.
 */
const cache = new WeakMap<LucideIcon, Map<string, LucideIcon>>();

export function namedIcon(name: string, fallback: LucideIcon): LucideIcon {
  let byName = cache.get(fallback);
  if (!byName) {
    byName = new Map();
    cache.set(fallback, byName);
  }
  let component = byName.get(name);
  if (component) return component;

  const Fallback = fallback;
  component = forwardRef<SVGSVGElement, Omit<LucideProps, 'ref'>>(function NamedIcon(props, ref) {
    const { status, catalog } = useIconCatalog();
    const node = catalog ? iconNode(catalog, name) : undefined;
    if (node) return <Icon ref={ref} {...props} icon={{ name, node }} />;
    if (status === 'loading' || status === 'idle') {
      return <Icon ref={ref} {...props} iconNode={EMPTY} />;
    }
    return <Fallback ref={ref} {...props} />;
  });
  component.displayName = `NamedIcon(${name})`;
  byName.set(name, component);
  return component;
}

/** `namedIcon`, or the fallback itself when there is no name — the common "chosen or default" case. */
export const iconOrDefault = (name: string | null | undefined, fallback: LucideIcon): LucideIcon =>
  name ? namedIcon(name, fallback) : fallback;

/** `piggy-bank` → "piggy bank": how an icon is named to a person. Lucide's names are English. */
export const iconLabel = (name: string): string => name.replace(/-/g, ' ');
