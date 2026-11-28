import type { PluginRecordDto } from '@diary/shared';
import { describe, expect, it } from 'vitest';
import { seedPosition, tick, type SimNode } from './layout';
import {
  connectionWeights,
  GROUP_COLORS,
  groupData,
  linkData,
  ME_ID,
  nextGroupColor,
  parseGraph,
} from './model';

const A = 'a'.repeat(24);
const B = 'b'.repeat(24);
const C = 'c'.repeat(24);

const row = (
  id: string,
  data: Record<string, unknown>,
  updatedAt = '2026-01-01',
): PluginRecordDto => ({
  id,
  pluginId: 'social-graph',
  scope: 'record',
  dateKey: '',
  data,
  createdAt: updatedAt,
  updatedAt,
});

describe('parseGraph', () => {
  it('stores a pair the same way round whichever order it was given', () => {
    expect(linkData(B, A, 3, '')).toEqual(linkData(A, B, 3, ''));
  });

  it('keeps the newest of two links for one pair and reports the other for deletion', () => {
    const { links, duplicateLinkIds } = parseGraph([
      row('old', linkData(A, B, 2, 'old'), '2026-01-01'),
      row('new', linkData(B, A, 5, 'new'), '2026-02-01'),
    ]);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ id: 'new', strength: 5, note: 'new' });
    expect(duplicateLinkIds).toEqual(['old']);
  });

  it('drops rows it cannot trust', () => {
    const { links, groups } = parseGraph([
      row('1', { kind: 'link', a: A, b: A, strength: 3 }), // self-link
      row('2', { kind: 'link', a: A, b: B, strength: 9 }), // off the scale
      row('3', { kind: 'link', a: 'nope', b: B, strength: 3 }),
      row('4', { kind: 'group', name: '  ', color: '#000000', members: [] }),
      row('5', { kind: 'group', name: 'Ok', color: 'red', members: [A, A, 'x'] }),
    ]);
    expect(links).toEqual([]);
    expect(groups).toEqual([{ id: '5', name: 'Ok', color: GROUP_COLORS[0], members: [A] }]);
  });

  it('gives a new group the first colour nobody has', () => {
    const { groups } = parseGraph([row('g', groupData('One', GROUP_COLORS[0], [A]))]);
    expect(nextGroupColor(groups)).toBe(GROUP_COLORS[1]);
  });
});

describe('layout', () => {
  it('settles linked people closer together than unlinked ones', () => {
    const nodes: SimNode[] = [A, B, C].map((id, i) => ({ id, ...seedPosition(i), vx: 0, vy: 0 }));
    let alpha = 1;
    for (let i = 0; i < 400; i++) {
      tick(nodes, [{ a: A, b: B, strength: 5 }], [], alpha);
      alpha *= 0.985;
    }
    const [a, b, c] = nodes;
    const dist = (p: SimNode, q: SimNode) => Math.hypot(p.x - q.x, p.y - q.y);
    expect(dist(a, b)).toBeLessThan(dist(a, c));
    expect(dist(a, b)).toBeLessThan(dist(b, c));
    for (const node of nodes) expect(Number.isFinite(node.x) && Number.isFinite(node.y)).toBe(true);
  });
});

describe('connectionWeights', () => {
  it('weights each link by penalty × strength/5, and leaves "you" out', () => {
    const { links } = parseGraph([
      row('1', linkData(A, B, 5, '')),
      row('2', linkData(C, A, 2, '')),
      row('3', linkData(A, ME_ID, 4, '')),
      row('4', linkData(B, C, 3, '')),
    ]);
    expect(connectionWeights(links, A)).toEqual(
      new Map([
        [B, 0.5],
        [C, 0.2],
      ]),
    );
  });
});
