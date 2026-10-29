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
- Home marker positions come from the developer's annotated housing map, with
  the annotation's own uncertainty. Named areas stay approximate context in
  search, the list and the details panel; they are not drawn as a second
  marker layer.
  Neither ever claims an in-game coordinate, address or property boundary.
  Close markers are never displaced to make tapping easier: the list and
  details panel carry selection, and zoom separates the points.
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

`data/housing.json` (schema `aclaria-map/2026-10-28`):

- `map`: `image`, `width`, `height`, official `source` URL.
- `coordinateSource`: the one declared origin of every home position —
  `kind: "developer-annotation"`, `label`, `published`, `uncertaintyX`,
  `uncertaintyY` plus human-readable notes. Every anchor's uncertainty must
  equal the declared pair, so the layer carries a single honest precision
  (half a badge width on the annotation).
- `layers`: `{ id, label, enabled }`. Only `enabled` layers are rendered; the
  current data enables `housing` only.
- `areas`: `{ id, number, name, x, y, radiusX, radiusY, precision, houseIds }`.
  Twenty named areas kept as context for the catalogue wording — never a
  substitute for a home marker and never drawn on the map. `x`/`y` are the
  centre as fractions of image width/height. `radiusX` is a fraction of image
  width and `radiusY` a fraction of image height, recorded as the area's
  approximate extent. `precision` is `approximate-city` for a labelled
  settlement icon or `approximate-region` for a landform/area label, so a
  region is never presented as an address. `number` identifies the area in the
  data and in the details chip; it is not a map marker number.
- `houses`: `{ id, order, name, priceGold, companionCapacity, location,
  anchor, areaId, source }`. `order` is the original market order;
  `priceGold: 0` renders as "Free"; `location` is the catalogue wording,
  verbatim.
- `anchor`: `{ markerNumber, x, y, uncertaintyX, uncertaintyY, precision,
  provenance, textAgreement, placeNote?, discrepancy? }`. `x`/`y` are finite
  normalized fractions of the image. `markerNumber` is the annotation's badge
  number (unique per dataset; in this data it equals the catalogue order).
  `precision` is `developer-annotation`. `provenance` records where the
  coordinates come from and `textAgreement`
  (`agrees` | `developer-corrected` | `differs`) records how the annotated
  position relates to the catalogue wording: two separate facts that are never
  merged into one confidence label. Anything other than `agrees` requires a
  `discrepancy` note, which the details panel renders verbatim alongside the
  catalogue quote.
- `unplacedReason`: recorded reason keyed by the exact house id. The map is
  empty today, because every home has an anchor, and it stays in the contract
  for future layers and for any home whose wording cannot be placed. The site
  shows a reason verbatim and never derives coordinates from the wording.
- Public `source` values are canonical live wiki article URLs. Revision pins
  (`oldid`) belong in internal verification records only; a regression test
  fails if any shipped page or data URL carries one.

`validateSiteData()` checks ids, market order, prices, capacities, source URLs,
area references, anchor bounds and finiteness, unique marker numbers, the
declared-uncertainty match, supported anchor precision, discrepancy notes for
non-agreeing rows, area extent bounds, unplaced reasons and renderer
availability. The page shows a short non-blocking notice if data fails a check;
it does not add placements, repair coordinates or hide records.

## Coordinates and aspect ratio

The stage keeps the image aspect ratio from `map.width / map.height`
(≈ 1.3731). `containFit()` computes the largest aspect-correct box inside the
viewport, so the image is never stretched and letterboxing is centered.

- Home marker centre: the same conversion from `anchor.x` / `anchor.y`, so a
  marker sits exactly on its annotated point and no position is displaced.
- Marker centre: `left = x × 100%`, `top = y × 100%` of the stage.
- Areas are not drawn, so `radiusX` / `radiusY` never produce a ring: they stay
  in the data as the recorded approximate extent and are validated against the
  image bounds.

Pan offsets are clamped in physical pixels: when the scaled map is smaller
than the viewport it is centered; otherwise it cannot leave a gap. Zoom is
clamped to 100–500 %. The stage grows by resizing (`stage.style.width/height`
= base × zoom) and only translates; it is never `scale()`-transformed. Marker
boxes therefore do not inherit map zoom, and no inverse scale is applied: every
marker keeps its 44 × 44 px touch target and 27 px badge at every zoom level,
while the map content underneath scales.

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

The housing renderer draws one tier into the shared `#area-layer` container:
`renderHouseMarkers()` adds one solid numbered button per catalogue home at its
anchor, labelled "Marker 18: Wood Cabin; developer-annotated position; Area 14:
Thornmere Thicket river area (approximate region context); text/map discrepancy
recorded — see details."

- Only the 26 developer annotations are numbered. Named areas add no buttons,
  no rings and no numbers, so the catalogue's area numbering cannot compete
  with the house numbers on the map.
- A home with no anchor yet falls back to its catalogue area centre with a
  hollow `~` badge, the class `house-marker--approximate` and an "Approximate
  position … not an individual annotation" accessible name. That fallback is
  visual and textual, never a second numbering.

Positions come straight from the data. The renderer never merges, clusters or
nudges points apart, and `createMapController()` ignores pan/double-click
gestures that start on the marker tier (`MARKER_SELECTOR`).

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
- Selecting a home — from its marker or from the list — opens its details and
  highlights that marker and card. Other homes listed for the same approximate
  area get the quieter "related" card state, so the area stays list context.
