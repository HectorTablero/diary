import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLUGIN_ID_REGEX } from '@diary/shared';
import { describe, expect, it } from 'vitest';
import { MAX_NOTIFYING_PLUGINS } from '@/lib/notificationIds';
import { findPlugin, PLUGINS, pluginSlot } from './registry';

/* The plugin system's cost to someone with no plugins enabled is supposed to be nothing, and that
   is not a property of the design — it is a property of a handful of rules in registry.ts that are
   easy to break by accident and silent when broken. This file enforces the ones observable from
   inside the app; scripts/checkBundle.ts enforces the rest against real build output. */

const here = dirname(fileURLToPath(import.meta.url));

describe('the manifest', () => {
  it('gives every plugin a unique, well-formed id', () => {
    const ids = PLUGINS.map((plugin) => plugin.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      // The same shape the server enforces: it is an index key, a folder name, a localStorage key
      // and an i18n key prefix all at once.
      expect(id).toMatch(PLUGIN_ID_REGEX);
    }
  });

  it('fits inside the notification id space', () => {
    // Each plugin owns a fixed slice of the third of the id space reserved for reminders.
    expect(PLUGINS.length).toBeLessThanOrEqual(MAX_NOTIFYING_PLUGINS);
    for (const plugin of PLUGINS) {
      expect(pluginSlot(plugin.id)).toBeGreaterThanOrEqual(0);
    }
    expect(pluginSlot('not-a-plugin')).toBe(-1);
  });

  it('finds a plugin by id, and does not invent one', () => {
    expect(findPlugin('habits')?.id).toBe('habits');
    expect(findPlugin('nope')).toBeUndefined();
  });

  it('never lets a plugin claim the calendar page\'s reserved "entries" id', () => {
    // CalendarPage.tsx uses "entries" as the view-switcher's default tab, sharing the `view` state
    // with every plugin's own id. A plugin registered under that id would silently take over the
    // diary's own heatmap tab instead of getting one of its own — a collision `PLUGIN_ID_REGEX`
    // has no way to catch, since "entries" is a perfectly well-formed id.
    expect(findPlugin('entries')).toBeUndefined();
  });
});

/* Rule 2. A template-literal import path makes Rolldown emit a chunk for every directory under
   plugins/ — and can merge them — which hands every visitor every plugin at once. It is the single
   easiest way to undo the whole thing, it looks tidier than the literal form, and nothing else
   would notice. Asserted against the source text because that is where the mistake lives. */
describe('the import thunks', () => {
  it('use literal paths, never a template literal', () => {
    const source = readFileSync(join(here, 'registry.ts'), 'utf8');
    const thunks = [...source.matchAll(/load:\s*\(\)\s*=>\s*import\(([^)]*)\)/g)].map((m) => m[1]);

    expect(thunks).toHaveLength(PLUGINS.length);
    for (const argument of thunks) {
      expect(argument.trim()).toMatch(/^'\.\/[a-z][a-z0-9-]*'$/);
      expect(argument).not.toContain('`');
      expect(argument).not.toContain('${');
    }
  });

  it('points each thunk at the folder named by its id', () => {
    const source = readFileSync(join(here, 'registry.ts'), 'utf8');
    for (const plugin of PLUGINS) {
      expect(source).toContain(`import('./${plugin.id}')`);
    }
  });
});

/* The remaining rule — that `surfaces` matches what a plugin actually exports — needs each module
   loaded, and a plugin module pulls in the whole React UI tree. That belongs in the jsdom project,
   so it lives in registry.surfaces.test.tsx. Importing it here made this file the slowest in the
   suite and starved the parallel workers around it. */
