# Fight Log

A static Astro site built from a Notion boxing database. On every build the database is read once and written to `src/data/fights.json`; the pages are generated from that file.

- `/` — filterable, sortable fight list
- `/fights/<slug>/` — one page per fight with the YouTube video embedded
- `/timeline/` — every fight as a dot on a left-to-right timeline, stacked by year
- `/fighters/` and `/fighters/<slug>/` — generated from the **Fighters** column
- `/stats/` — dashboard

## Run it locally

You need **Node 22.12 or newer** (`node -v`).

### 1. Install

```sh
npm install
```

### 2. Connect Notion

1. Go to <https://www.notion.so/profile/integrations>, create an **internal integration**, and copy its secret.
2. Open the boxing database in Notion → `•••` (top right) → **Connections** → add the integration. Without this step Notion returns a 404.
3. Copy the database ID: open the database as a full page and take the 32-character string from the URL
   (`notion.so/<workspace>/`**`0123456789abcdef0123456789abcdef`**`?v=…`). Pasting the whole URL also works.
4. Create your `.env`:

   ```sh
   cp .env.example .env
   ```

   ```ini
   NOTION_TOKEN=ntn_xxxxxxxxxxxxxxxxxxxxxxxx
   NOTION_DATABASE_ID=0123456789abcdef0123456789abcdef
   ```

`.env` is gitignored.

### 3. Start the dev server

```sh
npm run dev
```

Open <http://localhost:4321>. This fetches Notion first, then starts Astro with live reload for code changes.

To pull fresh Notion data while the dev server is running, run `npm run fetch` in a second terminal.

### Preview the production build

```sh
npm run build     # fetch Notion, then build to dist/
npm run preview   # serve dist/ at http://localhost:4321
```

### No credentials yet?

`npm run dev` still works: it writes 12 sample fights and shows a yellow "sample data" bar. Once `.env` is filled in, delete `src/data/fights.json` or just run `npm run fetch` to replace them.

| Situation | What `npm run fetch` does |
| --- | --- |
| Credentials set | Fetches Notion and overwrites `src/data/fights.json` |
| No credentials, local | Keeps the existing file, or writes sample data if there is none |
| Notion unreachable, local | Warns and keeps the previously fetched file |
| No credentials or any Notion error on Netlify | Fails the build, so a broken deploy never replaces a good one |

## Deploy to Netlify

1. Push this folder to a Git repository and import it in Netlify. Build settings come from `netlify.toml` (`npm run build`, publish `dist`, Node 22).
2. In **Site configuration → Environment variables** add:
   - `NOTION_TOKEN`
   - `NOTION_DATABASE_ID`
3. Deploy.

The site only changes when it is rebuilt. After editing Notion, trigger a deploy (**Deploys → Trigger deploy**), or create a **build hook** (Site configuration → Build & deploy → Build hooks) and call that URL from a bookmark or a scheduled job.

## Notion columns

Column names are matched case-insensitively. A missing column is left blank and listed in the build log.

| Column | Notion type | Notes |
| --- | --- | --- |
| Fight | Title | `A vs B` is split into the stacked poster headline |
| Fight Date | Date | |
| Fighters | Multi-select | One fighter page per option. If empty, names are taken from the Fight title |
| Link | URL | `youtube.com/watch`, `youtu.be`, `/shorts`, `/live`, `/embed`; a `t=` start time is kept. Other links get a button instead of an embed |
| Method | Select or text | Methods containing KO, TKO, RTD, "stoppage", "retired" or "corner" count as stoppages in the stats |
| Notes | Text | Line breaks are kept |
| Rating | Select | 0–3 gloves. Reads a digit (`2`, `2 gloves`) or counts 🥊 emoji. **A fight with an empty Rating is left off the site entirely** |
| Round | Number, select or text | |
| Title Fight | Checkbox | |
| Watched Date | Date | Empty = not watched yet |
| Weight Class | Select | |
| Winner | Select or text | Matched against Fighters to build records (a surname is enough). `Draw` and `No contest` are recognised |
| Year | Number, formula or select | Falls back to the year of Fight Date |

## Project layout

```
scripts/fetch-notion.mjs   Notion → src/data/fights.json
scripts/sample-data.mjs    placeholder fights used when there are no credentials
src/data/fights.json       generated, gitignored
src/lib/data.ts            loads the JSON; derives fighters, records and helpers
src/config.ts              site title and tagline
src/styles/global.css      colours, type and shared styles
src/components/            FightCard, Gloves, BarList, Columns
src/pages/                 index, fights/[slug], fighters/, stats, 404
netlify.toml               Netlify build settings
```

## Troubleshooting

- **`Notion API 404`** — wrong database ID, or the database is not shared with the integration (step 2 above).
- **`Notion API 401`** — the token is wrong or was regenerated.
- **A fight is missing from the site** — its Rating is empty. Fights without a rating are skipped; the build log says how many.
- **A fight has no video** — the Link is empty or is not a YouTube URL. Some YouTube uploads also block embedding; the "Watch on YouTube" button still works.
- **A fighter's record looks off** — records only count fights in this database, and need the Winner value to match a name in Fighters.
