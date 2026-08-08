import type { BackupResolution } from './conflicts';

/* Section-wide versions of the buttons on the rows. A backup of any size is mostly one decision
   repeated — "merge all of these, they're the same tags I already have" — and answering it one
   card at a time is the whole reason the review screen felt long enough to need collapsing. */

/** One conflicted row, reduced to what a section-wide button needs to know about it. */
export interface BulkCandidate {
  id: string;
  /** The row's first merge target, or null when it has none (nothing local to merge into). */
  mergeTargetId: string | null;
  allowCreate: boolean;
  allowOverwrite: boolean;
  /** What the row resolves to right now, default included. */
  resolution: BackupResolution | null;
}

export interface BulkAction {
  kind: BackupResolution['action'];
  /** What pressing it sets, keyed by row id — only the rows the action is legal for. */
  patch: Record<string, BackupResolution>;
  /**
   * Whether the section as a whole is already in this state.
   *
   * True only when the action covers *every* row and every row is already resolved exactly that
   * way, so at most one button in a section can ever be lit and a single row the user changed by
   * hand un-lights it. It is a readout of where the section stands, not a memory of which button
   * was pressed last — which is what makes it survive a reload of the page and what stops it from
   * claiming a uniformity that isn't there.
   */
  selected: boolean;
}

const sameResolution = (a: BackupResolution | null, b: BackupResolution | undefined): boolean => {
  if (!a || !b || a.action !== b.action) return false;
  return a.action !== 'merge' || a.targetId === (b as { targetId: string }).targetId;
};

/** Buttons for a section, in the order the rows themselves offer them. An action nothing in the
    section can take is left out entirely rather than shown disabled — a dead button in a bulk bar
    reads as a bug in the page, not as a fact about the rows. */
export function bulkActions(candidates: BulkCandidate[]): BulkAction[] {
  if (candidates.length === 0) return [];

  const build = (
    kind: BackupResolution['action'],
    resolutionFor: (candidate: BulkCandidate) => BackupResolution | null,
  ): BulkAction | null => {
    const patch: Record<string, BackupResolution> = {};
    for (const candidate of candidates) {
      const resolution = resolutionFor(candidate);
      if (resolution) patch[candidate.id] = resolution;
    }
    if (Object.keys(patch).length === 0) return null;
    const selected =
      Object.keys(patch).length === candidates.length &&
      candidates.every((candidate) => sameResolution(candidate.resolution, patch[candidate.id]));
    return { kind, patch, selected };
  };

  return [
    build('merge', (c) =>
      c.mergeTargetId ? { action: 'merge', targetId: c.mergeTargetId } : null,
    ),
    build('create', (c) => (c.allowCreate ? { action: 'create' } : null)),
    build('overwrite', (c) => (c.allowOverwrite ? { action: 'overwrite' } : null)),
  ].filter((action): action is BulkAction => action !== null);
}
