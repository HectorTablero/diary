import { describe, expect, it } from 'vitest';
import { bulkActions, type BulkCandidate } from './bulk';

const candidate = (overrides: Partial<BulkCandidate>): BulkCandidate => ({
  id: 'a',
  mergeTargetId: 'target',
  allowCreate: true,
  allowOverwrite: false,
  resolution: null,
  ...overrides,
});

describe('bulkActions', () => {
  it('offers one button per action the rows can actually take', () => {
    const actions = bulkActions([candidate({}), candidate({ id: 'b' })]);
    expect(actions.map((a) => a.kind)).toEqual(['merge', 'create']);
  });

  it('leaves out an action no row can take', () => {
    const actions = bulkActions([candidate({ mergeTargetId: null, allowCreate: false })]);
    expect(actions).toEqual([]);
  });

  it('sets every row it applies to', () => {
    const [merge] = bulkActions([candidate({}), candidate({ id: 'b', mergeTargetId: 'other' })]);
    expect(merge.patch).toEqual({
      a: { action: 'merge', targetId: 'target' },
      b: { action: 'merge', targetId: 'other' },
    });
  });

  it('lights up when every row already resolves that way', () => {
    const rows = [
      candidate({ resolution: { action: 'merge', targetId: 'target' } }),
      candidate({ id: 'b', resolution: { action: 'merge', targetId: 'target' } }),
    ];
    expect(bulkActions(rows).find((a) => a.kind === 'merge')?.selected).toBe(true);
  });

  it('goes dark as soon as one row differs', () => {
    const rows = [
      candidate({ resolution: { action: 'merge', targetId: 'target' } }),
      candidate({ id: 'b', resolution: { action: 'create' } }),
    ];
    expect(bulkActions(rows).every((a) => !a.selected)).toBe(true);
  });

  it('goes dark when a row merges somewhere else', () => {
    // Same action, different target: the user picked that one by hand, and saying the section is
    // uniformly "merge" would claim a decision nobody made.
    const rows = [
      candidate({ resolution: { action: 'merge', targetId: 'target' } }),
      candidate({
        id: 'b',
        mergeTargetId: 'target',
        resolution: { action: 'merge', targetId: 'elsewhere' },
      }),
    ];
    expect(bulkActions(rows).find((a) => a.kind === 'merge')?.selected).toBe(false);
  });

  it('never lights an action that cannot cover the whole section', () => {
    // One row is name-blocked, so "keep both" can never be what the section is set to.
    const rows = [
      candidate({ resolution: { action: 'create' } }),
      candidate({ id: 'b', allowCreate: false, resolution: { action: 'merge', targetId: 'x' } }),
    ];
    expect(bulkActions(rows).find((a) => a.kind === 'create')?.selected).toBe(false);
  });

  it('has nothing to offer for an empty section', () => {
    expect(bulkActions([])).toEqual([]);
  });
});
