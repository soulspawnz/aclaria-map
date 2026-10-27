import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  LAYER_RENDERERS,
  PRECISION_VALUES,
  areaRingGeometry,
  canonicalPublicUrl,
  mapAspectRatio,
  housesInMarketOrder,
  unplacedReasonFor,
  validateSiteData,
} from '../app.js';

const data = JSON.parse(await readFile(new URL('../data/housing.json', import.meta.url), 'utf8'));

test('the published housing data passes structural validation', () => {
  assert.deepEqual(validateSiteData(data), []);
});

test('map metadata matches the checked-in artwork and normalized areas', () => {
  assert.equal(data.map.width, 4096);
  assert.equal(data.map.height, 2983);
  assert.equal(mapAspectRatio(data.map), 4096 / 2983);
  assert.match(data.map.image, /^assets\/aclaria-map\.jpg$/);
});

test('every catalogue home is retained in the original market order', () => {
  const homes = housesInMarketOrder(data.houses);
  assert.equal(homes.length, 26);
  assert.deepEqual(
    homes.map((house) => house.order),
    Array.from({ length: 26 }, (_, index) => index + 1),
  );
  assert.equal(new Set(homes.map((house) => house.id)).size, 26);
  assert.equal(new Set(homes.map((house) => house.name)).size, 26);
});

test('areas cover the placed homes and leave one home explicitly unplaced', () => {
  const placed = data.houses.filter((house) => house.areaId !== null);
  const unplaced = data.houses.filter((house) => house.areaId === null);
  assert.equal(data.areas.length, 19);
  assert.equal(placed.length, 25);
  assert.deepEqual(
    unplaced.map((house) => house.id),
    ['lovely-cabin'],
  );
  assert.equal(
    data.areas.flatMap((area) => area.houseIds).length,
    placed.length,
    'each placed home is listed by exactly one approximate area',
  );
});

test('every area declares a supported city or region precision', () => {
  const byPrecision = new Map();
  for (const area of data.areas) {
    assert.ok(
      PRECISION_VALUES.includes(area.precision),
      `${area.id} has an unsupported precision: ${area.precision}`,
    );
    byPrecision.set(area.precision, (byPrecision.get(area.precision) ?? 0) + 1);
  }
  assert.deepEqual(
    Object.fromEntries([...byPrecision].sort()),
    { 'approximate-city': 14, 'approximate-region': 5 },
  );
});

test('unplaced reasons are keyed by the exact house id', () => {
  const unplacedIds = data.houses.filter((house) => !house.areaId).map((house) => house.id);
  assert.deepEqual(Object.keys(data.unplacedReason).sort(), [...unplacedIds].sort());
  for (const key of Object.keys(data.unplacedReason)) {
    assert.ok(unplacedIds.includes(key), `${key} is not an unplaced house id`);
  }
});

test('unplaced homes have a recorded reason and no inferred area', () => {
  for (const house of data.houses.filter((candidate) => candidate.areaId === null)) {
    const reason = unplacedReasonFor(house, data.unplacedReason);
    assert.equal(typeof reason, 'string');
    assert.ok(reason.length > 10);
    assert.equal(house.areaId, null);
  }
  assert.equal(unplacedReasonFor(data.houses[0], data.unplacedReason), null);
});

test('normalized coordinates and radii stay inside the image and keep image-space shape', () => {
  const aspect = mapAspectRatio(data.map);
  for (const area of data.areas) {
    assert.ok(area.x >= 0 && area.x <= 1, `${area.id} x`);
    assert.ok(area.y >= 0 && area.y <= 1, `${area.id} y`);
    const ring = areaRingGeometry(area);
    assert.ok(ring.left >= -0.001, `${area.id} left`);
    assert.ok(ring.top >= -0.001, `${area.id} top`);
    assert.ok(ring.left + ring.width <= 100.001, `${area.id} right`);
    assert.ok(ring.top + ring.height <= 100.001, `${area.id} bottom`);
  }

  // A ring width percent refers to image width while height percent refers to
  // image height; the rendered ellipse must use those different denominators.
  const broadNorth = data.areas.find((area) => area.id === 'area-17');
  const pixelRatio =
    (broadNorth.radiusX * data.map.width) / (broadNorth.radiusY * data.map.height);
  assert.ok(pixelRatio > 3, 'northern mountain band is broad in image space');
  assert.ok(Math.abs(aspect - 1.373) < 0.001);
});

