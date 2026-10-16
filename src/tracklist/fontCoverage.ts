/**
 * Which characters the bundled fonts can draw, read from the fonts' own character maps (cmap)
 * rather than from rendered pixels — so a system font quietly filling in for a missing glyph
 * can never make a Display Name look fine in the browser and then show up as □ elsewhere.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { FONTS_DIR, FONT_FILES } from "./template.js";

let covered: Set<number> | undefined;

/** The characters of `text` that neither Inter nor Noto Sans JP has a glyph for, each once, in order. */
export function charactersFontsCannotDraw(text: string): string[] {
  covered ??= new Set([FONT_FILES.inter, FONT_FILES.notoSansJp].flatMap((file) => [...readCodePoints(path.join(FONTS_DIR, file))]));
  const missing = new Set<string>();
  for (const char of text) {
    if (!needsGlyph(char) || covered.has(char.codePointAt(0)!)) continue;
    missing.add(char);
  }
  return [...missing];
}

/** `"봄" (U+BD04)` — the code point helps when the character itself is invisible or hard to tell apart. */
export function describeCharacter(char: string): string {
  return `"${char}" (U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")})`;
}

/**
 * Characters that never need a glyph of their own: the whitespace the template collapses into
 * ordinary spaces (`white-space: nowrap`), and Unicode's default-ignorable characters — zero-width
 * joiners and spaces, variation selectors and the like — which draw nothing by design (the
 * characters around them are still checked). Everything else, other whitespace included
 * (no-break and ideographic spaces are in the fonts), must have a glyph.
 */
function needsGlyph(char: string): boolean {
  return !COLLAPSED_WHITESPACE.has(char) && !DEFAULT_IGNORABLE.test(char);
}

const COLLAPSED_WHITESPACE = new Set(["\t", "\n", "\f", "\r"]);
const DEFAULT_IGNORABLE = /^\p{Default_Ignorable_Code_Point}$/u;

/** Every code point mapped to a real glyph in an OpenType/TrueType font's Unicode cmap (format 12, else format 4). */
function readCodePoints(file: string): Set<number> {
  const font = readFileSync(file);
  const cmap = findTable(font, "cmap");
  if (cmap === undefined) throw new Error(`${file} has no cmap table.`);

  const subtables = new Map<string, number>();
  const count = font.readUInt16BE(cmap + 2);
  for (let i = 0; i < count; i++) {
    const record = cmap + 4 + i * 8;
    const offset = cmap + font.readUInt32BE(record + 4);
    subtables.set(`${font.readUInt16BE(record)}/${font.readUInt16BE(record + 2)}/${font.readUInt16BE(offset)}`, offset);
  }
  const full = subtables.get("3/10/12") ?? subtables.get("0/4/12");
  if (full !== undefined) return readFormat12(font, full);
  const bmp = subtables.get("3/1/4") ?? subtables.get("0/3/4");
  if (bmp !== undefined) return readFormat4(font, bmp);
  throw new Error(`${file} has no Unicode cmap subtable this tool can read.`);
}

function findTable(font: Buffer, tag: string): number | undefined {
  const tables = font.readUInt16BE(4);
  for (let i = 0; i < tables; i++) {
    const record = 12 + i * 16;
    if (font.toString("latin1", record, record + 4) === tag) return font.readUInt32BE(record + 8);
  }
  return undefined;
}

function readFormat12(font: Buffer, at: number): Set<number> {
  const codePoints = new Set<number>();
  const groups = font.readUInt32BE(at + 12);
  for (let i = 0; i < groups; i++) {
    const group = at + 16 + i * 12;
    const start = font.readUInt32BE(group);
    const end = font.readUInt32BE(group + 4);
    const firstGlyph = font.readUInt32BE(group + 8);
    for (let c = start; c <= end; c++) if (firstGlyph + (c - start) !== 0) codePoints.add(c);
  }
  return codePoints;
}

function readFormat4(font: Buffer, at: number): Set<number> {
  const codePoints = new Set<number>();
  const segments = font.readUInt16BE(at + 6) / 2;
  const ends = at + 14;
  const starts = ends + segments * 2 + 2;
  const deltas = starts + segments * 2;
  const rangeOffsets = deltas + segments * 2;
  for (let s = 0; s < segments; s++) {
    const end = font.readUInt16BE(ends + s * 2);
    const start = font.readUInt16BE(starts + s * 2);
    const delta = font.readUInt16BE(deltas + s * 2);
    const rangeOffsetAt = rangeOffsets + s * 2;
    const rangeOffset = font.readUInt16BE(rangeOffsetAt);
    for (let c = start; c <= end && c !== 0xffff; c++) {
      let glyph: number;
      if (rangeOffset === 0) {
        glyph = (c + delta) & 0xffff;
      } else {
        const raw = font.readUInt16BE(rangeOffsetAt + rangeOffset + (c - start) * 2);
        glyph = raw === 0 ? 0 : (raw + delta) & 0xffff;
      }
      if (glyph !== 0) codePoints.add(c);
    }
  }
  return codePoints;
}
