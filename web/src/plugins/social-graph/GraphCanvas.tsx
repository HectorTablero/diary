import { Maximize, Minus, Plus, User } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useReducedMotion } from '@/lib/reducedMotion';
import { cn } from '@/lib/utils';
import { seedPosition, tick, type SimLink, type SimNode } from './layout';

export interface GraphPerson {
  id: string;
  name: string;
  /** The diary's owner — drawn filled, with a person glyph instead of initials. */
  me?: boolean;
}

/** The visible window onto the graph, in graph units: the SVG's viewBox. */
interface View {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GraphLink extends SimLink {
  note?: string;
}

export interface GraphGroup {
  id: string;
  name: string;
  color: string;
  members: readonly string[];
}

const PAD = 56;
const MIN_SPAN = 320;
const DRAG_THRESHOLD = 4;
const ALPHA_DECAY = 0.985;
const ALPHA_MIN = 0.004;
/** Ticks run before the first paint, so the graph opens already roughly in shape. */
const PRESETTLE_TICKS = 160;
/** Narrowest and widest the view may get, in graph units — about 4× in and 1/10 out. */
const MIN_VIEW = 90;
const MAX_VIEW = 12000;
const BUTTON_ZOOM = 1.4;

const label = (name: string) => (name.length > 16 ? `${name.slice(0, 15)}…` : name);
const radiusFor = (degree: number) => 17 + Math.min(degree, 8);

/**
 * The force-directed picture of who knows whom.
 *
 * Tapping a node toggles it in the selection, tapping a line selects the pair it joins, tapping the
 * background clears; nodes can be dragged. Until the view is touched it fits itself to the nodes;
 * after a wheel, pinch, background drag or the +/− buttons it stays where it was put, and the fit
 * button hands it back to the automatic fit.
 *
 * A person in groups wears a ring split into one arc per group colour, so belonging to three
 * groups reads as three colours at once.
 */
export function GraphCanvas({
  people,
  links,
  groups,
  selected,
  onToggle,
  onSelectPair,
  onClear,
  className,
  ariaLabel,
}: {
  people: readonly GraphPerson[];
  links: readonly GraphLink[];
  groups: readonly GraphGroup[];
  selected: ReadonlySet<string>;
  /** Omit all three handlers for a static picture (the onboarding preview). */
  onToggle?: (id: string) => void;
  onSelectPair?: (a: string, b: string) => void;
  onClear?: () => void;
  className?: string;
  ariaLabel: string;
}) {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  const interactive = onToggle !== undefined;
  const svgRef = useRef<SVGSVGElement>(null);
  const positions = useRef(new Map<string, SimNode>());
  const alpha = useRef(1);
  const kick = useRef<() => void>(() => {});
  const drag = useRef<{ id: string; x: number; y: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const frozenView = useRef<View | null>(null);
  /** Set once the person moves the view themselves; `null` means "fit to the nodes". */
  const [userView, setUserView] = useState<View | null>(null);
  const viewRef = useRef<View>({ x: 0, y: 0, w: MIN_SPAN, h: MIN_SPAN });
  /** Background pointers currently down, for panning (one) and pinching (two). */
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const panStart = useRef<{ x: number; y: number } | null>(null);
  const panned = useRef(false);
  const [, setFrame] = useState(0);

  /* Writes the ref as well as the state so a burst of pointer moves inside one frame each start
     from the last one's result rather than from a stale render. */
  const applyView = (next: View) => {
    viewRef.current = next;
    setUserView(next);
  };

  const zoomAt = (clientX: number, clientY: number, factor: number) => {
    const matrix = svgRef.current?.getScreenCTM();
    if (!matrix) return;
    const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
    const v = viewRef.current;
    const w = Math.min(Math.max(v.w * factor, MIN_VIEW), MAX_VIEW);
    const f = w / v.w;
    applyView({
      x: point.x - (point.x - v.x) * f,
      y: point.y - (point.y - v.y) * f,
      w,
      h: v.h * f,
    });
  };

  const zoomCentre = (factor: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (rect) zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
  };

  // A wheel listener React attaches is passive, so it couldn't stop the page scrolling as well.
  const zoomAtRef = useRef(zoomAt);
  zoomAtRef.current = zoomAt;
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !interactive) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      zoomAtRef.current(event.clientX, event.clientY, Math.exp(event.deltaY * 0.0015));
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [interactive]);

