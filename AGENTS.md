# Homepage preferences

- Never add tooltips to the index page (`index.html`, `/`, or `/index.html`). This applies to every homepage element and interaction state, including live, saved, loading, and offline prices.
- Do not use HTML `title` attributes, inline SVG `<title>` elements, or custom hover/focus tooltip popups on the homepage. The document's `<head><title>` remains the page title.
- Keep accessible names and descriptions through `aria-label`, `aria-labelledby`, `aria-describedby`, and appropriate screen-reader text.
- Preserve the 9984 graph's existing in-place price and relative-time readout when the user inspects its history.
- Do not link to the Graphs page anywhere in the site UI. The ship's ANTH and OA figures link to their corresponding MNX markets; BTC links to the Coinbase Exchange BTC/USD market that supplies its price.
