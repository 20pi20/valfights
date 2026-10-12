import raw from '../data/fights.json';

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

export const source = raw.source as 'notion' | 'sample';
export const generatedAt = raw.generatedAt as string;

// Newest fight first; undated fights last.
export const fights: Fight[] = [...(raw.fights as Fight[])].sort((a, b) =>
  (b.fightDate ?? '').localeCompare(a.fightDate ?? ''),
);

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

function buildFighters(): Fighter[] {
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

export const fighters: Fighter[] = buildFighters();

const fighterSlugs = new Map(fighters.map((f) => [f.name, f.slug]));
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