  const simLinks = useMemo(() => links.map(({ a, b, strength }) => ({ a, b, strength })), [links]);
  const groupMembers = useMemo(() => groups.map((group) => group.members), [groups]);

  /* Keep each person's position across data changes, so connecting two people nudges the picture
     rather than reshuffling it. A newcomer starts beside someone they're linked to, if anyone. */
  const nodes = useMemo(() => {
    const previous = positions.current;
    const next = new Map<string, SimNode>();
    const firstLayout = previous.size === 0;
    people.forEach((person, index) => {
      const known = previous.get(person.id);
      if (known) return next.set(person.id, known);
      const partner = simLinks.find((link) => link.a === person.id || link.b === person.id);
      const anchor = partner && previous.get(partner.a === person.id ? partner.b : partner.a);
      const seed = seedPosition(index);
      next.set(person.id, {
        id: person.id,
        x: anchor ? anchor.x + seed.x * 0.2 : seed.x,
        y: anchor ? anchor.y + seed.y * 0.2 : seed.y,
        vx: 0,
        vy: 0,
      });
    });
    positions.current = next;
    const list = [...next.values()];
    if (firstLayout) {
      for (let i = 0; i < PRESETTLE_TICKS; i++) {
        tick(list, simLinks, groupMembers, alpha.current);
        alpha.current *= ALPHA_DECAY;
      }
    }
    return list;
    // simLinks/groupMembers deliberately not deps: they only seed newcomers and the pre-settle.
  }, [people]);

  useEffect(() => {
    alpha.current = Math.max(alpha.current, 0.5);
    if (reduced) {
      // No animation: settle in one go and draw the result.
      for (let i = 0; i < 300 && alpha.current > ALPHA_MIN; i++) {
        tick(nodes, simLinks, groupMembers, alpha.current);
        alpha.current *= ALPHA_DECAY;
      }
      setFrame((f) => f + 1);
      kick.current = () => setFrame((f) => f + 1);
      return;
    }
    let raf = 0;
    const loop = () => {
      tick(nodes, simLinks, groupMembers, alpha.current);
      alpha.current *= ALPHA_DECAY;
      setFrame((f) => f + 1);
      raf = alpha.current > ALPHA_MIN || drag.current ? requestAnimationFrame(loop) : 0;
    };
    raf = requestAnimationFrame(loop);
    kick.current = () => {
      alpha.current = Math.max(alpha.current, 0.3);
      if (!raf) raf = requestAnimationFrame(loop);
    };
    return () => cancelAnimationFrame(raf);
  }, [nodes, simLinks, groupMembers, reduced]);

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const degree = new Map<string, number>();
  for (const link of links) {
    degree.set(link.a, (degree.get(link.a) ?? 0) + 1);
    degree.set(link.b, (degree.get(link.b) ?? 0) + 1);
  }
  const groupsOf = new Map<string, GraphGroup[]>();
  for (const group of groups) {
    for (const id of group.members) groupsOf.set(id, [...(groupsOf.get(id) ?? []), group]);
  }

  // Everyone selected and everyone they're linked to stays bright; the rest steps back.
  const focus = new Set(selected);
  if (selected.size) {
    for (const link of links) {
      if (selected.has(link.a)) focus.add(link.b);
      if (selected.has(link.b)) focus.add(link.a);
    }
  }

