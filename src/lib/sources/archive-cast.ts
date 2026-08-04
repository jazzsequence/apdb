/**
 * Casts written into an Internet Archive item's own description.
 *
 * The archive adapter has never read this. It pulls art and grouping
 * metadata and stops there, so every credit-less archive-sourced show has
 * been missing a source that was sitting in the same API response the whole
 * time. Two shapes cover what has been seen so far:
 *
 *   Presented by Canon Fodder Podcasts
 *   Starring Kyle, Jenn, Lindsey, and Travis
 *
 *   Your players are:
 *   @dregadude (drega) - DM
 *   @jeesideslug (jee) - Jerndell, Dwarf Barbarian
 *
 * The second names a character; the first is a bare list and yields players
 * with no character. Both are the production's own words, so anything found
 * here is `official` tier.
 */
import type { CreditRole } from '../schema.js';
import { realCharacter } from '../credits.js';

export interface ArchiveCredit {
  name: string;
  role: CreditRole;
  character?: string;
}

const GM_LABEL = /^(the\s+)?(dm|gm|dungeon\s?master|game\s?master|keeper|storyteller|marshal|judge|referee|narrator)$/i;

function looksLikeName(v: string): boolean {
  const t = v.trim();
  if (!t || t.length > 40) return false;
  if (/[@|]|https?:/i.test(t)) return false;
  return t.split(/\s+/).length <= 4;
}

/**
 * "@handle (nick) - Character, Race Class" or "@handle (nick) - DM", one per
 * line, following a "players are" / "cast" introduction.
 */
function handleListBlock(text: string): ArchiveCredit[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const start = lines.findIndex((l) => /\b(players?|cast)\s+(are|:)/i.test(l) || /^(cast|players?)\s*:?\s*$/i.test(l));
  if (start < 0) return [];

  const out: ArchiveCredit[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line) continue;
    if (line.length > 140) break;
    // "@handle (nick) - rest" or "@handle - rest"
    const m = line.match(/^@?([\w.-]{2,30})\s*(?:\(([^)]+)\))?\s*[-–—:]\s*(.+)$/);
    if (!m) continue;
    const handle = m[1]!;
    const rest = m[3]!.trim();
    if (GM_LABEL.test(rest)) {
      out.push({ name: handle, role: 'GM/DM' });
      continue;
    }
    // "Character, Race Class" -> keep the character, drop the class/species.
    const character = realCharacter(rest.split(',')[0]?.trim());
    out.push({ name: handle, role: 'player', ...(character ? { character } : {}) });
  }
  return out.length > 1 ? out : [];
}

/** "Starring Kyle, Jenn, Lindsey, and Travis" — a bare list, no characters. */
function starringLine(text: string): ArchiveCredit[] {
  const m = text.match(/\bstarring\s+([^.\n]{4,200})/i);
  if (!m) return [];
  const names = m[1]!
    .replace(/\band\b/gi, ',')
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean);
  const credits = names.filter(looksLikeName).map((name) => ({ name, role: 'player' as CreditRole }));
  return credits.length > 1 ? credits : [];
}

export function castFromArchiveDescription(description: string): ArchiveCredit[] {
  const handles = handleListBlock(description);
  if (handles.length > 1) return handles;
  return starringLine(description);
}
