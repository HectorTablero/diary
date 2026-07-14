import { describe, expect, it } from 'vitest';
import { MAX_SUB_ENTRY_DEPTH } from './constants';
import { isSelfOrDescendant, subtreeHeight, wouldExceedMaxDepth } from './tree';

describe('subtreeHeight', () => {
  it('is 1 for a leaf', () => {
    expect(subtreeHeight({ children: [] })).toBe(1);
  });

  it('is 1 + the tallest branch', () => {
    const tree = {
      children: [
        { children: [] },
        { children: [{ children: [{ children: [] }] }] }, // 3 levels below the root
      ],
    };
    expect(subtreeHeight(tree)).toBe(4);
  });
});

// These pin an explicit maxDepth of 3 on every call rather than relying on the
// MAX_SUB_ENTRY_DEPTH default, so the boundary cases stay meaningful regardless of whatever that
// constant is currently set to elsewhere in the app. Root sits at depth 0.
describe('wouldExceedMaxDepth', () => {
  it('blocks a depth-3 leaf dropped under an already depth-3 target', () => {
    expect(wouldExceedMaxDepth(3, 1, 3)).toBe(true);
  });

  it('allows a depth-3 leaf dropped under a shallower target, including a new root', () => {
    expect(wouldExceedMaxDepth(-1, 1, 3)).toBe(false); // promote to root
    expect(wouldExceedMaxDepth(0, 1, 3)).toBe(false);
    expect(wouldExceedMaxDepth(1, 1, 3)).toBe(false);
    expect(wouldExceedMaxDepth(2, 1, 3)).toBe(false);
  });

  it('blocks a depth-2 node with a child of its own under a depth-2 or depth-3 target', () => {
    expect(wouldExceedMaxDepth(2, 2, 3)).toBe(true);
    expect(wouldExceedMaxDepth(3, 2, 3)).toBe(true);
  });

  it('allows that same node (now childless) under a depth-2 target', () => {
    expect(wouldExceedMaxDepth(2, 1, 3)).toBe(false);
  });

  it('blocks a depth-1 node (any height) dropped under a depth-3 target', () => {
    expect(wouldExceedMaxDepth(3, 1, 3)).toBe(true); // even a leaf
    expect(wouldExceedMaxDepth(3, 3, 3)).toBe(true);
  });

  it('respects a custom maxDepth', () => {
    expect(wouldExceedMaxDepth(1, 1, 1)).toBe(true);
    expect(wouldExceedMaxDepth(0, 1, 1)).toBe(false);
  });

  it('defaults to the live MAX_SUB_ENTRY_DEPTH constant when maxDepth is omitted', () => {
    expect(wouldExceedMaxDepth(0, MAX_SUB_ENTRY_DEPTH)).toBe(false);
    expect(wouldExceedMaxDepth(1, MAX_SUB_ENTRY_DEPTH)).toBe(true);
  });
});

describe('isSelfOrDescendant', () => {
  // a -> b -> c, and a -> d
  const parentById = new Map<string, string | null>([
    ['a', null],
    ['b', 'a'],
    ['c', 'b'],
    ['d', 'a'],
  ]);

  it('is true when the candidate is the node itself', () => {
    expect(isSelfOrDescendant('a', 'a', parentById)).toBe(true);
  });

  it('is true when the candidate is a descendant, however deep', () => {
    expect(isSelfOrDescendant('b', 'a', parentById)).toBe(true);
    expect(isSelfOrDescendant('c', 'a', parentById)).toBe(true);
  });

  it('is false for an unrelated node or a non-descendant', () => {
    expect(isSelfOrDescendant('d', 'b', parentById)).toBe(false);
    expect(isSelfOrDescendant('a', 'b', parentById)).toBe(false); // moving into your own parent is fine
  });

  it('is false for an id absent from the map', () => {
    expect(isSelfOrDescendant('missing', 'a', parentById)).toBe(false);
  });
});