- The details panel keeps the house name, price, capacity, the quoted location
  (labelled `Location`) and the marker/back actions above a `Placement notes`
  footnote. The marker-provenance sentence and the annotation-vs-catalogue
  comparison live in that native disclosure for every home.
- "Show marker on map" centers the home's anchor at ≥ 200% zoom (clamped at the
  map edges, as pan always is). "Back to list" returns to the selected card and
  moves focus there.
- A home with a wording/map difference announces it on selection and shows the
  recorded note in its details panel. Its placement-notes footnote opens by
  itself, so a recorded divergence is never hidden behind another tap.
- Pointer drag pans; two-pointer pinch zooms; double-tap toggles 100%/250%.
  Ctrl/⌘ + wheel zooms at the cursor. Buttons (`+`, `−`, `Reset view`) are
  44 px targets. Keyboard: arrows pan, `+`/`−` zoom, `0`/`Home` resets,
  `Escape` clears the selection. Focusing an off-screen marker pans it into
  view.
- On narrow screens the map is full-width above the details and list; selecting
  from the list scrolls the details into view. From 920 px the layout becomes a
  map + sidebar grid; from 1200 px the sidebar scrolls independently.

## Accessibility

- Marker buttons expose `aria-pressed` state. Home buttons read "Marker 18:
  Wood Cabin; developer-annotated position; Area 14: Thornmere Thicket river
  area (approximate region context); text/map discrepancy recorded — see
  details." A fallback button reads "Approximate position for <home>: Area N:
  <name> (approximate city from the catalogue wording, not an individual
  annotation)."
- The map viewport is focusable, labelled, and described by keyboard
  instructions that name the numbered home discs as its only buttons.
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
  20 named areas, 26 developer anchors with unique marker numbers in market
  order, finite normalized anchor bounds, the declared annotation uncertainty,
  the Wood Cabin 18 and Padfax House 21 wording/map records, the Hut 11
  developer correction, Thaldris vs Thalvaris, the retired-but-kept unplaced
  reason rule, supported precision values, canonical public wiki links (no
  `oldid`), verified label corrections, area extent bounds, image-space radius
  shape, layer configuration, negative fixtures.
- `tests/site-view.test.mjs`: filtering and market order, anchor-first
  placement filters, search normalization, anchor percentage geometry, exact
  close-marker coordinates, the single-tier housing layer (26 numbered house
  markers, no area markers and no rings in the rendered layer), the unnumbered
  approximate fallback marker, anchor-aware cards and details text,
  discrepancy notes, contain-fit/clamp math, safe URL handling, formatted
  values, safe text rendering of hostile strings, stable source links,
  accessible marker labels, layer chips, malformed records.
- `tests/site-shell.test.mjs`: local-only assets, relative URLs, no HTML
  injection APIs or runtime imports, credits match data, workflow allowlist and
  least-privilege Pages configuration, touch/keyboard/motion CSS affordances.
- `tests/site-dom-stub.mjs`: small DOM implementation whose `innerHTML` throws,
  proving the safe-rendering tests bite.

Manual browser checks (headless Chromium, local HTTP server serving the site
under `/aclaria-map/`, 2026-10-28): desktop 1280 × 900 and emulated mobile
375 × 812 — exactly 26 house markers and **no** area markers or rings in the
marker container, every marker centre within 1.2 px of its anchor position on
the stage at both widths, no horizontal overflow, list selection and marker
selection, "Show marker on map" centring the anchor at 200 % (0.2 px on a
mid-map home; a home at the map edge stops at the pan clamp instead of
overshooting), search and filter behaviour, keyboard pan/zoom/reset and Escape,
live-region announcements, and the narrow-screen details scroll. At 100 % zoom
on a 375 px-wide viewport 52 pairs of 44 px tap targets overlap (close
annotations); re-measured 2026-10-29 with constant-size markers the count falls
to 36, 26 and 7 pairs at 125 %, 156 % and 500 % (desktop 15 → 1) as the map
spreads out beneath them. That overlap at 100 % is expected and is why the list
and details panel carry selection instead of displaced coordinates.

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
- Home markers are hand-placed developer annotations and areas stay broad:
  the site cannot answer "where exactly is this house?" and does not try.
- Two homes (Wood Cabin 18, Padfax House 21) record a wording/map difference
  and keep both records. Resolving either needs the developer's word, not a
  guess, so no coordinate is derived from the wording.
- No travel route, travel time or distance scale is derived anywhere in the
  site or its data.
- Tests validate logic and the static shell, not real-browser rendering; the
  browser checks above are manual until a browser test dependency is accepted.
- There is no offline cache, service worker, routing or account feature.

Zoom perspective: a smoothstep pitch increases from 0 degrees at fit to 8 degrees at 300% zoom, capped above that. Reduced-motion users retain the flat view. Phone motion remains opt-in and adds at most its existing bounded tilt. Perspective distance scales with stage height to limit distortion; marker badges counter-rotate. No terrain elevation is inferred.

Visible copy stays brief: home cards show area names without repeated provenance labels; prices, capacity and original location text remain primary. Position source, uncertainty and detailed comparisons are retained in Placement notes. Global sources are collapsed below the list.
