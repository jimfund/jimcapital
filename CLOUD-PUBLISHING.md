# Publishing from One Word

In One Word's finished-post editor, the connected owner sees **prepare for jim.capital**. The current selected post is transferred server-to-server, then opened in `/editor/` using a single-use, 15-minute capability. First import pairs the authenticated jim.capital user with the explicitly configured One Word owner. Subsequent admin requests require that pinned site-scoped ID; being signed into ChatGPT alone is insufficient.

The private editor autosaves Markdown, SVG paths, per-viewport positions and widths, and deletions into D1. Publish copies the complete draft into a public snapshot and records its revision. Public article routes and SVG endpoints read only that snapshot. Draft changes and version restoration stay private until another publish. Reimporting an existing source post opens its existing draft without overwriting editorial work.

Published posts under `/prac/` are listed automatically at `/prac`. Legacy `/practicehaven/` URLs redirect permanently, including SVG links. The address migration preserves all draft and published content.

## Local development

Use Node 22.13 or later. `npm install`, then `npm run dev` serves the migrated site on port 8001. `python3 preview.py` remains the original static/layout preview on port 8000.

Generate schema migrations with `npm run db:generate`. Apply each new migration locally with `node node_modules/wrangler/bin/wrangler.js d1 execute DB --local --file=drizzle/<migration>.sql`. Sites applies packaged migrations during deployment.

Set `.dev.vars` locally (ignored): `PUBLISHING_SECRET`, `ONE_WORD_OWNER_ID=local_seedy`. Set the same secret in One Word, plus `JIM_CAPITAL_ORIGIN=http://127.0.0.1:8001`. The Sites Vite plugin supplies the simulated local identity after `/signin-with-chatgpt`.

## Market prices and history

The homepage embeds a snapshot of D1's saved quotes and SoftBank history in its HTML, so both TVs display saved data immediately while `/api/markets/quotes` and the history endpoint refresh it. D1 shares the upstream quote cache between visitors: XYZ refreshes at most every 5 seconds and MNX/Coinbase every 30 seconds while requested. Expired cached responses return immediately and refresh through the Worker's `waitUntil`; cold API requests still fetch their initial data. Browsers pause polling when hidden. Missing, invalid or older quote responses retain the last good value. The TVs keep steady opacity; the airship labels saved prices in its existing status text. The homepage has no tooltips. A database or provider failure does not prevent the homepage HTML from being served.

The build renames the compiled homepage to `dist/client/site-home.html`. Sites gives static assets priority, so `/` and `/index.html` must have no matching static file; the Worker serves that template with the D1 snapshot. The development server retains its normal source entry point.

Market displays must never dim, lose their glow, or change colour because data is refreshing, stale, or offline. Keep their designed appearance and last good values; use existing status text and accessible descriptions to communicate freshness. Never add tooltips to the index page, including native `title` popups and custom hover/focus bubbles. Preserve intentionally chosen artwork transparency, such as the softer red 9984 graph, and its in-place price/time inspection readout. These homepage preferences are recorded in `AGENTS.md`.

The ANTH/OA/BTC ticker is the transparent airship in the upper-right part of the board. Its three live HTML links are projected onto the photographed billboard by `airship.js`; the image itself contains no baked-in prices. The screen uses cyan values, amber labels and a subtle scanline texture. The artwork, built-in imagegen editing prompt, and source are recorded in `AIRSHIP-ASSET.md`.

The ship uses the approved Marquee lighting study at its default pace and intensity: a nine-second current across the hull and seven-second circuit around the orange frame. `airship-marquee.js` animates the artwork's luminous pixels using WebGL; the live HTML quotes remain steady above it. It pauses while the tab is hidden, caps drawing at 30 fps, follows reduced-motion preferences, and keeps the original artwork visible if graphics support fails. This decorative animation is independent of data freshness. The local study controls and other lighting variants are not part of the homepage.

Full history is at `/graphs`, also linked from the homepage prices. Links can preserve the market and period, such as `/graphs?symbol=BTC&range=1w`; a bare `/graphs` defaults to SoftBank over 24 hours. The page reads `/api/markets/history?symbol=BTC&range=1w`. Supported symbols are `SP500`, `SOFTBANK`, `ANTHROPIC`, `OPENAI`, and `BTC`; ranges are `1d`, `1w`, `1m`, and `1y`. The chart uses 5-minute, hourly, hourly, and daily candles respectively. Cache refresh intervals are 1, 5, and 30 minutes; candles are retained for 3, 40, and 400 days per interval. Wider views backfill missing periods; refreshes overlap the two latest candles. MNX only supports trailing windows, so its backfills can include previously saved periods. Persistent leases and a short failure backoff prevent duplicate upstream refreshes.

The homepage's 9984 TV contains a SoftBank 24-hour chart drawn from the same history endpoint. Its ink is green for a rise from the first available point to the last, red for a fall, and grey for no change. Pointer movement, touch, and arrow keys inspect the nearest candle, showing its estimated yen value and relative age (for example, “5 mins ago”). The resting change-percentage label is omitted. The normal readout resumes on leaving the chart and shows the latest mark price. Saved history draws synchronously from the page snapshot and stays visible through empty, malformed or failed refreshes. Refreshing adds no loading overlay or extra fading; recovery retries every five seconds while history is stale or missing, and on reconnection. The original TV and 9984 artwork are retained, with the chart and header positioned inside the screen by `assets/layout.json`.

History comes from provider candles on demand; no scheduled automation or separate Cloudflare account is required. No requests run when the site is unused. The available dates are shown explicitly when a provider has less history than the selected range. MNX charts use valuation mark prices, Coinbase uses BTC/USD spot closes, and XYZ charts use perpetual trade closes. The SoftBank chart estimates yen by multiplying matching SoftBank and USD/JPY closes; the live XYZ readouts use marks. Missing candles are not interpolated. Coinbase requires the identifying `User-Agent` header set by the Worker.

Local market endpoints require migration `0002_groovy_masked_marvel.sql`. Market API, caching, failure, and chart interaction checks run with `npm test`; existing publishing checks also cover the shared D1 database.

## Hosting

`.openai/hosting.json` identifies this Site and its managed D1 binding. Production runtime settings are stored in Sites: a shared secret and the exact authorized One Word site-scoped user ID. One Word additionally stores the target editor origin. Never copy the local simulated identity into production.

`npm run build` preserves the existing homepage and tracked assets, adds the editor assets, and builds the Worker. `.dev.vars` may be emitted by the Cloudflare build; remove that generated file from `dist/server` before packaging. Do not upload local secret files. The Sites package helper includes migrations.

The initial 54 Post Ideas draft uses `cloud/seed.json` to preserve the manually separated drawings and placements. `python3 scripts/seed-article.py` refreshes this seed from the local article before its first cloud import. It never reads or packages the full One Word library. Publication dates use the first saved publication from version history, displayed in America/Los_Angeles time. Updating or republishing a post preserves its original date. Later cloud edits are authoritative and are not overwritten by deployment.

DNS cutover requires replacing only the jim.capital website A records with the Sites-provided apex targets and adding the supplied validation records. Preserve mail records and the separate one-word subdomain. Keep the original GitHub Pages site available until the new custom domain is verified.
