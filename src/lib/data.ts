import { NOTION_DATABASE_ID, NOTION_TOKEN } from 'astro:env/server';
import { fetchFights, normalise } from './notion.mjs';
import { sampleRecords } from './sample-data.mjs';

export interface Fight {
  id: string;
  slug: string;
  title: string;
  fightDate: string | null;
  year: number | null;
  fighters: string[];
  link: string | null;
  youtubeId: string | null;
  youtubeStart: number;
  method: string | null;
  notes: string | null;
  rating: number | null;
  round: number | string | null;
  titleFight: boolean;
  watchedDate: string | null;
  weightClass: string | null;
  winner: string | null;
  notionUrl: string | null;
}

export type Outcome = 'W' | 'L' | 'D' | 'NC';

export interface Fighter {
  name: string;
  slug: string;
  fights: Fight[];
  wins: number;
  losses: number;
  draws: number;
  stoppageWins: number;
  avgRating: number | null;
  weightClasses: string[];
}

// Live snapshot of the database, replaced by refresh(). Importers always see the latest copy.
export let source: 'notion' | 'sample' = 'sample';
export let generatedAt = '';
// Newest fight first; undated fights last.
export let fights: Fight[] = [];
export let fighters: Fighter[] = [];
let fighterSlugs = new Map<string, string>();

// Notion is re-read on a page load once the snapshot is older than this.
const MAX_AGE_MS = 30_000;
let loadedAt = 0;
let pending: Promise<void> | null = null;

/** Called by src/middleware.ts before every page render. */
export function refresh(): Promise<void> | void {
  if (loadedAt && Date.now() - loadedAt < MAX_AGE_MS) return;
  return (pending ??= load().finally(() => (pending = null)));
}

async function load() {
  const live = Boolean(NOTION_TOKEN && NOTION_DATABASE_ID);
  let rows: Fight[];
  try {
    rows = (live ? await fetchFights(NOTION_TOKEN!, NOTION_DATABASE_ID!) : normalise(sampleRecords)) as Fight[];
  } catch (err) {
    // Notion is down or rate-limiting: keep serving the last good snapshot if there is one.
    if (!loadedAt) throw err;
    console.warn(`[notion] ${(err as Error).message}\n[notion] Serving the previously loaded fights.`);
    loadedAt = Date.now();
    return;
  }
  fights = rows.sort((a, b) => (b.fightDate ?? '').localeCompare(a.fightDate ?? ''));
  fighters = buildFighters(fights);
  fighterSlugs = new Map(fighters.map((f) => [f.name, f.slug]));
  source = live ? 'notion' : 'sample';
  generatedAt = new Date().toISOString();
  loadedAt = Date.now();
}

export function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const norm = (s: string) => slugify(s).replace(/-/g, ' ');

function sameFighter(winner: string, name: string): boolean {
  const w = norm(winner);
  const n = norm(name);
  if (!w || !n) return false;
  // "Ali" as winner should still match the fighter "Muhammad Ali".
  return w === n || ` ${n} `.includes(` ${w} `) || ` ${w} `.includes(` ${n} `);
}

/** The fighter in this fight that the Winner column refers to, if any. */
export function winnerOf(fight: Fight): string | null {
  if (!fight.winner) return null;
  return fight.fighters.find((name) => sameFighter(fight.winner!, name)) ?? null;
}

export function outcomeFor(fight: Fight, name: string): Outcome | null {
  if (!fight.winner) return null;
  if (/\bno[ -]?contest\b|\bnc\b|\bno[ -]?decision\b/i.test(fight.winner)) return 'NC';
  if (/\bdraw\b/i.test(fight.winner)) return 'D';
  const winner = winnerOf(fight);
  if (!winner) return null;
  return winner === name ? 'W' : 'L';
}

export const isStoppage = (method: string | null) => !!method && /\b(t?ko|rtd|stoppage|retire[ds]?|corner)\b/i.test(method);

export function average(values: (number | null)[]): number | null {
  const nums = values.filter((v): v is number => v != null);
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}

export function countBy<T>(items: T[], keyOf: (item: T) => string | number | null | undefined) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const k = keyOf(item);
    if (k == null || k === '') continue;
    counts.set(String(k), (counts.get(String(k)) ?? 0) + 1);
  }
  return [...counts].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

function buildFighters(fights: Fight[]): Fighter[] {
  const byName = new Map<string, Fight[]>();
  for (const fight of fights) {
    for (const name of fight.fighters) byName.set(name, [...(byName.get(name) ?? []), fight]);
  }
  const used = new Set<string>();
  return [...byName]
    .map(([name, list]) => {
      const base = slugify(name) || 'fighter';
      let slug = base;
      for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`;
      used.add(slug);
      const outcomes = list.map((f) => outcomeFor(f, name));
      return {
        name,
        slug,
        fights: list,
        wins: outcomes.filter((o) => o === 'W').length,
        losses: outcomes.filter((o) => o === 'L').length,
        draws: outcomes.filter((o) => o === 'D').length,
        stoppageWins: list.filter((f, i) => outcomes[i] === 'W' && isStoppage(f.method)).length,
        avgRating: average(list.map((f) => f.rating)),
        weightClasses: countBy(list, (f) => f.weightClass).map((c) => c.label),
      };
    })
    .sort((a, b) => b.fights.length - a.fights.length || a.name.localeCompare(b.name));
}

export const fighterUrl = (name: string) => `/fighters/${fighterSlugs.get(name) ?? slugify(name)}/`;
export const fightUrl = (fight: Fight) => `/fights/${fight.slug}/`;

/** Notion dates are plain calendar days, so format them in UTC to avoid off-by-one shifts. */
export function formatDate(iso: string | null, options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }) {
  if (!iso) return null;
  const date = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('en-US', { ...options, timeZone: 'UTC' });
}

/** "Ali vs Frazier III" → ["Ali", "Frazier III"], for the stacked poster headline. */
export function splitTitle(title: string): [string, string] | null {
  const parts = title.split(/\s+(?:vs\.?|v\.?|versus)\s+/i);
  return parts.length === 2 ? [parts[0], parts[1]] : null;
}

export function resultLine(fight: Fight): string | null {
  const round = fight.round != null ? (typeof fight.round === 'number' ? `R${fight.round}` : fight.round) : null;
  return [fight.method, round].filter(Boolean).join(' · ') || null;
}
