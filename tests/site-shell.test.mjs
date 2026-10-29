import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { mapAspectRatio, createMapController } from '../app.js';
import { createDocument } from './site-dom-stub.mjs';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

const html = await read('index.html');
const css = await read('styles.css');
const app = await read('app.js');
const workflow = await read('.github/workflows/pages.yml');
const packageJson = JSON.parse(await read('package.json'));
const data = JSON.parse(await read('data/housing.json'));

function attr(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}="([^"]*)"`, 'i'));
  return match ? match[1] : null;
}

test('the page loads only local assets and one module script', () => {
  const scripts = [...html.matchAll(/<script\b[^>]*>/gi)].map((match) => match[0]);
  assert.equal(scripts.length, 1);
  assert.equal(attr(scripts[0], 'src'), './app.js');
  assert.equal(attr(scripts[0], 'type'), 'module');

  const stylesheets = [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/gi)].map((match) => match[0]);
  assert.equal(stylesheets.length, 1);
  assert.equal(attr(stylesheets[0], 'href'), './styles.css');

  assert.doesNotMatch(html, /<script[^>]+src="https?:/i);
  assert.doesNotMatch(html, /google-analytics|googletagmanager|plausible|matomo|umami|segment\.io/i);
});

test('the map image path and dimensions match the published data', () => {
  const image = html.match(/<img\b[^>]*id="map-image"[^>]*>/i)?.[0];
  assert.ok(image, 'map image element exists');
  assert.equal(attr(image, 'src'), `./${data.map.image}`);
  assert.equal(Number(attr(image, 'width')), data.map.width);
  assert.equal(Number(attr(image, 'height')), data.map.height);
  assert.ok(mapAspectRatio(data.map) > 1);
  assert.doesNotMatch(attr(image, 'alt'), /\b\d{3,4}\s*[×x]\s*\d{3,4}\b/);
});

test('credits link the official map and catalogue from the data', () => {
  const houseSources = new Set(data.houses.map((house) => house.source));
  assert.equal(houseSources.size, 1);
  assert.ok(html.includes(data.map.source));
  for (const source of houseSources) assert.ok(html.includes(source));
  assert.match(html, /<noscript>/);
});

