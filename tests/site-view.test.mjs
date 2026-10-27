import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  areaRingGeometry,
  buildHouseItem,
  capacityLabel,
  clampPanAxis,
  containFit,
  filterHouses,
  formatGold,
  housesInMarketOrder,
  isSafeHttpUrl,
  mapAspectRatio,
  markerPosition,
  normalizeSearchText,
  precisionLabel,
  renderAreaDetails,
  renderAreaMarkers,
  renderHouseDetails,
  renderHouseList,
  renderLayerChips,
  sourceLabel,
  unplacedReasonFor,
} from '../app.js';
import { createDocument, findAll } from './site-dom-stub.mjs';

const data = JSON.parse(await readFile(new URL('../data/housing.json', import.meta.url), 'utf8'));
const aspect = mapAspectRatio(data.map);
const ids = (houses) => houses.map((house) => house.id);

test('the default filter keeps every home in market order', () => {
  const original = data.houses.map((house) => house.id);
  const result = filterHouses(data.houses, data.areas);
  assert.deepEqual(ids(result), original);
  assert.deepEqual(
    ids(result),
    ids(housesInMarketOrder(data.houses)),
    'market order comes from the order field, not array position',
  );
});

test('search matches names, catalogue wording and approximate area names', () => {
  assert.deepEqual(ids(filterHouses(data.houses, data.areas, { query: 'nathorien' })), [
    'house',
    'cottage',
  ]);
  assert.deepEqual(ids(filterHouses(data.houses, data.areas, { query: 'DESERT' })), [
    'hut',
    'desert-house',
    'sunrise-manor',
  ]);
  assert.deepEqual(ids(filterHouses(data.houses, data.areas, { query: 'Caerithalor' })), [
    'leherd-residence',
  ]);
  assert.deepEqual(ids(filterHouses(data.houses, data.areas, { query: 'thalvaris flower' })), [
    'flower-house',
  ]);
  assert.deepEqual(filterHouses(data.houses, data.areas, { query: 'no such home' }), []);
});

test('placement filters preserve order and never drop unplaced homes', () => {
  assert.deepEqual(ids(filterHouses(data.houses, data.areas, { placement: 'unplaced' })), [
    'lovely-cabin',
  ]);
  const placed = filterHouses(data.houses, data.areas, { placement: 'placed' });
  assert.equal(placed.length, 25);
  assert.deepEqual(
    ids(placed),
    ids(data.houses.filter((house) => house.areaId !== null)),
  );
  assert.deepEqual(ids(filterHouses(data.houses, data.areas, { placement: 'bogus' })), ids(data.houses));
});

test('search text normalization tolerates case, spacing and curly apostrophes', () => {
  assert.equal(normalizeSearchText('  Nathorien’s   Quarter '), "nathorien's quarter");
  assert.equal(normalizeSearchText('ÉBONVEIL'), 'ebonveil');
  assert.equal(normalizeSearchText(null), '');
});

test('normalized positions convert to percentages without distorting the map', () => {
  const area = data.areas[0];
  const position = markerPosition(area);
  assert.ok(Math.abs(position.left - area.x * 100) < 0.001);
  assert.ok(Math.abs(position.top - area.y * 100) < 0.001);

  const ring = areaRingGeometry(area);
  assert.ok(Math.abs(ring.width - area.radiusX * 200) < 0.001);
  assert.ok(Math.abs(ring.height - area.radiusY * 200) < 0.001);
  assert.ok(Math.abs(ring.left + ring.width / 2 - area.x * 100) < 0.001);

  assert.ok(Math.abs(aspect - 4096 / 2983) < 1e-12);
  assert.deepEqual(containFit(375, 800, aspect), { width: 375, height: 375 / aspect });
  assert.deepEqual(containFit(1200, 500, aspect), { width: 500 * aspect, height: 500 });
  assert.deepEqual(containFit(0, 500, aspect), { width: 0, height: 0 });

  assert.equal(clampPanAxis(20, 400, 375), 0, 'clamps at the left edge');
  assert.equal(clampPanAxis(-900, 400, 375), 375 - 400, 'clamps at the right edge');
  assert.equal(clampPanAxis(999, 300, 375), 37.5, 'centers a map smaller than the viewport');
});

