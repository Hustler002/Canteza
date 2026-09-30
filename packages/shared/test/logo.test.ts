import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LOGO, logoCapCentres, logoSvg, logoWeights } from '../src/logo';

/**
 * The mark's geometry, and the files drawn from it. The SVGs and the web page's boot
 * splash are committed copies of `logoSvg()`, so a change to the mark that forgets
 * `npm run brand:assets` fails here instead of shipping two different logos.
 */

const repo = (path: string) =>
  readFileSync(fileURLToPath(new URL(`../../../${path}`, import.meta.url)), 'utf8');

describe('the geometry', () => {
  it('puts both ends of the plate on the ring, either side of the opening', () => {
    const { upper, lower } = logoCapCentres();
    for (const [x, y] of [upper, lower]) {
      expect(Math.hypot(x - LOGO.ring.cx, y - LOGO.ring.cy)).toBeCloseTo(LOGO.ring.radius, 6);
    }
    expect(upper[0]).toBeCloseTo(lower[0], 6);
    expect(upper[1]).toBeLessThan(LOGO.ring.cy);
    expect(lower[1]).toBeGreaterThan(LOGO.ring.cy);
  });

  it('keeps the room inside the opening, clear of the plate', () => {
    const gap = Math.hypot(
      LOGO.dot.cx - logoCapCentres().upper[0],
      LOGO.dot.cy - logoCapCentres().upper[1],
    );
    expect(gap).toBeGreaterThan(LOGO.ring.stroke / 2 + LOGO.dot.r);
  });

  it('thickens the stroke and dot at 32 px and below, and only there', () => {
    expect(logoWeights(1024)).toEqual({ stroke: LOGO.ring.stroke, dotR: LOGO.dot.r });
    expect(logoWeights(33).stroke).toBe(LOGO.ring.stroke);
    expect(logoWeights(32).stroke).toBeCloseTo(LOGO.ring.stroke * LOGO.smallBoost);
    expect(logoWeights(16).dotR).toBeCloseTo(LOGO.dot.r * LOGO.smallBoost);
  });
});

describe('logoSvg', () => {
  it('draws the tile only when asked, rounded unless told square', () => {
    expect(logoSvg({ glyph: '#fff' })).not.toContain('<rect');
    expect(logoSvg({ glyph: '#fff', tile: '#000' })).toContain(`rx="${LOGO.tileRadius}"`);
    expect(logoSvg({ glyph: '#fff', tile: '#000', shape: 'square' })).not.toContain('rx=');
  });

  it('scales the glyph about the centre for adaptive icons', () => {
    expect(logoSvg({ glyph: '#fff', glyphScale: 0.5 })).toContain(
      'translate(512 512) scale(0.5) translate(-512 -512)',
    );
  });
});

describe('the committed files match the mark', () => {
  const favicon = logoSvg({ glyph: LOGO.colors.white, tile: LOGO.colors.saffron, renderSize: 32 });

  it('student web favicon.svg', () => {
    expect(repo('apps/mobile/public/favicon.svg').trim()).toBe(favicon);
  });

  it('admin icon.svg', () => {
    expect(repo('apps/admin/src/app/icon.svg').trim()).toBe(favicon);
  });

  it("the web page's boot splash", () => {
    const html = repo('apps/mobile/public/index.html').replace(/\s+/g, ' ');
    const full = logoSvg({ glyph: LOGO.colors.white, tile: LOGO.colors.saffron });
    const path = /d="([^"]+)"/.exec(full)![1]!;
    const circle = /<circle cx="([^"]+)" cy="([^"]+)" r="([^"]+)"/.exec(full)!;
    expect(html).toContain(`d="${path}"`);
    expect(html).toContain(`<circle cx="${circle[1]}" cy="${circle[2]}" r="${circle[3]}"`);
    expect(html).toContain(`stroke-width="${LOGO.ring.stroke}"`);
    expect(html).toContain(`rx="${LOGO.tileRadius}"`);
  });
});
