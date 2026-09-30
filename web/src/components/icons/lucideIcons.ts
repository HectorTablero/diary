import catalog from 'virtual:lucide-icons';

/**
 * Every Lucide icon, as data — the module `iconCatalog.tsx` imports lazily and nothing imports
 * statically.
 *
 * It exists as a file of its own only to be a *place*: vite.config.ts names it in `ON_DEMAND_ROOTS`,
 * so its chunk is kept out of the service worker's precache and fetched the first time an icon
 * someone chose has to be drawn. See scripts/lucideIcons.mjs for what is in it and why it is not
 * lucide-react's own components.
 */
export default catalog;
