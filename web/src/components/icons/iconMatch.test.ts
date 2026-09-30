import { describe, expect, it } from 'vitest';
import { matchIcons, queryWords } from './iconMatch';

const names = ['bus', 'bus-front', 'house', 'piggy-bank', 'receipt', 'train-front'];
const tags = {
  bus: ['coach', 'vehicle', 'transport'],
  'bus-front': ['coach', 'vehicle'],
  house: ['home', 'living'],
  'piggy-bank': ['money', 'savings'],
  'train-front': ['railway', 'transport', 'metro'],
};

describe('matchIcons', () => {
  it('returns everything, in catalog order, for an empty search', () => {
    expect(matchIcons(names, tags, '  ')).toEqual(names);
  });

  it('puts an icon called what was typed before one merely tagged with it', () => {
    expect(matchIcons(names, tags, 'bus')).toEqual(['bus', 'bus-front']);
    expect(matchIcons(names, tags, 'transport')).toEqual(['bus', 'train-front']);
  });

  it('finds icons by their tags', () => {
    expect(matchIcons(names, tags, 'savings')).toEqual(['piggy-bank']);
    expect(matchIcons(names, tags, 'Home')).toEqual(['house']);
  });

  it('requires every word to match, so more words narrow the list', () => {
    expect(matchIcons(names, tags, 'front coach')).toEqual(['bus-front']);
    expect(matchIcons(names, tags, 'bus railway')).toEqual([]);
  });

  it('matches word prefixes, then anywhere', () => {
    expect(matchIcons(names, tags, 'rec')).toEqual(['receipt']);
    expect(matchIcons(names, tags, 'ggy')).toEqual(['piggy-bank']);
  });

  it('works without tags at all, by name', () => {
    expect(matchIcons(names, {}, 'front')).toEqual(['bus-front', 'train-front']);
  });

  it('ignores inherited keys in the tag map', () => {
    expect(matchIcons(['constructor'], {}, 'constructor')).toEqual(['constructor']);
  });
});

describe('queryWords', () => {
  it('splits on spaces and hyphens, lowercased', () => {
    expect(queryWords(' Piggy-Bank  savings ')).toEqual(['piggy', 'bank', 'savings']);
  });
});
