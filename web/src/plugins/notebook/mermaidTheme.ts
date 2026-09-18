/**
 * Mermaid's theme, read from the app's own design tokens — so a diagram is drawn in the same greys,
 * font and corners as the page around it, in both light and dark.
 *
 * Only renderDiagram.ts imports this, which keeps it in the on-demand Mermaid chunk with it.
 *
 * ## Why the tokens are converted
 *
 * Mermaid's colour engine reads hex and nothing else — not `oklch()`, which is what every token in
 * index.css is written in, and not `var()`. So each token is resolved to a hex value at render time
 * (`readTokens`), and a diagram is re-rendered when the theme flips rather than following it through
 * CSS (see MermaidDiagram.tsx). Everything after that is `themeVariablesFrom`, which is pure and is
 * where the actual design decisions are.
 */

/** The tokens a diagram is drawn from, as hex. */
export interface ThemeTokens {
  background: string;
  foreground: string;
  secondary: string;
  muted: string;
  mutedForeground: string;
  border: string;
  ring: string;
  destructive: string;
}

const TOKEN_NAMES: Record<keyof ThemeTokens, string> = {
  background: '--background',
  foreground: '--foreground',
  secondary: '--secondary',
  muted: '--muted',
  mutedForeground: '--muted-foreground',
  border: '--border',
  ring: '--ring',
  destructive: '--destructive',
};

/**
 * The categorical order, for anything that colours by identity: pie slices, mind-map branches,
 * timeline sections, git lanes, gantt work.
 *
 * Softened from the dataviz reference palette — chroma at 85%, with the two deepest hues (green,
 * violet) lifted a little — and validated with its checker on the app's own surfaces: white, and the
 * dark page's #0a0a0a. Both modes pass the lightness band, chroma floor and normal-vision separation;
 * colour-blind separation sits at 7.5–7.8, just under the 8 target, which the checker allows only
 * where colour is not the only encoding. Every Mermaid chart labels what it colours (a pie's legend
 * and percentages, a node's own text), so that condition holds. The dark column is the same hues
 * stepped for a dark surface, not a different palette.
 */
export const SERIES = {
  light: ['#3b79c8', '#e07148', '#41ac7e', '#e5a53f', '#df82a4', '#3f963b', '#5c55b1', '#d75753'],
  dark: ['#4988d7', '#ce633b', '#3a9b74', '#c28833', '#cb5c82', '#388f35', '#9088dd', '#db706e'],
} as const;

/** Reserved for a gantt's critical tasks and today line — a status, never a series colour. */
const CRITICAL = '#d03b3b';

/** Near-black or white text on a fill, whichever has the higher contrast. */
export function inkOn(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const linear = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const L = 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  return 1.05 / (L + 0.05) >= (L + 0.05) / 0.05 ? '#ffffff' : '#0a0a0a';
}

const indexed = (prefix: string, values: readonly string[], from = 0) =>
  Object.fromEntries(values.map((value, i) => [`${prefix}${i + from}`, value]));

/**
 * `themeVariables` for Mermaid's `base` theme.
 *
 * Boxes are the app's quiet `--secondary` fill with a `--ring`-weight border — cards, like the rest
 * of the app, rather than coloured blobs. Lines are `--muted-foreground`; everything that reads is
 * `--foreground`. Colour is kept for what colour is for: telling categories apart.
 */
