# Structured content example: Fréscopa roasts

A working example of Experience Workspace structured content on frescopa26. Authors fill in a form, and the site reads the records as JSON.

| Piece | Where |
|---|---|
| JSON Schema `roast` | [roast.schema.json](roast.schema.json), stored in DA at `/.da/forms/schemas/roast.html` |
| Six sample records | [roasts/](roasts/), stored in DA under `/roasts/` |
| Detail view (record page) | [blocks/roast](../blocks/roast/). Reads the `roast` block that EW renders on each record. No fetch. |
| List view | [blocks/roast-list](../blocks/roast-list/). Fetches the [Structured Content API](https://www.aem.live/docs/ew/developing/structured-content-api) query index. |
| Editor bookkeeping | [blocks/da-form](../blocks/da-form/). Removes the `da-form` metadata block from rendered pages. |
| Seeder | [tools/structured-content/seed.mjs](../tools/structured-content/seed.mjs) |

## How it fits together

```
Author (SC form editor) ──save──▶ DA source /roasts/<slug>
                                  │ publish
                                  ▼
   /roasts/<slug>  ─── EDS page with <div class="roast"> ──▶ blocks/roast (detail)
   sc-api …/{preview|live}/aemxsc/frescopa26/query.json ──▶ blocks/roast-list (grid on /our-roasts)
```

`roast-list` reads the **preview** index on `*.aem.page` and localhost, and the **live** index on `*.aem.live`. Filtering by `roastLevel` happens server-side (`q=roastLevel:Light`). Filtering by schema and `featured` happens client-side.

## Setup (one time)

1. **Get an IMS token.** It lasts about an hour.
   ```
   npx github:adobe-rnd/da-auth-helper token
   ```
2. **Seed the content.** This writes the schema, records, and landing page, publishes them, and builds both query indexes.
   ```
   node tools/structured-content/seed.mjs --dry-run   # check the plan first
   node tools/structured-content/seed.mjs
   ```
3. **Map the folder to the form editor.** This needs an org admin. In `https://da.live/config#/aemxsc/`, add this row:

   | key | value |
   |---|---|
   | `editor.path` | `/aemxsc/frescopa26/roasts=https://da.live/app/aemsites/sc-editor/form#` |

   Keep the trailing `#`. Add the row through the config UI. Writing a config file does not register it.

## Authoring

- Edit the schema: `https://da.live/app/aemsites/sc-editor/schemas#/aemxsc/frescopa26`
- Edit a record: open `/roasts/morning-ritual` in DA, or go to `https://da.live/app/aemsites/sc-editor/form#/aemxsc/frescopa26/roasts/morning-ritual`
- **Images:** the editor has no asset picker yet, so **Image URL** is a plain https URL. Upload the image to the site's DA `/media` folder, preview and publish it, then paste its `https://main--frescopa26--aemxsc.aem.live/media/...` URL. The blocks render site media as responsive pictures, and any other https URL as a plain image.
- Click **Save**, then **Send → Preview & Publish**. Publishing reindexes the record, so it shows up in `roast-list`.

## Try the API

```
curl "https://sc-api.adobeaem.workers.dev/preview/aemxsc/frescopa26/query.json?q=roastLevel:Light"
curl "https://sc-api.adobeaem.workers.dev/live/aemxsc/frescopa26/roasts/morning-ritual.json"
curl "https://da-sc.adobeaem.workers.dev/live/aemxsc/frescopa26/roasts/morning-ritual"
```

You can also use the explorer: https://sc-api.adobeaem.workers.dev/explorer/

## Caveats

- If you change the schema, existing records are not migrated. Deleting a schema stops its records from opening.
- Record pages take `<title>` from the `da-form` heading. For SEO titles, add a Metadata block or a bulk `/metadata` sheet.
- Adobe says the API hosts may change. The host lives in one constant, `SC_API`, in `roast-list.js`.

## Channel Preview (author experience)

Opening a roast in DA opens **Channel Preview** ([tools/kiosk-studio](../tools/kiosk-studio/)). It shows the form on the left and a live channel preview on the right: the kiosk (https://frescopa-kiosk.vercel.app), the website, or a phone, each in its own device frame.

- Edit in the form, then click the form's **Send**. Within about 4 seconds the channel refreshes by itself, and the record is reindexed so new roasts appear in the kiosk menu straight away.
- Use **Preview / Published** to compare the draft with what's live.
- Channels come from the `previews` sheet in the site config (`https://da.live/config#/aemxsc/frescopa26/`), with one row per channel: `schema | label | url | device`. URL tokens are `{tier}`, `{tld}` (page|live), `{path}`, `{slug}`, `{org}` and `{site}`. Devices are `kiosk`, `desktop` and `phone`. If the sheet is missing, the app falls back to built-in defaults.
- `editor.path` in the org config maps `/aemxsc/frescopa26/roasts` to `https://da.live/app/aemxsc/frescopa26/tools/kiosk-studio/kiosk-studio#`.
