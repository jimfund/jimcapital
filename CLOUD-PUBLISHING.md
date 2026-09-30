# Publishing from One Word

In One Word's finished-post editor, the connected owner sees **prepare for jim.capital**. The current selected post is transferred server-to-server, then opened in `/editor/` using a single-use, 15-minute capability. First import pairs the authenticated jim.capital user with the explicitly configured One Word owner. Subsequent admin requests require that pinned site-scoped ID; being signed into ChatGPT alone is insufficient.

The private editor autosaves Markdown, SVG paths, per-viewport positions and widths, and deletions into D1. Publish copies the complete draft into a public snapshot and records its revision. Public article routes and SVG endpoints read only that snapshot. Draft changes and version restoration stay private until another publish. Reimporting an existing source post opens its existing draft without overwriting editorial work.

Published posts under `/prac/` are listed automatically at `/prac`. Legacy `/practicehaven/` URLs redirect permanently, including SVG links. The address migration preserves all draft and published content.

## Local development

Use Node 22.13 or later. `npm install`, then `npm run dev` serves the migrated site on port 8001. `python3 preview.py` remains the original static/layout preview on port 8000.

Generate schema migrations with `npm run db:generate`. Apply each new migration locally with `node node_modules/wrangler/bin/wrangler.js d1 execute DB --local --file=drizzle/<migration>.sql`. Sites applies packaged migrations during deployment.

Set `.dev.vars` locally (ignored): `PUBLISHING_SECRET`, `ONE_WORD_OWNER_ID=local_seedy`. Set the same secret in One Word, plus `JIM_CAPITAL_ORIGIN=http://127.0.0.1:8001`. The Sites Vite plugin supplies the simulated local identity after `/signin-with-chatgpt`.

## Hosting

`.openai/hosting.json` identifies this Site and its managed D1 binding. Production runtime settings are stored in Sites: a shared secret and the exact authorized One Word site-scoped user ID. One Word additionally stores the target editor origin. Never copy the local simulated identity into production.

`npm run build` preserves the existing homepage and tracked assets, adds the editor assets, and builds the Worker. `.dev.vars` may be emitted by the Cloudflare build; remove that generated file from `dist/server` before packaging. Do not upload local secret files. The Sites package helper includes migrations.

The initial 54 Post Ideas draft uses `cloud/seed.json` to preserve the manually separated drawings and placements. `python3 scripts/seed-article.py` refreshes this seed from the local article before its first cloud import. It never reads or packages the full One Word library. Later cloud edits are authoritative and are not overwritten by deployment.

DNS cutover requires replacing only the jim.capital website A records with the Sites-provided apex targets and adding the supplied validation records. Preserve mail records and the separate one-word subdomain. Keep the original GitHub Pages site available until the new custom domain is verified.