  let view = userView ?? frozenView.current;
  if (!view) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of nodes) {
      minX = Math.min(minX, node.x);
      minY = Math.min(minY, node.y);
      maxX = Math.max(maxX, node.x);
      maxY = Math.max(maxY, node.y);
    }
    if (!nodes.length) minX = minY = maxX = maxY = 0;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const w = Math.max(maxX - minX + PAD * 2, MIN_SPAN);
    const h = Math.max(maxY - minY + PAD * 2, MIN_SPAN);
    view = { x: cx - w / 2, y: cy - h / 2, w, h };
  }
  viewRef.current = view;

  const onBackgroundPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (!interactive || event.target !== event.currentTarget) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 1) {
      panStart.current = { x: event.clientX, y: event.clientY };
      panned.current = false;
    }
  };

  const onBackgroundPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const last = pointers.current.get(event.pointerId);
    if (!last) return;
    const matrix = svgRef.current?.getScreenCTM();
    if (!matrix) return;
    if (pointers.current.size === 2) {
      // Pinch: zoom by how much the two fingers' distance changed, around their midpoint.
      const [p, q] = [...pointers.current.entries()].map(([id, point]) =>
        id === event.pointerId ? { x: event.clientX, y: event.clientY } : point,
      );
      const [p0, q0] = [...pointers.current.values()];
      const before = Math.hypot(p0.x - q0.x, p0.y - q0.y);
      const after = Math.hypot(p.x - q.x, p.y - q.y);
      if (before > 0 && after > 0) zoomAt((p.x + q.x) / 2, (p.y + q.y) / 2, before / after);
      panned.current = true;
    } else {
      const start = panStart.current;
      if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) >= DRAG_THRESHOLD) {
        panned.current = true;
      }
      if (panned.current) {
        const v = viewRef.current;
        applyView({
          ...v,
          x: v.x - (event.clientX - last.x) / matrix.a,
          y: v.y - (event.clientY - last.y) / matrix.d,
        });
      }
    }
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
  };

  const onBackgroundPointerUp = (event: PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(event.pointerId);
    const [remaining] = pointers.current.values();
    panStart.current = remaining ?? null;
  };

  const toSvg = (event: PointerEvent) => {
    const matrix = svgRef.current?.getScreenCTM();
    if (!matrix) return null;
    return new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
  };

  const onNodePointerDown = (event: PointerEvent<SVGGElement>, id: string) => {
    if (!interactive || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id, x: event.clientX, y: event.clientY, moved: false };
  };

  const onNodePointerMove = (event: PointerEvent<SVGGElement>) => {
    const current = drag.current;
    if (!current) return;
    if (!current.moved) {
      if (Math.hypot(event.clientX - current.x, event.clientY - current.y) < DRAG_THRESHOLD) return;
      current.moved = true;
      // Hold the frame still while dragging, or the view refits under the pointer.
      frozenView.current = view;
    }
    const node = byId.get(current.id);
    const point = toSvg(event);
    if (!node || !point) return;
    node.pinned = true;
    node.x = point.x;
    node.y = point.y;
    kick.current();
  };

  const onNodePointerUp = () => {
    const current = drag.current;
    drag.current = null;
    if (!current?.moved) return;
    suppressClick.current = true;
    frozenView.current = null;
    const node = byId.get(current.id);
    if (node) node.pinned = false;
    kick.current();
  };

  return (
    <div className={cn('relative size-full', className)}>
      <svg
        ref={svgRef}
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        role="group"
        aria-label={ariaLabel}
        className={cn('block size-full select-none', interactive && 'touch-none')}
        onPointerDown={onBackgroundPointerDown}
        onPointerMove={onBackgroundPointerMove}
        onPointerUp={onBackgroundPointerUp}
        onPointerCancel={onBackgroundPointerUp}
        onClick={(event) => {
          if (event.target !== event.currentTarget) return;
          if (panned.current) panned.current = false;
          else onClear?.();
        }}
      >
        <g>
          {links.map((link) => {
            const p = byId.get(link.a);
            const q = byId.get(link.b);
            if (!p || !q) return null;
            const lit = selected.has(link.a) || selected.has(link.b);
            const faded = selected.size > 0 && !lit;
            return (
              <g key={`${link.a}:${link.b}`}>
                <line
                  x1={p.x}
                  y1={p.y}
                  x2={q.x}
                  y2={q.y}
                  className={cn(
                    'transition-[stroke-opacity] duration-200',
                    lit ? 'stroke-primary' : 'stroke-muted-foreground',
                  )}
                  strokeOpacity={
                    faded ? 0.08 : lit ? 0.55 + link.strength * 0.09 : 0.14 + link.strength * 0.09
                  }
                  strokeWidth={0.75 + link.strength * 0.6}
                  strokeLinecap="round"
                />
                {interactive && (
                  <line
                    x1={p.x}
                    y1={p.y}
                    x2={q.x}
                    y2={q.y}
                    stroke="transparent"
                    strokeWidth={14}
                    className="cursor-pointer"
                    onClick={() => onSelectPair?.(link.a, link.b)}
                  >
                    {link.note && <title>{link.note}</title>}
                  </line>
                )}
              </g>
            );
          })}
        </g>
        <g>
          {people.map((person) => {
            const node = byId.get(person.id);
            if (!node) return null;
            const r = radiusFor(degree.get(person.id) ?? 0);
            const memberOf = groupsOf.get(person.id) ?? [];
            const isSelected = selected.has(person.id);
            const dimmed = selected.size > 0 && !focus.has(person.id);
            const ringR = r + 4;
            const circumference = 2 * Math.PI * ringR;
            const arc = circumference / Math.max(memberOf.length, 1);
            const gap = memberOf.length > 1 ? 3 : 0;
            return (
              <g
                key={person.id}
                transform={`translate(${node.x} ${node.y})`}
                opacity={dimmed ? 0.3 : 1}
                className={cn(
                  'transition-opacity duration-200 outline-none',
                  interactive && 'cursor-pointer touch-none',
                  // Keyboard focus draws the same ring selection does, dashed, so the two never blur.
                  '[&:focus-visible_.focus-ring]:opacity-100',
                )}
                role={interactive ? 'button' : undefined}
                tabIndex={interactive ? 0 : undefined}
                aria-pressed={interactive ? isSelected : undefined}
                aria-label={interactive ? person.name : undefined}
                onPointerDown={(event) => onNodePointerDown(event, person.id)}
                onPointerMove={onNodePointerMove}
                onPointerUp={onNodePointerUp}
                onPointerCancel={onNodePointerUp}
                onClick={() => {
                  if (suppressClick.current) {
                    suppressClick.current = false;
                    return;
                  }
                  onToggle?.(person.id);
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return;
                  event.preventDefault();
                  onToggle?.(person.id);
                }}
              >
                <circle r={r} className="fill-card" />
                <circle r={r} className={person.me ? 'fill-primary' : 'fill-primary/10'} />
                {memberOf.map((group, i) => (
                  <circle
                    key={group.id}
                    r={ringR}
                    fill="none"
                    stroke={group.color}
                    strokeWidth={3.5}
                    strokeDasharray={`${arc - gap} ${circumference - arc + gap}`}
                    strokeDashoffset={-i * arc}
                    transform="rotate(-90)"
                  />
                ))}
                {isSelected && (
                  <circle r={ringR + 5} fill="none" className="stroke-primary" strokeWidth={2} />
                )}
                <circle
                  r={ringR + 5}
                  fill="none"
                  className="focus-ring stroke-ring opacity-0"
                  strokeWidth={2}
                  strokeDasharray="4 3"
                />
                {person.me ? (
                  <User
                    x={-r * 0.5}
                    y={-r * 0.5}
                    width={r}
                    height={r}
                    aria-hidden
                    className="pointer-events-none text-primary-foreground"
                  />
                ) : (
                  <text
                    textAnchor="middle"
                    dominantBaseline="central"
                    className="pointer-events-none fill-primary text-[11px] font-semibold uppercase"
                  >
                    {person.name.slice(0, 2)}
                  </text>
                )}
                <text
                  y={ringR + 14}
                  textAnchor="middle"
                  className={cn(
                    // The halo is the canvas colour, so a name stays legible over a line behind it.
                    'pointer-events-none stroke-card text-[11px] [paint-order:stroke]',
                    isSelected ? 'fill-foreground font-medium' : 'fill-muted-foreground',
                  )}
                  strokeWidth={3}
                  strokeLinejoin="round"
                >
                  {label(person.name)}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
      {interactive && (
        <div className="absolute top-2 right-2 flex flex-col overflow-hidden rounded-lg border bg-card/90 shadow-xs backdrop-blur-sm">
          <Button
            variant="ghost"
            size="icon"
            className="size-8 rounded-none"
            aria-label={t('plugins.social-graph.zoomIn')}
            onClick={() => zoomCentre(1 / BUTTON_ZOOM)}
          >
            <Plus className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 rounded-none border-t"
            aria-label={t('plugins.social-graph.zoomOut')}
            onClick={() => zoomCentre(BUTTON_ZOOM)}
          >
            <Minus className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 rounded-none border-t"
            aria-label={t('plugins.social-graph.fitView')}
            disabled={userView === null}
            onClick={() => setUserView(null)}
          >
            <Maximize className="size-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}