test('all asset URLs are relative so the site works under /aclaria-map/', () => {
  assert.doesNotMatch(html, /\b(?:src|href)="\/(?!\/)/i);
  assert.doesNotMatch(css, /url\(\s*['"]?\/(?!\/)/i);
  assert.doesNotMatch(css, /url\(\s*['"]?https?:/i);
  assert.doesNotMatch(css, /@import/i);
  assert.doesNotMatch(app, /fetch\(\s*['"]\//);
  assert.match(app, /new URL\('\.\/data\/housing\.json', import\.meta\.url\)/);
});

test('rendering never injects data as HTML', () => {
  assert.doesNotMatch(app, /\.innerHTML\b/);
  assert.doesNotMatch(app, /\.outerHTML\b/);
  assert.doesNotMatch(app, /insertAdjacentHTML|document\.write/);
  assert.doesNotMatch(app, /\beval\(|new Function\(/);
});

test('the app has no runtime imports or third-party endpoints', () => {
  assert.doesNotMatch(app, /^\s*import\s.*from\s/m);
  assert.equal([...app.matchAll(/\bfetch\(/g)].length, 1);
  assert.doesNotMatch(app, /https?:\/\//);
  assert.equal(packageJson.dependencies, undefined);
  assert.equal(packageJson.devDependencies, undefined);
  assert.equal(packageJson.type, 'module');
  assert.equal(
    packageJson.scripts.test,
    'node --test tests/site-data.test.mjs tests/site-view.test.mjs tests/site-shell.test.mjs tests/immersion.test.mjs',
  );
});

test('the Pages workflow publishes only the allowlisted site files', () => {
  assert.doesNotMatch(workflow, /^\s*pull_request(_target)?:/m, 'no pull_request or pull_request_target trigger');
  assert.doesNotMatch(workflow, /\$\{\{\s*secrets\./);
  assert.doesNotMatch(workflow, /path:\s*['"]?\.['"]?\s*$/m);
  assert.doesNotMatch(workflow, /cp\s+-r|rsync|upload entire repository/i);
  for (const file of ['index.html', 'styles.css', 'app.js', 'immersion.js', 'data/housing.json', 'assets/aclaria-map.jpg']) {
    assert.ok(workflow.includes(file), `${file} is staged`);
  }
  assert.match(workflow, /path:\s*_site/);
});

test('the workflow follows least-privilege Pages deployment requirements', () => {
  assert.match(workflow, /^permissions:\n  contents: read$/m);
  assert.match(workflow, /pages: write/);
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /environment:\n\s+name: github-pages\n\s+url: \$\{\{ steps\.deployment\.outputs\.page_url \}\}/);
  assert.match(workflow, /concurrency:\n\s+group: pages\n\s+cancel-in-progress: false/);
  assert.match(workflow, /branches: \[main\]/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /actions\/checkout@v7/);
  assert.match(workflow, /actions\/setup-node@v7/);
  assert.match(workflow, /actions\/upload-pages-artifact@v5/);
  assert.match(workflow, /actions\/deploy-pages@v5/);
  assert.match(workflow, /needs: test/);
  assert.match(workflow, /needs: build/);
  assert.match(workflow, /persist-credentials: false/);
});

test('touch, keyboard and reduced-motion affordances are styled', () => {
  assert.match(css, /touch-action:\s*none/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /forced-colors/);
});

test('the static shell carries the search, filter and no-JavaScript affordances', () => {
  assert.match(html, /id="search-input"/);
  assert.match(html, /data-placement="all"/);
  assert.match(html, /data-placement="placed"/);
  assert.match(html, /data-placement="unplaced"/);
  assert.match(html, /id="map-viewport"[\s\S]{0,200}tabindex="0"/);
  assert.match(html, /aria-roledescription="interactive map"/);
  assert.match(html, /id="app-status" role="status" aria-live="polite"/);
});

test('concise map copy retains provenance and placement limits', () => {
  assert.ok(html.includes('Positions follow the developer’s map.'));
  assert.ok(html.includes('not property boundaries'));
  assert.ok(html.includes('Developer’s housing map (28 October 2026)'));
  assert.ok(html.includes('Data revision <span id="data-updated">2026-10-28</span>'));
  assert.ok(html.includes('<summary id="credits-heading">Sources and map notes</summary>'));
  assert.equal(html.includes('catalogue wording'), false);
});

test('home markers keep their hit target and no area tier is styled', () => {
  assert.ok(css.includes('.house-marker {'), 'home markers are styled');
  assert.ok(css.includes('.house-marker__badge {'));
  assert.ok(css.includes('.house-marker--approximate'), 'the fallback marker is styled as approximate');
  assert.equal(css.includes('.marker--area'), false, 'no area marker tier is styled');
  assert.equal(css.includes('.area-ring'), false, 'no area ring is styled');
  assert.ok(css.includes('.details__note--discrepancy'), 'discrepancy notes are styled for visibility');
  assert.ok(css.includes('min-height: 44px'));
});

test('house markers keep a constant 44 px target instead of inverse-scaling', () => {
  const rule = css.match(/\.house-marker\s*\{[^}]*\}/)?.[0] ?? '';
  assert.match(rule, /width:\s*44px/);
  assert.match(rule, /height:\s*44px/);
  assert.equal(
    /scale\(/.test(rule),
    false,
    'the marker must not compensate for a stage transform the stage does not apply',
  );
  assert.equal(
    css.includes('scale(calc(1 / var(--zoom'),
    false,
    'the stage is resized, not scale()-transformed, so no inverse zoom compensation may remain',
  );
});

test('placement notes are a compact footnote disclosure with a phone-sized target', () => {
  assert.ok(css.includes('.details__placement-notes {'), 'the footnote container is styled');
  assert.ok(css.includes('.details__placement-notes__summary {'), 'the summary row is styled');
  assert.match(
    css,
    /\.details__placement-notes__summary \{[^}]*min-height: 44px/,
    'the summary keeps a 44 px tap target',
  );
  assert.ok(css.includes('.details__placement-notes__body .details__note'));
  assert.ok(
    app.includes("'details__placement-notes__summary', 'Placement notes'"),
    'the disclosure is labelled Placement notes',
  );
});

test('the stub document itself rejects innerHTML, proving the test harness', () => {
  const doc = createDocument();
  const node = doc.createElement('div');
  assert.throws(() => {
    node.innerHTML = '<b>x</b>';
  }, /innerHTML/);
});


test('ordinary mouse wheel zooms at the pointer without modifier keys', () => {
  const handlers = new Map();
  const viewport = {
    clientWidth: 800, clientHeight: 600,
    style: { setProperty() {} }, classList: { toggle() {} },
    addEventListener(name, handler) { handlers.set(name, handler); },
    getBoundingClientRect() { return { left: 100, top: 50 }; },
  };
  const stage = { style: { setProperty() {} } };
  let current;
  const controller = createMapController({ viewport, stage }, 4 / 3, state => { current = state; });
  controller.layout();
  let prevented = false;
  const event = { deltaY: -100, clientX: 300, clientY: 200,
    ctrlKey: false, metaKey: false, preventDefault() { prevented = true; } };
  handlers.get('wheel')(event);
  assert.equal(prevented, true);
  assert.ok(controller.getZoom() > 1);
  assert.ok(Math.abs((200 - current.panX) / (800 * current.zoom) - 0.25) < 1e-10);
  assert.ok(Math.abs((150 - current.panY) / (600 * current.zoom) - 0.25) < 1e-10);
  handlers.get('wheel')({ ...event, deltaY: 100 });
  assert.equal(controller.getZoom(), 1);
  prevented = false;
  handlers.get('wheel')({ ...event, deltaY: 0 });
  assert.equal(prevented, false);
  assert.equal(controller.getZoom(), 1);
});
