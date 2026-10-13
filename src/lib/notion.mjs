// Reads the Notion boxing database and turns its rows into plain fight records.
// Called at request time by src/lib/data.ts.

const API = 'https://api.notion.com/v1';
const CURRENT = '2025-09-03'; // databases contain one or more data sources
const LEGACY = '2022-06-28'; // databases are queried directly

/* ---------- Notion API ---------- */

function parseId(value) {
  if (!value) return null;
  // Accept a bare ID, a dashed UUID, or a full Notion URL (ignore the ?v= view ID).
  const path = value.trim().split('?')[0].replace(/-/g, '');
  const match = path.match(/[0-9a-f]{32}/gi);
  return match ? match[match.length - 1] : value.trim();
}

class NotionError extends Error {
  constructor(status, body) {
    super(`Notion API ${status}: ${body?.message ?? 'request failed'}`);
    this.status = status;
    this.code = body?.code;
  }
}

async function notion(token, path, { method = 'GET', body, version = CURRENT } = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': version,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      const wait = Number(res.headers.get('retry-after')) || 2 ** attempt;
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new NotionError(res.status, json);
    return json;
  }
}

async function queryAll(token, path, version) {
  const pages = [];
  let cursor;
  do {
    const res = await notion(token, path, {
      method: 'POST',
      version,
      body: { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) },
    });
    pages.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return pages;
}

async function fetchPages(token, databaseId) {
  let database;
  try {
    database = await notion(token, `/databases/${databaseId}`);
  } catch (err) {
    if (err.status !== 404) throw err;
    // The ID may already be a data source ID rather than a database ID.
    try {
      return await queryAll(token, `/data_sources/${databaseId}/query`, CURRENT);
    } catch {
      throw err;
    }
  }
  const sources = database.data_sources ?? [];
  if (sources.length === 0) return queryAll(token, `/databases/${databaseId}/query`, LEGACY);
  const pages = [];
  for (const source of sources) pages.push(...(await queryAll(token, `/data_sources/${source.id}/query`, CURRENT)));
  return pages;
}

/* ---------- Notion property → plain value ---------- */

function plain(prop) {
  if (!prop) return null;
  const v = prop[prop.type];
  switch (prop.type) {
    case 'title':
    case 'rich_text':
      return v.map((t) => t.plain_text).join('');
    case 'select':
    case 'status':
      return v?.name ?? null;
    case 'multi_select':
      return v.map((o) => o.name);
    case 'date':
      return v?.start ?? null;
    case 'formula':
      return v?.type === 'date' ? (v.date?.start ?? null) : (v?.[v.type] ?? null);
    case 'rollup':
      return v?.type === 'array' ? v.array.map(plain) : v?.type === 'date' ? (v.date?.start ?? null) : (v?.[v.type] ?? null);
    case 'people':
      return v.map((p) => p.name).filter(Boolean);
    case 'files':
      return v[0]?.file?.url ?? v[0]?.external?.url ?? null;
    case 'unique_id':
      return v ? `${v.prefix ? v.prefix + '-' : ''}${v.number}` : null;
    default:
      // number, checkbox, url, email, phone_number, created_time, last_edited_time
      return v ?? null;
  }
}

const text = (v) => (Array.isArray(v) ? v.filter((x) => x != null && x !== '').join(', ') : v == null ? '' : String(v)).trim();
const list = (v) => (Array.isArray(v) ? v : text(v).split(/\s*[,;]\s*/)).map((s) => String(s).trim()).filter(Boolean);
const day = (v) => text(v).slice(0, 10) || null;

const EXPECTED = ['Fight', 'Fight Date', 'Fighters', 'Link', 'Method', 'Notes', 'Rating', 'Round', 'Title Fight', 'Watched Date', 'Weight Class', 'Winner', 'Year'];
const key = (name) => name.toLowerCase().replace(/\s+/g, ' ').trim();

function toRecord(page) {
  const props = {};
  for (const [name, prop] of Object.entries(page.properties)) props[key(name)] = plain(prop);
  const get = (name) => props[key(name)];
  // Fall back to whichever property is the title, in case "Fight" was renamed.
  const titleProp = Object.values(page.properties).find((p) => p.type === 'title');
  return {
    id: page.id,
    notionUrl: page.url,
    title: text(get('Fight')) || text(plain(titleProp)),
    fightDate: get('Fight Date'),
    fighters: get('Fighters'),
    link: get('Link'),
    method: get('Method'),
    notes: get('Notes'),
    rating: get('Rating'),
    round: get('Round'),
    titleFight: get('Title Fight'),
    watchedDate: get('Watched Date'),
    weightClass: get('Weight Class'),
    winner: get('Winner'),
    year: get('Year'),
  };
}

