# Fight Log

An Astro site rendered live from a Notion boxing database. Pages are rendered on request, so an edit in Notion shows up on the next page load (within about 30 seconds) with no redeploy.

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

Open <http://localhost:4321>. Notion is read when a page is requested, so reloading the page picks up database edits. Restart the dev server after changing `.env`.

### No credentials yet?

`npm run dev` still works: it shows 12 sample fights and a yellow "sample data" bar until `.env` is filled in.

| Situation | What happens |
| --- | --- |
| Credentials set | Notion is read on page load; the result is reused for 30 seconds |
| No credentials | Sample fights with the yellow bar (locally and on Netlify) |
| Notion unreachable or rate-limiting | The last successfully loaded fights keep being served; if there are none yet, the page returns an error |

## Deploy to Netlify

1. Push this folder to a Git repository and import it in Netlify. Build settings come from `netlify.toml` (`npm run build`, publish `dist`, Node 22). The `@astrojs/netlify` adapter turns the pages into a Netlify Function.
2. In **Site configuration → Environment variables** add:
   - `NOTION_TOKEN`
   - `NOTION_DATABASE_ID`

   Leave their scope on the default (all scopes): they are read by the function at runtime, not during the build.
3. Deploy.

You only redeploy for code changes. Notion edits appear on their own; the 30-second reuse window is `MAX_AGE_MS` in `src/lib/data.ts`.

## Notion columns

Column names are matched case-insensitively. A missing column is left blank and listed in the function log.

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
src/middleware.ts          refreshes the Notion data before each page render
src/lib/notion.mjs         Notion API → fight records
src/lib/sample-data.mjs    placeholder fights used when there are no credentials
src/lib/data.ts            holds the current snapshot; derives fighters, records and helpers
src/config.ts              site title and tagline
src/styles/global.css      colours, type and shared styles
src/components/            FightCard, Gloves, BarList, Columns
src/pages/                 index, fights/[slug], fighters/, stats, 404
astro.config.mjs           on-demand rendering, Netlify adapter, env variables
netlify.toml               Netlify build settings
```

## Troubleshooting

- **An edit in Notion isn't showing** — reload again after 30 seconds. If it still isn't there, check the function log (Netlify → Logs → Functions) for a Notion error.
- **`Notion API 404`** — wrong database ID, or the database is not shared with the integration (step 2 above).
- **`Notion API 401`** — the token is wrong or was regenerated.
- **A fight is missing from the site** — its Rating is empty. Fights without a rating are skipped; the function log says how many.
- **A fight has no video** — the Link is empty or is not a YouTube URL. Some YouTube uploads also block embedding; the "Watch on YouTube" button still works.
- **A fighter's record looks off** — records only count fights in this database, and need the Winner value to match a name in Fighters.