test('unsafe URLs are rejected before rendering', () => {
  assert.equal(isSafeHttpUrl('https://aclariarpg.fandom.com/wiki/Grand_Homestead_Market'), true);
  assert.equal(isSafeHttpUrl('http://example.com/map'), true);
  assert.equal(isSafeHttpUrl('javascript:alert(1)'), false);
  assert.equal(isSafeHttpUrl('data:text/html,<p>x</p>'), false);
  assert.equal(isSafeHttpUrl('//evil.example/map'), false);
  assert.equal(isSafeHttpUrl(''), false);
  assert.equal(isSafeHttpUrl(null), false);
  assert.equal(
    sourceLabel('https://aclariarpg.fandom.com/wiki/Grand_Homestead_Market'),
    'Grand Homestead Market catalogue',
  );
  // A revision-pinned URL still renders the canonical label without advertising the pin.
  assert.equal(
    sourceLabel('https://aclariarpg.fandom.com/wiki/Grand_Homestead_Market?oldid=799'),
    'Grand Homestead Market catalogue',
  );
});

test('prices and capacities are formatted from the source values', () => {
  assert.equal(formatGold(230000), '230,000 gold');
  assert.equal(formatGold(0), 'Free');
  assert.equal(formatGold(undefined), 'Price not listed');
  assert.equal(capacityLabel(1), '1 companion');
  assert.equal(capacityLabel(4), '4 companions');
});

test('precision labels distinguish settlements from regions', () => {
  assert.equal(precisionLabel('approximate-city'), 'Approximate city');
  assert.equal(precisionLabel('approximate-region'), 'Approximate region');
  assert.equal(precisionLabel('approximate-city-or-region'), 'Approximate city or region');
  assert.equal(precisionLabel('something-else'), 'Approximate area');
});

test('unplaced reasons resolve from the recorded reason map only', () => {
  const cabin = data.houses.find((house) => house.id === 'lovely-cabin');
  assert.match(unplacedReasonFor(cabin, data.unplacedReason), /Thaldris/);
  assert.equal(unplacedReasonFor({ ...cabin, id: 'unknown-home' }, data.unplacedReason), null);
  assert.equal(unplacedReasonFor({ ...cabin, areaId: 'area-1' }, data.unplacedReason), null);
  const pine = data.houses.find((house) => house.id === 'pine-estate');
  assert.equal(unplacedReasonFor(pine, data.unplacedReason), null, 'placed homes have no reason');
});

test('area markers are accessible numbered buttons with approximate wording', () => {
  const doc = createDocument();
  const container = doc.createElement('div');
  const rendered = renderAreaMarkers(doc, container, data.areas, data.houses);
  assert.equal(rendered, 19);
  const buttons = findAll(container, (node) => node.tagName === 'BUTTON');
  assert.equal(buttons.length, 19);
  for (const [index, button] of buttons.entries()) {
    const area = data.areas[index];
    assert.equal(button.getAttribute('aria-pressed'), 'false');
    assert.match(
      button.getAttribute('aria-label'),
      /^Area \d+: .+ Approximate (?:city|region); \d+ homes? listed\.$/,
    );
    assert.equal(button.dataset.areaId, area.id);
    assert.ok(button.style.left.endsWith('%'));
    assert.ok(button.style.top.endsWith('%'));
  }
  const badges = findAll(container, (node) => node.classList.contains('marker__badge'));
  assert.deepEqual(
    badges.map((badge) => badge.textContent),
    data.areas.map((area) => String(area.number)),
  );
});

test('layer chips show enabled layers only and do not invent future layers', () => {
  const doc = createDocument();
  const list = doc.createElement('ul');
  const count = renderLayerChips(doc, list, data.layers);
  assert.equal(count, 1);
  assert.equal(list.textContent, 'Housing');
  assert.doesNotMatch(list.textContent, /Explorations|Dungeons/);
});

