/**
 * A small force-directed layout: nodes repel, links pull by their strength, groups huddle, and
 * everything drifts gently toward the middle.
 *
 * ponytail: O(n²) repulsion — fine for a diary's few hundred people; swap in a Barnes–Hut quadtree
 * (or d3-force) if someone ever lays out thousands.
 */

export interface SimNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Held in place — the node being dragged. */
  pinned?: boolean;
}

export interface SimLink {
  a: string;
  b: string;
  /** 1–5. Stronger links are shorter and stiffer. */
  strength: number;
}

const REPULSION = 7000;
const GRAVITY = 0.012;
const GROUP_PULL = 0.03;
const VELOCITY_DECAY = 0.55;

export const restLength = (strength: number) => 220 - strength * 26;

/** Where a node with no better idea starts: a sunflower spiral, so first frames aren't a pile. */
export function seedPosition(index: number): { x: number; y: number } {
  const radius = 30 * Math.sqrt(index + 0.5);
  const angle = index * Math.PI * (3 - Math.sqrt(5));
  return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
}

/** One step of the simulation at temperature `alpha` (1 hot → 0 settled). Mutates `nodes`. */
export function tick(
  nodes: SimNode[],
  links: readonly SimLink[],
  groups: readonly (readonly string[])[],
  alpha: number,
): void {
  const byId = new Map(nodes.map((node) => [node.id, node]));

  for (let i = 0; i < nodes.length; i++) {
    const p = nodes[i];
    for (let j = i + 1; j < nodes.length; j++) {
      const q = nodes[j];
      let dx = q.x - p.x;
      let dy = q.y - p.y;
      // Two nodes on the same spot would never separate; nudge them apart deterministically.
      if (dx === 0 && dy === 0) dx = (j - i) * 0.1;
      const d2 = Math.max(dx * dx + dy * dy, 64);
      const force = (REPULSION * alpha) / d2;
      const d = Math.sqrt(d2);
      dx = (dx / d) * force;
      dy = (dy / d) * force;
      p.vx -= dx;
      p.vy -= dy;
      q.vx += dx;
      q.vy += dy;
    }
  }

  for (const link of links) {
    const p = byId.get(link.a);
    const q = byId.get(link.b);
    if (!p || !q) continue;
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const k = (0.02 + link.strength * 0.014) * alpha;
    const pull = ((d - restLength(link.strength)) / d) * k;
    p.vx += dx * pull;
    p.vy += dy * pull;
    q.vx -= dx * pull;
    q.vy -= dy * pull;
  }

  for (const members of groups) {
    const inGroup = members.flatMap((id) => byId.get(id) ?? []);
    if (inGroup.length < 2) continue;
    const cx = inGroup.reduce((sum, node) => sum + node.x, 0) / inGroup.length;
    const cy = inGroup.reduce((sum, node) => sum + node.y, 0) / inGroup.length;
    for (const node of inGroup) {
      node.vx += (cx - node.x) * GROUP_PULL * alpha;
      node.vy += (cy - node.y) * GROUP_PULL * alpha;
    }
  }

  for (const node of nodes) {
    if (node.pinned) {
      node.vx = node.vy = 0;
      continue;
    }
    node.vx = (node.vx - node.x * GRAVITY * alpha) * VELOCITY_DECAY;
    node.vy = (node.vy - node.y * GRAVITY * alpha) * VELOCITY_DECAY;
    node.x += node.vx;
    node.y += node.vy;
  }
}
