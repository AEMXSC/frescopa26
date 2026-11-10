# Fréscopa Roast Bar: headless ordering kiosk

A touch ordering kiosk (PWA) that uses the same `roast` structured content as `/our-roasts`. It doesn't use EDS page rendering, blocks, or site code. It only fetches JSON over HTTP.

**Open:** https://structured-content-example--frescopa26--aemxsc.aem.page/kiosk/index.html (after merge: `main--frescopa26--aemxsc.aem.live/kiosk/index.html`)

| Param | Effect |
|---|---|
| `?start=menu` | Skip the attract loop |
| `?tier=preview` | Show previewed (unpublished) content. The default is `live`. |
| `?poll=10` | Seconds between content syncs (default 15) |

Press **J**, or tap the status pill in the bottom corner, to show the JSON payload and the endpoint for the current screen.

## Data
- Which roasts exist: `sc-api…/live/aemxsc/frescopa26/query.json?q=schemaName:roast` (David Nuescheler's Structured Content API, experimental)
- Each roast's current data: `da-sc…/live/aemxsc/frescopa26/<path>`. A publish shows up here even before the index catches up.
- The kiosk polls these endpoints, compares the results with what's on screen, and highlights any roast that changed.

## Demo script (about 3 minutes)
1. The attract loop is running. Tap it, browse, open **Midnight Espresso**, pick a grind, and add it to the order.
2. Open the form editor side by side: `da.live/app/aemsites/sc-editor/form#/aemxsc/frescopa26/roasts/midnight-espresso`. Change the price, Save, then **Send → Preview & Publish**.
3. Within about 15 seconds the kiosk shows "Menu updated", the tile flashes, and the cart total changes. Nothing was redeployed.
4. Press **J** to show the JSON. The same payload works for an iOS app, signage or a POS system.
5. Check out, scan the QR with your phone (the hand-off to mobile), and the kiosk shows the order number.
6. Show `/our-roasts` on the website with the same change: one content source feeding every channel.

## Run it like a kiosk
- **iPad or Android tablet:** open the URL and choose Add to Home Screen. It opens full screen in portrait. Lock it with Guided Access (iPad) or screen pinning (Android).
- **Desktop or remote demo:** run `chrome --kiosk --app=<url>`, or share a normal browser window. The 1080×1920 screen scales to fit.
- **Offline:** the service worker caches the app and the last menu. Turn on airplane mode and the kiosk keeps working, showing "Offline · showing last menu".