test('house cards render data as text, never as HTML', () => {
  const doc = createDocument();
  const list = doc.createElement('ul');
  const hostile = {
    id: 'hostile-home',
    order: 1,
    name: '<img src=x onerror="alert(1)">',
    priceGold: 1200,
    companionCapacity: 2,
    location: '<script>alert(2)</script>',
    areaId: null,
    source: 'javascript:alert(3)',
  };
  const count = renderHouseList(doc, list, [hostile], [], {
    reasons: { 'hostile-home': 'No confident map label.' },
  });
  assert.equal(count, 1);
  assert.equal(findAll(list, (node) => node.tagName === 'IMG').length, 0);
  assert.equal(findAll(list, (node) => node.tagName === 'SCRIPT').length, 0);
  assert.match(list.textContent, /<img src=x onerror="alert\(1\)">/);
  assert.match(list.textContent, /Not yet placed/);
  assert.match(list.textContent, /No confident map label/);
  assert.equal(findAll(list, (node) => node.tagName === 'A').length, 0);
});

test('house details use textContent and only link safe sources', () => {
  const doc = createDocument();
  const panel = doc.createElement('div');
  const hostile = {
    id: 'hostile-home',
    name: '<b>Bold claim</b>',
    priceGold: 5000,
    companionCapacity: 1,
    location: '<img src=x onerror="alert(4)">',
    areaId: null,
    source: 'javascript:alert(5)',
  };
  renderHouseDetails(doc, panel, {
    house: hostile,
    area: null,
    reason: '<em>No label</em>',
  });
  assert.equal(findAll(panel, (node) => node.tagName === 'B').length, 0);
  assert.equal(findAll(panel, (node) => node.tagName === 'IMG').length, 0);
  assert.match(panel.textContent, /<b>Bold claim<\/b>/);
  assert.match(panel.textContent, /No marker is shown/);
  assert.match(panel.textContent, /Source link unavailable/);
  assert.equal(findAll(panel, (node) => node.tagName === 'A').length, 0);

  const safeHouse = data.houses[0];
  const safeArea = data.areas.find((area) => area.id === safeHouse.areaId);
  renderHouseDetails(doc, panel, { house: safeHouse, area: safeArea });
  const links = findAll(panel, (node) => node.tagName === 'A');
  assert.equal(links.length, 1);
  assert.equal(links[0].href, safeHouse.source);
  assert.match(links[0].rel, /noopener/);
  assert.match(panel.textContent, /is an approximate (?:city|region) from the catalogue wording/);
  assert.deepEqual(
    findAll(panel, (node) => node.tagName === 'BUTTON').map((button) => button.dataset.action),
    ['show-area', 'back-to-list'],
  );
});

test('area details list homes in market order and treat the ring as data', () => {
  const doc = createDocument();
  const panel = doc.createElement('div');
  const area = data.areas.find((candidate) => candidate.id === 'area-11');
  const houses = data.houses.filter((house) => house.areaId === area.id);
  renderAreaDetails(doc, panel, { area, houses });
  assert.match(panel.textContent, /Area 11: Drenvalis/);
  assert.match(panel.textContent, /not proof of a house location/);
  const buttons = findAll(panel, (node) => node.tagName === 'BUTTON');
  assert.equal(buttons[0].dataset.action, 'show-area');
  assert.equal(buttons[0].dataset.areaId, area.id);
  assert.deepEqual(
    buttons.slice(1).map((button) => button.dataset.houseId),
    ['jasmine-palace', 'arnsay-house', 'elm-mansion'],
  );
  assert.deepEqual(
    ids(housesInMarketOrder(houses)),
    buttons.slice(1).map((button) => button.dataset.houseId),
  );
});

test('malformed house entries are skipped instead of crashing the list', () => {
  const doc = createDocument();
  const list = doc.createElement('ul');
  const count = renderHouseList(doc, list, [null, { name: 'No id' }, data.houses[0]], [], {});
  assert.equal(count, 1);
  assert.equal(list.children.length, 1);
  assert.equal(filterHouses([null, data.houses[0]], [], {}).length, 1);
});

test('building one card is independent of sibling rendering', () => {
  const doc = createDocument();
  const house = data.houses[0];
  const area = data.areas.find((candidate) => candidate.id === house.areaId);
  const item = buildHouseItem(doc, house, area);
  assert.equal(item.tagName, 'LI');
  assert.equal(item.dataset.houseId, house.id);
  const card = findAll(item, (node) => node.tagName === 'BUTTON')[0];
  assert.equal(card.dataset.areaId, area.id);
  assert.match(card.textContent, /Area 1/);
  assert.match(card.textContent, /Nathorien/);
});
