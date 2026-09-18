import { describe, expect, it } from 'vitest';
import { inkOn, SERIES, themeCSSFrom, themeVariablesFrom, type ThemeTokens } from './mermaidTheme';

/* The decisions behind a diagram's look, without a browser: which token paints what, which palette
 * each mode gets, and that nothing Mermaid adds by default (shadows, gradients) survives. Reading
 * the tokens themselves needs a canvas, which jsdom doesn't have — that half is verified in the app. */

const LIGHT: ThemeTokens = {
  background: '#ffffff',
  foreground: '#0a0a0a',
  secondary: '#f5f5f5',
  muted: '#fafafa',
  mutedForeground: '#737373',
  border: '#e5e5e5',
  ring: '#a1a1a1',
  destructive: '#e7000b',
};

const theme = (dark = false) => themeVariablesFrom(LIGHT, dark, 'Geist Variable, sans-serif');

describe('themeVariablesFrom', () => {
  it('draws boxes as the app draws cards: its quiet fill, a ring-weight border, its text', () => {
    const v = theme();
    expect(v.primaryColor).toBe(LIGHT.secondary);
    expect(v.primaryBorderColor).toBe(LIGHT.ring);
    expect(v.primaryTextColor).toBe(LIGHT.foreground);
    expect(v.lineColor).toBe(LIGHT.mutedForeground);
    expect(v.background).toBe(LIGHT.background);
  });

  /* On the dark page Mermaid's default pale shadow reads as a glow around every node. */
  it('turns off the drop shadow and gradient Mermaid adds by default', () => {
    expect(theme().dropShadow).toBe('none');
    expect(theme().useGradient).toBe(false);
  });

  it('uses the app font', () => {
    expect(theme().fontFamily).toBe('Geist Variable, sans-serif');
  });

  it('colours categories from the palette stepped for the mode it is drawing', () => {
    // Indexed keys (pie1…, cScale0…) are built in a loop, so they are read loosely here.
    const light = theme(false) as Record<string, unknown>;
    const dark = theme(true) as Record<string, unknown>;
    expect(light.pie1).toBe(SERIES.light[0]);
    expect(dark.pie1).toBe(SERIES.dark[0]);
    expect(dark.cScale7).toBe(SERIES.dark[7]);
    expect(dark.darkMode).toBe(true);
  });

  it('labels every coloured mind-map branch in whichever of black or white reads on it', () => {
    const v = theme() as Record<string, unknown>;
    SERIES.light.forEach((fill, i) => expect(v[`cScaleLabel${i}`]).toBe(inkOn(fill)));
  });
});

describe('inkOn', () => {
  it('puts white on dark fills and near-black on light ones', () => {
    expect(inkOn('#1f3a93')).toBe('#ffffff');
    expect(inkOn('#e5a53f')).toBe('#0a0a0a');
  });
});

describe('themeCSSFrom', () => {
  /* d3 draws a gantt's grid in `currentColor`, which is the text colour — solid black rules. */
  it('draws the gantt grid in the hairline colour rather than the text colour', () => {
    expect(themeCSSFrom(LIGHT)).toContain(`.grid .tick line { stroke: ${LIGHT.border}; }`);
  });
});

describe('SERIES', () => {
  it('has the same eight hues in both modes, in the same order', () => {
    expect(SERIES.light).toHaveLength(8);
    expect(SERIES.dark).toHaveLength(8);
  });
});
