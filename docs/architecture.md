# Aclaria map — architecture

A static, mobile-first companion map for Aclaria RPG. Housing is the first
layer. Exploration and dungeon layers can be added later without inventing
placements or rewriting the renderer.

## Constraints

- Plain HTML, CSS and ES modules. No framework, bundler, server or runtime
  dependency; no analytics, cookies or third-party requests.
- The published map image (`assets/aclaria-map.jpg`, 4096 × 2983) stays
  byte-identical. `index.html` declares the same intrinsic dimensions.
- `data/housing.json` is the only input data. This site treats it as evidence:
  original market order, IDs, prices, capacities, location wording, sources,
  uncertainty and unplaced homes are preserved.
- Broad-region coordinates are approximate. Markers and dashed rings never
  claim an exact address, property boundary or house position.
- All URLs are relative so the site works at `/aclaria-map/` on GitHub Pages.

## Files

| Path | Owner | Purpose |
| --- | --- | --- |
| `index.html` | site (this task) | Static shell, controls, credits, no-JS fallback |
| `styles.css` | site | Mobile-first layout, map chrome, focus and reduced-motion styles |
| `app.js` | site | Data load, validation, renderers, interaction |
| `package.json` | site | `type: module`, test and local-serve scripts; no dependencies |
| `tests/site-*.test.mjs` | site | Node test-runner suites plus a dependency-free DOM stub |
| `docs/architecture.md` | site | This document |
| `.github/workflows/pages.yml` | site | Test, stage an allowlist, deploy to Pages |
| `data/housing.json` | data owner | Public housing data; not modified by the site task |
| `assets/aclaria-map.jpg` | data owner | Original map artwork; not modified by the site task |

Deployment (git commit, push, Pages enablement) is owned by the deployment
worker, not by the site implementation.

## Data contract

`data/housing.json` (schema `aclaria-map/2026-10-27`):

- `map`: `image`, `width`, `height`, official `source` URL.
- `layers`: `{ id, label, enabled }`. Only `enabled` layers are rendered; the
  current data enables `housing` only.
- `areas`: `{ id, number, name, x, y, radiusX, radiusY, precision, houseIds }`.
  `x`/`y` are the centre as fractions of image width/height. `radiusX` is a
  fraction of image width and `radiusY` a fraction of image height.
  `precision` is `approximate-city` for a labelled settlement icon or
  `approximate-region` for a landform/area label, so a region is never
  presented as an address.
- `houses`: `{ id, order, name, priceGold, companionCapacity, location,
  areaId, source }`. `order` is the original market order. `areaId: null`
  means the home is unplaced. `priceGold: 0` renders as "Free".
- `unplacedReason`: recorded reason keyed by the exact house id
  (`"lovely-cabin"`). The site shows the reason verbatim and never derives
  coordinates from the location wording.
- Public `source` values are canonical live wiki article URLs. Revision pins
  (`oldid`) belong in internal verification records only; a regression test
  fails if any shipped page or data URL carries one.

`validateSiteData()` checks ids, market order, prices, capacities, source URLs,
area references, ring bounds, unplaced reasons and renderer availability. The
page shows a short non-blocking notice if data fails a check; it does not add
placements or hide records.

## Coordinates and aspect ratio

The stage keeps the image aspect ratio from `map.width / map.height`
(≈ 1.3731). `containFit()` computes the largest aspect-correct box inside the
viewport, so the image is never stretched and letterboxing is centered.

- Marker centre: `left = x × 100%`, `top = y × 100%` of the stage.
- Ring box: `left = (x − radiusX) × 100%`, `top = (y − radiusY) × 100%`,
  `width = 2 × radiusX × 100%`, `height = 2 × radiusY × 100%`.
- Because width percent refers to image width and height percent to image
  height, the rendered ellipse matches the recorded image-space radii. The
  dashed ring is a visualisation of the recorded broad radius, nothing more.

Pan offsets are clamped in physical pixels: when the scaled map is smaller
than the viewport it is centered; otherwise it cannot leave a gap. Zoom is
clamped to 100–500%. Marker badges counter-scale with zoom so taps stay
44 × 44 px; rings and map scale normally.

## Rendering and layers

`app.js` keeps data and rendering separate:

1. `loadSiteData()` fetches `data/housing.json` relative to the module URL.
2. `validateSiteData()` reports inconsistencies.
3. State holds the data maps, search text, placement filter and selection.
4. `renderLayers()` walks enabled layers and calls the matching entry in
   `LAYER_RENDERERS`. Only `housing` has a renderer today.
5. DOM builders receive the `document` explicitly and use `createElement` /
   `textContent` only. Data strings are never interpolated into HTML; source
   links are only created for `http(s)` URLs. The test stub throws on
   `innerHTML`, which keeps that invariant enforced.

Adding a future layer (for example explorations or dungeons) means:

1. Add a separate public dataset with the same normalized-coordinate model and
   source/uncertainty fields.
2. Add fetch + validation for it, without weakening housing validation.
3. Add a renderer to `LAYER_RENDERERS`; render only when the dataset exists.
4. Enable the layer in the data owner's `layers` array and add tests for its
   filters, labels and coordinate behaviour.
5. Do not add markers, rings or UI controls for a layer whose dataset is not
   present. Disabled layers produce no UI.

