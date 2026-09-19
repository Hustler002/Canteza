import { describe, expect, it } from 'vitest';
import { ROLES } from '@canteza/shared';
import {
  formatBlocks,
  hasPeopleFilters,
  parseBlocks,
  parsePeopleFilters,
} from '../src/lib/people-filters';

describe('parsePeopleFilters', () => {
  it('keeps the spaces a name needs', () => {
    // The whole reason this search uses .ilike() rather than an or=(...) expression.
    expect(parsePeopleFilters({ q: 'Riya Sharma' }).q).toBe('Riya Sharma');
  });

  it('drops wildcards, so a typed character means that character', () => {
    expect(parsePeopleFilters({ q: '%admin%' }).q).toBe('admin');
    expect(parsePeopleFilters({ q: 'a_b*c' }).q).toBe('abc');
  });

  it('caps the term', () => {
    expect(parsePeopleFilters({ q: 'a'.repeat(200) }).q).toHaveLength(60);
  });

  it('accepts only a real role', () => {
    for (const role of ROLES) {
      expect(parsePeopleFilters({ role }).role).toBe(role);
    }
    expect(parsePeopleFilters({ role: 'superuser' }).role).toBeNull();
    expect(parsePeopleFilters({ role: '' }).role).toBeNull();
  });

  it('reads the active filter as three states, not two', () => {
    expect(parsePeopleFilters({ active: 'yes' }).active).toBe(true);
    expect(parsePeopleFilters({ active: 'no' }).active).toBe(false);
    // Absent means "either", which is different from "suspended".
    expect(parsePeopleFilters({}).active).toBeNull();
    expect(parsePeopleFilters({ active: 'maybe' }).active).toBeNull();
  });

  it('knows when nothing is filtered', () => {
    expect(hasPeopleFilters(parsePeopleFilters({}))).toBe(false);
    expect(hasPeopleFilters(parsePeopleFilters({ active: 'no' }))).toBe(true);
    expect(hasPeopleFilters(parsePeopleFilters({ q: 'riya' }))).toBe(true);
  });
});

describe('parseBlocks', () => {
  it('turns what a person types into the array the column stores', () => {
    expect(parseBlocks('A, B, C')).toEqual(['A', 'B', 'C']);
  });

  it('survives the ways people actually type a list', () => {
    expect(parseBlocks('A,B,  C ')).toEqual(['A', 'B', 'C']);
    expect(parseBlocks('A, B,')).toEqual(['A', 'B']);
    expect(parseBlocks('  ')).toEqual([]);
    expect(parseBlocks('')).toEqual([]);
  });

  it('drops a repeat rather than storing a duplicate block', () => {
    expect(parseBlocks('A, B, A')).toEqual(['A', 'B']);
  });

  it('round-trips', () => {
    expect(parseBlocks(formatBlocks(['A', 'B', 'C']))).toEqual(['A', 'B', 'C']);
    expect(formatBlocks(parseBlocks('A,B'))).toBe('A, B');
  });
});