/* ---------- Normalisation (shared by Notion rows and sample rows) ---------- */

export function slugify(value) {
  return String(value)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Rating is a single select of 0–3 gloves: accepts "🥊🥊", "2", "2 gloves", "2/3".
export function parseRating(value) {
  const s = text(value);
  if (!s) return null;
  const digit = s.match(/\d/);
  if (digit) return Math.min(Number(digit[0]), 3);
  const gloves = s.match(/🥊/g);
  if (gloves) return Math.min(gloves.length, 3);
  return /^(none|zero|no gloves?)$/i.test(s) ? 0 : null;
}

export function parseYouTube(url) {
  if (!url) return null;
  let u;
  try {
    u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^(www|m|music)\./, '');
  let id = null;
  if (host === 'youtu.be') id = u.pathname.split('/')[1];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts[0] === 'watch') id = u.searchParams.get('v');
    else if (['embed', 'shorts', 'live', 'v'].includes(parts[0])) id = parts[1];
  }
  if (!id || !/^[\w-]{11}$/.test(id)) return null;
  // t=1h2m3s, t=90, start=90
  const t = u.searchParams.get('t') ?? u.searchParams.get('start') ?? '';
  const hms = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/);
  const start = hms ? Number(hms[1] ?? 0) * 3600 + Number(hms[2] ?? 0) * 60 + Number(hms[3] ?? 0) : 0;
  return { id, start };
}

function fightersFromTitle(title) {
  const parts = title.split(/\s+(?:vs\.?|v\.?|versus)\s+/i);
  if (parts.length !== 2) return [];
  // "Frazier III" / "Wilder 2" → drop the instalment number
  return parts.map((p) => p.replace(/\s+(?:[IVX]+|\d+)$/, '').trim()).filter(Boolean);
}

// Fights with an empty Rating column are left off the site entirely.
const hasRating = (r) => text(r.rating) !== '';

export function normalise(records) {
  const used = new Set();
  return records
    .filter(hasRating)
    .map((r) => {
      const title = text(r.title);
      const fightDate = day(r.fightDate);
      const year = Number(text(r.year).match(/\d{4}/)?.[0]) || (fightDate ? Number(fightDate.slice(0, 4)) : null);
      let fighters = [...new Set(list(r.fighters))];
      if (fighters.length === 0) fighters = fightersFromTitle(title);
      const link = text(r.link) || null;
      const youtube = parseYouTube(link);
      const roundText = text(r.round);
      const roundNumber = Number(roundText.match(/\d+/)?.[0]);

      const base = slugify([title || fighters.join(' vs '), year].filter(Boolean).join(' ')) || 'fight';
      let slug = base;
      for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`;
      used.add(slug);

      return {
        id: r.id ?? slug,
        slug,
        title: title || fighters.join(' vs ') || 'Untitled fight',
        fightDate,
        year,
        fighters,
        link,
        youtubeId: youtube?.id ?? null,
        youtubeStart: youtube?.start ?? 0,
        method: text(r.method) || null,
        notes: text(r.notes) || null,
        rating: parseRating(r.rating),
        round: roundText ? (Number.isFinite(roundNumber) && roundNumber > 0 ? roundNumber : roundText) : null,
        titleFight: r.titleFight === true,
        watchedDate: day(r.watchedDate),
        weightClass: text(r.weightClass) || null,
        winner: text(r.winner) || null,
        notionUrl: r.notionUrl ?? null,
      };
    })
    .filter((f) => f.title !== 'Untitled fight' || f.fighters.length > 0);
}

/* ---------- Main ---------- */

export async function fetchFights(token, databaseId) {
  let pages;
  try {
    pages = await fetchPages(token.trim(), parseId(databaseId));
  } catch (err) {
    if (err.status === 404) err.message += '\n         Check NOTION_DATABASE_ID, and that the database is shared with your integration (••• → Connections).';
    if (err.status === 401) err.message += '\n         Check NOTION_TOKEN.';
    throw err;
  }

  if (pages[0]) {
    const present = new Set(Object.keys(pages[0].properties).map(key));
    const absent = EXPECTED.filter((name) => !present.has(key(name)));
    if (absent.length) console.warn(`[notion] Columns not found (left blank): ${absent.join(', ')}`);
  }

  const records = pages.filter((p) => p.object === 'page' && !p.archived && !p.in_trash).map(toRecord);
  const fights = normalise(records);
  const hidden = records.filter((r) => !hasRating(r)).length;
  console.log(`[notion] Loaded ${fights.length} fights${hidden ? ` (${hidden} with an empty Rating hidden)` : ''}`);
  return fights;
}