## Interaction and state

- Search matches house name, catalogue location wording and approximate area
  name. Matching is case-insensitive, diacritic-tolerant and token-based
  (all tokens must match).
- Placement filters: all, on the map, not yet placed. Filtering never reorders;
  the list always follows the `order` field.
- Selecting a marker shows the approximate area, its recorded radius and its
  homes. Selecting a home highlights its area marker and ring.
- "Show area on map" centers the recorded area at ≥ 200% zoom. "Back to list"
  returns to the selected card and moves focus there.
- Pointer drag pans; two-pointer pinch zooms; double-tap toggles 100%/250%.
  Ctrl/⌘ + wheel zooms at the cursor. Buttons (`+`, `−`, `Reset view`) are
  44 px targets. Keyboard: arrows pan, `+`/`−` zoom, `0`/`Home` resets,
  `Escape` clears the selection. Focusing an off-screen marker pans it into
  view.
- On narrow screens the map is full-width above the details and list; selecting
  from the list scrolls the details into view. From 920 px the layout becomes a
  map + sidebar grid; from 1200 px the sidebar scrolls independently.

## Accessibility

- Numbered markers are `<button>` elements with names such as
  "Area 6: Zorathir. Approximate city or region; 2 homes listed.", and expose
  `aria-pressed` state.
- The map viewport is focusable, labelled, and described by keyboard
  instructions. Rings are decorative (`aria-hidden`).
- Search has a visible label, filters are a labelled group with `aria-pressed`,
  and result/selection changes are announced through a polite live region.
- Focus-visible outlines, reduced-motion handling, forced-colors handling and
  ≥ 44 px interactive targets are included. A skip link reaches the home list.
- Uncertainty is stated in visible text, marker labels, detail chips and the
  credits; unplaced homes appear in the list with a dashed card and reason.

## Tests

`npm test` runs Node's built-in test runner (Node 22+ expected) with no
dependencies:

- `tests/site-data.test.mjs`: schema/order/ID/reference validation, 26 homes,
  19 areas, 1 unplaced home, supported precision values, house-id-keyed
  unplaced reasons, canonical public wiki links (no `oldid`), verified label
  corrections, ring bounds, image-space radius shape, layer configuration,
  negative fixtures.
- `tests/site-view.test.mjs`: filtering and market order, search normalization,
  marker/ring percentage geometry, contain-fit/clamp math, safe URL handling,
  formatted values, safe text rendering of hostile strings, stable source
  links, accessible marker labels, layer chips, malformed records.
- `tests/site-shell.test.mjs`: local-only assets, relative URLs, no HTML
  injection APIs or runtime imports, credits match data, workflow allowlist and
  least-privilege Pages configuration, touch/keyboard/motion CSS affordances.
- `tests/site-dom-stub.mjs`: small DOM implementation whose `innerHTML` throws,
  proving the safe-rendering tests bite.

Manual browser checks (Chrome, local HTTP server): desktop 1280 × 900 and
mobile 375 × 812; marker selection, search, placement filters, details,
show/back navigation, double-tap, drag, pinch, keyboard pan/zoom/reset, and a
nested subpath load (`/…/aclaria-map/`).

## Deployment

`.github/workflows/pages.yml`:

- Triggers on pushes to `main` and `workflow_dispatch`; no `pull_request` or
  `pull_request_target`, so no fork secrets are exposed.
- `test` job: `actions/checkout@v7` with `persist-credentials: false`,
  `actions/setup-node@v7` (Node 22), `npm test`.
- `build` job: checks out, creates `_site/`, copies only
  `index.html`, `styles.css`, `app.js`, `data/housing.json` and
  `assets/aclaria-map.jpg`, verifies each file, then runs
  `actions/upload-pages-artifact@v5` with `path: _site`. Tests, docs, reports
  and `_temp/` are never uploaded; the static site needs no Pages metadata
  action because every URL is relative.
- `deploy` job: only `contents: read`, `pages: write`, `id-token: write`;
  `github-pages` environment; `actions/deploy-pages@v5`.
- `concurrency: { group: pages, cancel-in-progress: false }` keeps production
  deployments from cancelling each other.
- GitHub Actions Pages artifacts are served directly, so `.nojekyll` is not
  staged. The repository keeps an empty `.nojekyll` for any future
  branch-based publishing source.

To publish (deployment worker): in the public repository, open **Settings →
Pages → Build and deployment**, set **Source** to **GitHub Actions**, add a
`github-pages` environment protection rule for `main` if desired, then push to
`main` (or run the workflow manually). The first run creates the deployment;
the site URL is `/aclaria-map/` for a repository named `aclaria-map`.

Local preview: `npm run serve` (Python's static server) and open
`http://localhost:8080/`. Opening `index.html` via `file://` blocks the JSON
fetch by design; the page explains this.

## Known limits

- The original JPEG is ~6 MB; first load depends on the network. No derived
  image is generated because the artwork must stay unchanged.
- Placements are broad regions only. The site cannot answer "where exactly is
  this house?" and does not try.
- Tests validate logic and the static shell, not real-browser rendering; the
  browser checks above are manual until a browser test dependency is accepted.
- There is no offline cache, service worker, routing or account feature.
