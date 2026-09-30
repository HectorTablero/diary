import type { Plugin } from 'vite';

/** The id `src/components/icons/lucideIcons.ts` imports the catalog from. See lucideIcons.mjs. */
export declare const LUCIDE_ICONS_MODULE: 'virtual:lucide-icons';

/** A string only the catalog's chunk contains, for scripts/checkBundle.ts. See lucideIcons.mjs. */
export declare const LUCIDE_CATALOG_MARKER: string;

/** Serves every installed Lucide icon as data. See lucideIcons.mjs. */
export declare function lucideIcons(): Plugin;