export function themeVariablesFrom(t: ThemeTokens, dark: boolean, fontFamily: string) {
  const series = SERIES[dark ? 'dark' : 'light'];
  return {
    darkMode: dark,
    background: t.background,
    fontFamily,
    fontSize: '14px',
    /* Flat, like the app's own cards. Mermaid 12's base theme puts a light-grey drop shadow under
       every box and a gradient on its border — on the dark background that pale shadow reads as a
       glow around each node. */
    dropShadow: 'none',
    useGradient: false,

    primaryColor: t.secondary,
    primaryTextColor: t.foreground,
    primaryBorderColor: t.ring,
    secondaryColor: t.muted,
    secondaryTextColor: t.foreground,
    secondaryBorderColor: t.ring,
    tertiaryColor: t.muted,
    tertiaryTextColor: t.foreground,
    tertiaryBorderColor: t.border,
    mainBkg: t.secondary,
    nodeBorder: t.ring,
    nodeTextColor: t.foreground,
    textColor: t.foreground,
    titleColor: t.foreground,
    lineColor: t.mutedForeground,
    edgeLabelBackground: t.background,
    clusterBkg: t.muted,
    clusterBorder: t.border,
    noteBkgColor: t.muted,
    noteTextColor: t.foreground,
    noteBorderColor: t.border,

    actorBkg: t.secondary,
    actorBorder: t.ring,
    actorTextColor: t.foreground,
    actorLineColor: t.border,
    signalColor: t.mutedForeground,
    signalTextColor: t.foreground,
    labelBoxBkgColor: t.secondary,
    labelBoxBorderColor: t.ring,
    labelTextColor: t.foreground,
    loopTextColor: t.foreground,
    activationBkgColor: t.muted,
    activationBorderColor: t.ring,
    sequenceNumberColor: t.background,

    stateBkg: t.secondary,
    stateLabelColor: t.foreground,
    compositeBackground: t.muted,
    altBackground: t.muted,
    transitionColor: t.mutedForeground,
    specialStateColor: t.foreground,
    classText: t.foreground,

    ...indexed('pie', series, 1),
    pieTitleTextColor: t.foreground,
    pieSectionTextColor: '#ffffff',
    pieLegendTextColor: t.foreground,
    pieStrokeColor: t.background,
    pieStrokeWidth: '2px',
    pieOuterStrokeColor: t.background,
    pieOuterStrokeWidth: '0px',
    pieOpacity: '1',
    ...indexed('cScale', series),
    ...indexed('cScaleLabel', series.map(inkOn)),
    ...indexed('git', series),

    taskBkgColor: series[0],
    taskBorderColor: series[0],
    taskTextLightColor: inkOn(series[0]),
    taskTextColor: t.foreground,
    taskTextOutsideColor: t.foreground,
    taskTextDarkColor: t.foreground,
    activeTaskBkgColor: t.muted,
    activeTaskBorderColor: series[0],
    doneTaskBkgColor: t.secondary,
    doneTaskBorderColor: t.ring,
    critBkgColor: CRITICAL,
    critBorderColor: CRITICAL,
    sectionBkgColor: t.muted,
    altSectionBkgColor: t.background,
    sectionBkgColor2: t.muted,
    gridColor: t.border,
    todayLineColor: CRITICAL,

    errorBkgColor: t.background,
    errorTextColor: t.destructive,
  };
}

/**
 * What `themeVariables` can't say.
 *
 * The app's corner radius, on every box that has one. And a gantt's grid: d3 draws its tick lines in
 * `currentColor` — the text colour — which no theme variable reaches, so without this they come out
 * as solid black rules across the chart.
 */
export function themeCSSFrom(t: ThemeTokens): string {
  return `
    .node rect, .node .label-container, rect.actor, .cluster rect, rect.note { rx: 6px; ry: 6px; }
    .grid .tick line { stroke: ${t.border}; }
    .grid .tick text { fill: ${t.mutedForeground}; }
  `;
}

/* One canvas pixel, reused: paint the page background, paint the token over it, read the result.
   That resolves any CSS colour to hex — `oklch()` included — and also settles a translucent token
   like the dark `--border` (white at 10%) against what it will actually be drawn on. */
let pixel: CanvasRenderingContext2D | null = null;

function resolve(color: string, over: string): string {
  if (!pixel) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    pixel = canvas.getContext('2d', { willReadFrequently: true });
  }
  if (!pixel) return over;
  pixel.clearRect(0, 0, 1, 1);
  pixel.fillStyle = over;
  pixel.fillRect(0, 0, 1, 1);
  pixel.fillStyle = color;
  pixel.fillRect(0, 0, 1, 1);
  const [r, g, b] = pixel.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** The tokens as the page is showing them right now — light or dark is whatever `.dark` on the root
    says at the moment of the call. */
export function readTokens(root: HTMLElement = document.documentElement): ThemeTokens {
  const styles = getComputedStyle(root);
  const raw = (key: keyof ThemeTokens) => styles.getPropertyValue(TOKEN_NAMES[key]).trim();
  const background = resolve(raw('background'), '#ffffff');
  return Object.fromEntries(
    (Object.keys(TOKEN_NAMES) as (keyof ThemeTokens)[]).map((key) => [
      key,
      key === 'background' ? background : resolve(raw(key), background),
    ]),
  ) as unknown as ThemeTokens;
}
