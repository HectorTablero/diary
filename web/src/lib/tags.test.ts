import type { TagDto } from '@diary/shared';
import { describe, expect, it } from 'vitest';
import { visibleTags } from './tags';

/* Tags are written as single letters: uppercase = matched by the active filter, lowercase = not.
   The three cases below are the spec, with MAX_VISIBLE_TAGS = 4. */

const tag = (name: string): TagDto => ({ id: name, name, color: '#4ECDC4' });
const tags = (names: string) => names.split('').map(tag);
const matched = (names: string) => names.split('');

/** Render the outcome back into the `A b C E (d)` notation the spec is written in. */
function render(all: string, filter: string[]): string {
  const { shown, hidden } = visibleTags(tags(all), filter);
  const shownIds = new Set(shown.map((t) => t.id));
  const rest = tags(all)
    .filter((t) => !shownIds.has(t.id))
    .map((t) => t.name);
  const visible = shown.map((t) => t.name).join(' ');
  return rest.length ? `${visible} (${rest.join(' ')})` : visible;
}

describe('visibleTags', () => {
  it('takes the first four when nothing is filtered', () => {
    expect(render('abcdef', [])).toBe('a b c d (e f)');
  });

  it('shows everything when there is room', () => {
    expect(render('abc', [])).toBe('a b c');
    expect(render('abc', matched('a'))).toBe('a b c');
  });

  it('promotes a matched tag out of the overflow, keeping the row in the person`s own order', () => {
    // A b C d (E)  ->  A b C E (d)
    expect(render('AbCdE', matched('ACE'))).toBe('A b C E (d)');
  });

  it('gives every slot to the matches when there are exactly enough', () => {
    // A b C d (E F)  ->  A C E F (b d)
    expect(render('AbCdEF', matched('ACEF'))).toBe('A C E F (b d)');
  });

  it('still overflows a match when the matches alone outnumber the slots', () => {
    // A b C d (E F G)  ->  A C E F, with G left in the overflow. Visibility is maximised, not
    // guaranteed — four slots cannot hold five matches.
    expect(render('AbCdEFG', matched('ACEFG'))).toBe('A C E F (b d G)');
  });

  it('never reorders the tags it shows', () => {
    const { shown } = visibleTags(tags('AbCdE'), matched('ACE'));
    const order = shown.map((t) => t.name);
    // A, b, C, E — the person's own sequence, not matches-first.
    expect(order).toEqual(['A', 'b', 'C', 'E']);
  });

  it('reports the overflow count', () => {
    expect(visibleTags(tags('AbCdEFG'), matched('ACEFG')).hidden).toBe(3);
    expect(visibleTags(tags('abcdef'), []).hidden).toBe(2);
    expect(visibleTags(tags('abc'), []).hidden).toBe(0);
  });
});