test('layers are declared without inventing content for disabled layers', () => {
  assert.deepEqual(
    data.layers.map((layer) => [layer.id, layer.enabled]),
    [
      ['housing', true],
      ['explorations', false],
      ['dungeons', false],
    ],
  );
  assert.deepEqual(Object.keys(LAYER_RENDERERS), ['housing']);
});

test('validation reports broken records instead of accepting them', () => {
  const duplicateId = structuredClone(data);
  duplicateId.houses[1].id = duplicateId.houses[0].id;
  assert.ok(validateSiteData(duplicateId).some((problem) => problem.includes('Duplicate house id')));

  const outOfRange = structuredClone(data);
  outOfRange.areas[0].x = 1.2;
  assert.ok(validateSiteData(outOfRange).some((problem) => problem.includes('out-of-range x')));

  const unknownArea = structuredClone(data);
  unknownArea.houses[0].areaId = 'area-does-not-exist';
  assert.ok(validateSiteData(unknownArea).some((problem) => problem.includes('unknown area')));

  const missingReason = structuredClone(data);
  delete missingReason.unplacedReason['lovely-cabin'];
  assert.ok(validateSiteData(missingReason).some((problem) => problem.includes('no recorded reason')));

  const missingRenderer = structuredClone(data);
  missingRenderer.layers.find((layer) => layer.id === 'explorations').enabled = true;
  assert.ok(validateSiteData(missingRenderer).some((problem) => problem.includes('no renderer')));

  assert.deepEqual(validateSiteData(null), ['Data root is not an object.']);
});

test('public wiki links are canonical live article URLs without revision pins', async () => {
  const published = await Promise.all(
    ['../index.html', '../README.md'].map((path) =>
      readFile(new URL(path, import.meta.url), 'utf8'),
    ),
  );
  const wikiUrls = [];
  for (const house of data.houses) wikiUrls.push(house.source);
  wikiUrls.push(data.map.source);

  for (const url of wikiUrls) {
    assert.ok(canonicalPublicUrl(url), `${url} must be a safe http(s) URL`);
    assert.equal(canonicalPublicUrl(url), url, `${url} must already be canonical`);
    assert.doesNotMatch(url, /[?&]oldid=/);
  }

  // The operator correction: shipped pages must not send readers to a
  // login-gated revision view, so no public page may carry an oldid parameter.
  for (const [index, text] of published.entries()) {
    assert.doesNotMatch(text, /[?&]oldid=/i, `${['index.html', 'README.md'][index]} has an oldid link`);
  }
});

test('map-facing Hearthglen label keeps the market wording on the house card', () => {
  const area = data.areas.find((candidate) => candidate.number === 9);
  assert.equal(area.name, 'Hearthglen');
  const house = data.houses.find((candidate) => candidate.id === 'worker-house');
  assert.equal(house.areaId, area.id);
  assert.match(house.location, /Hearthglem/, 'catalogue wording stays verbatim');
});

test('Pine Estate is placed at the independently verified Erethune settlement', () => {
  const area = data.areas.find((candidate) => candidate.name === 'Erethune');
  assert.ok(area, 'an Erethune area exists');
  assert.equal(area.precision, 'approximate-city');
  assert.ok(area.houseIds.includes('pine-estate'));
  assert.ok(Math.abs(area.x - 0.53955) < 0.01 && Math.abs(area.y - 0.17131) < 0.01);
  const house = data.houses.find((candidate) => candidate.id === 'pine-estate');
  assert.equal(house.areaId, area.id);
  assert.equal(unplacedReasonFor(house, data.unplacedReason), null);
});

test('Karnethra anchor sits on the settlement icon, not the shoreline', () => {
  const area = data.areas.find((candidate) => candidate.number === 5);
  assert.equal(area.name, 'Karnethra');
  // Red-roof centroid measured on the original artwork: 2395.9 x 1084.1 of 4096 x 2983.
  assert.ok(Math.abs(area.x - 0.584961) < 0.002, 'x is on the settlement icon');
  assert.ok(Math.abs(area.y - 0.363426) < 0.002, 'y is on the settlement icon');
});
