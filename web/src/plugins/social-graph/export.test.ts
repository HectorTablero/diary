import type { PluginRecordDto } from '@diary/shared';
import { describe, expect, it, vi } from 'vitest';
import { buildGraphMerged, buildGraphZip, graphExportDefaults } from './export';
import { groupData, linkData, ME_ID } from './model';

/* The graph export, read straight off its inputs: both data modules are stubbed, so this runs in
   the node `logic` project without IndexedDB. */

const ANA = 'a'.repeat(24);
const LUIS = 'b'.repeat(24);
const ZOE = 'c'.repeat(24);

let rows: PluginRecordDto[] = [];
const row = (id: string, data: Record<string, unknown>): PluginRecordDto => ({
  id,
  pluginId: 'social-graph',
  scope: 'record',
  dateKey: '',
  data,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
});

vi.mock('@/db/pluginRecords', () => ({ getUndatedRecords: async () => rows }));
vi.mock('@/db/repo', () => ({
  getPeople: async () => [
    { id: ANA, name: 'Ana' },
    { id: LUIS, name: 'Luis, "Lu"' },
    { id: ZOE, name: 'Zoe' },
  ],
}));

const all = { me: true, notes: true, skipIsolated: true };

describe('social graph export', () => {
  it('writes groups, a connections table and CSVs that quote what they must', async () => {
    rows = [
      row('1', linkData(LUIS, ANA, 4, 'Met | at work')),
      row('2', linkData(ME_ID, ANA, 5, '')),
      row('3', groupData('Work', '#000000', [LUIS, ANA, ME_ID])),
    ];
    const md = (await buildGraphMerged(all))!;
    // The notation is explained before the data, as in the diary export.
    expect(md.indexOf('## Closeness scale')).toBeLessThan(md.indexOf('---'));
    expect(md).toContain('- **4 — Close**');
    expect(md).toContain("`You` is the diary's author");
    expect(md).toContain('### Work\n\n- Ana\n- Luis, "Lu"\n- You');
    expect(md).toContain('| Ana | Luis, "Lu" | 4 – Close | Met \\| at work |');
    expect(md).toContain('| Ana | You | 5 – Very close |  |');
    expect(md).not.toContain('Zoe'); // isolated, and skipped

    const files = await buildGraphZip(all);
    expect(files.map((file) => file.name)).toEqual(['social-graph.md', 'nodes.csv', 'edges.csv']);
    expect(files[1].content).toBe(
      'Id,Label,Groups\r\nYou,You,Work\r\nAna,Ana,Work\r\n"Luis, ""Lu""","Luis, ""Lu""",Work\r\n',
    );
    expect(files[2].content.split('\r\n')[1]).toBe('Ana,"Luis, ""Lu""",4,Close,Met | at work');
  });

  it('drops you, notes and the isolated-people rule when asked', async () => {
    const md = (await buildGraphMerged({ me: false, notes: false, skipIsolated: false }))!;
    expect(md).not.toContain('`You`');
    expect(md).not.toContain('| You');
    expect(md).not.toContain('Met');
    expect(md).toContain("The diary's author is left out");
    expect(md).toContain('## Not connected to anyone\n\n- Zoe');
  });

  it('ticks "include you" only when you are connected to someone', async () => {
    expect(await graphExportDefaults()).toEqual({ me: true });
    rows = [row('1', linkData(LUIS, ANA, 4, ''))];
    expect(await graphExportDefaults()).toEqual({ me: false });
  });

  it('has nothing to export without connections or groups', async () => {
    rows = [];
    expect(await buildGraphMerged(all)).toBeNull();
    expect(await buildGraphZip(all)).toEqual([]);
  });
});
