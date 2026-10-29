import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  LAYER_RENDERERS,
  anchorPosition,
  areaLabel,
  buildHouseItem,
  capacityLabel,
  clampPanAxis,
  containFit,
  filterHouses,
  formatGold,
  housesInMarketOrder,
  isPlacedOnMap,
  isSafeHttpUrl,
  mapAspectRatio,
  markerPosition,
  normalizeSearchText,
  precisionLabel,
  renderHouseDetails,
  renderHouseList,
  renderHouseMarkers,
  renderLayerChips,
  sourceLabel,
  unplacedReasonFor,
  validAnchor,
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

test('placement filters follow the anchors and never drop unplaced homes', () => {
  assert.deepEqual(ids(filterHouses(data.houses, data.areas, { placement: 'unplaced' })), []);
  const placed = filterHouses(data.houses, data.areas, { placement: 'placed' });
  assert.equal(placed.length, 26);
  assert.deepEqual(
    ids(placed),
    ids(data.houses.filter((house) => isPlacedOnMap(house))),
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

  // Anchors use the same conversion, so a house marker sits on its own point.
  for (const house of data.houses) {
    const anchor = anchorPosition(house.anchor);
    assert.ok(Math.abs(anchor.left - house.anchor.x * 100) < 0.001, `${house.id} anchor left`);
    assert.ok(Math.abs(anchor.top - house.anchor.y * 100) < 0.001, `${house.id} anchor top`);
  }

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
  assert.equal(unplacedReasonFor(cabin, data.unplacedReason), null, 'Lovely cabin is placed now');
  assert.equal(unplacedReasonFor({ ...cabin, areaId: 'area-1' }, data.unplacedReason), null);
  const pine = data.houses.find((house) => house.id === 'pine-estate');
  assert.equal(unplacedReasonFor(pine, data.unplacedReason), null, 'placed homes have no reason');
  assert.equal(unplacedReasonFor({ id: 'unknown-home', areaId: null }, data.unplacedReason), null);
  assert.equal(
    unplacedReasonFor({ id: 'camel-home', areaId: null }, { camelHome: 'Reason recorded.' }),
    'Reason recorded.',
  );
});

test('the housing layer draws only the 26 numbered house markers', () => {
  const doc = createDocument();
  const container = doc.createElement('div');
  LAYER_RENDERERS.housing(doc, container, data);

  const markers = findAll(container, (node) => node.classList.contains('house-marker'));
  assert.equal(markers.length, 26);
  assert.equal(container.children.length, 26, 'the layer holds no other marker tier');
  assert.equal(
    findAll(container, (node) => node.classList.contains('marker--area')).length,
    0,
    'no area markers are drawn',
  );
  assert.equal(
    findAll(container, (node) => node.classList.contains('area-ring')).length,
    0,
    'no area rings are drawn',
  );
  assert.equal(
    container.children.filter((node) => node.tagName !== 'BUTTON').length,
    0,
    'the layer holds marker buttons and nothing else',
  );

  const homes = housesInMarketOrder(data.houses);
  assert.deepEqual(
    markers.map((marker) => marker.dataset.markerNumber),
    homes.map((house) => String(house.anchor.markerNumber)),
  );
  assert.deepEqual(
    markers.map((marker) => marker.dataset.markerNumber),
    homes.map((_, index) => String(index + 1)),
    'the only numbers on the map are the annotation badge numbers, in market order',
  );
  for (const [index, marker] of markers.entries()) {
    const anchor = homes[index].anchor;
    assert.equal(marker.style.left, `${Math.round(anchor.x * 100000) / 1000}%`);
    assert.equal(marker.style.top, `${Math.round(anchor.y * 100000) / 1000}%`);
    assert.equal(marker.classList.contains('house-marker--approximate'), false);
  }
});

test('a home without an anchor falls back to its approximate area, unnumbered', () => {
  const doc = createDocument();
  const container = doc.createElement('div');
  const house = data.houses.find((candidate) => candidate.id === 'house');
  const area = data.areas.find((candidate) => candidate.id === house.areaId);
  const withoutAnchor = { ...house, anchor: null };

  assert.equal(renderHouseMarkers(doc, container, [withoutAnchor], data.areas), 1);
  const [marker] = findAll(container, (node) => node.classList.contains('house-marker'));
  assert.ok(marker.classList.contains('house-marker--approximate'));
  assert.equal(marker.dataset.markerNumber, undefined, 'the fallback carries no area number');
  assert.equal(marker.style.left, `${Math.round(area.x * 100000) / 1000}%`);
  assert.equal(marker.style.top, `${Math.round(area.y * 100000) / 1000}%`);
  const label = marker.getAttribute('aria-label');
  assert.ok(label.startsWith(`Approximate position for ${house.name}`), label);
  assert.ok(label.includes(area.name), label);
  assert.ok(label.includes('not an individual annotation'), label);
  const badge = findAll(container, (node) => node.classList.contains('house-marker__badge'))[0];
  assert.equal(badge.textContent, '~', 'the fallback badge never shows a number');

  const panel = doc.createElement('div');
  renderHouseDetails(doc, panel, { house: withoutAnchor, area, coordinateSource: data.coordinateSource });
  const text = panel.textContent;
  assert.ok(text.includes('Approximate position'), 'the details chip names the approximation');
  assert.ok(text.includes('No individual annotation'), 'the details do not claim an annotation');
  assert.ok(text.includes('approximate fallback marker'), 'the note explains the fallback');
  assert.ok(text.includes(areaLabel(area)), 'the position fact names the catalogue area');
  assert.equal(text.includes('Position uncertainty'), false, 'no annotation uncertainty is claimed');
});

test('house markers render one accessible button per catalogue home at its anchor', () => {
  const doc = createDocument();
  const container = doc.createElement('div');
  const rendered = renderHouseMarkers(doc, container, data.houses, data.areas);
  assert.equal(rendered, 26);
  const buttons = findAll(container, (node) => node.classList.contains('house-marker'));
  assert.equal(buttons.length, 26);
  const homes = housesInMarketOrder(data.houses);
  for (const [index, button] of buttons.entries()) {
    const house = homes[index];
    const anchor = house.anchor;
    const area = data.areas.find((candidate) => candidate.id === house.areaId);
    const label = button.getAttribute('aria-label');
    assert.equal(button.dataset.houseId, house.id);
    assert.equal(button.dataset.markerNumber, String(anchor.markerNumber));
    assert.equal(button.getAttribute('aria-pressed'), 'false');
    assert.equal(button.style.left, `${Math.round(anchor.x * 100000) / 1000}%`);
    assert.equal(button.style.top, `${Math.round(anchor.y * 100000) / 1000}%`);
    assert.ok(label.startsWith(`Marker ${anchor.markerNumber}: ${house.name}`), label);
    assert.ok(label.includes('developer-annotated position'), label);
    assert.ok(label.includes(area.name), label);
  }
  const badges = findAll(container, (node) => node.classList.contains('house-marker__badge'));
  assert.deepEqual(
    badges.map((badge) => badge.textContent),
    buttons.map((button) => button.dataset.markerNumber),
  );
});

test('closely spaced anchors keep their exact source coordinates', () => {
  const clusters = {
    'jasmine-palace': [0.51709, 0.69796],
    'elm-mansion': [0.51196, 0.71371],
    'arnsay-house': [0.49756, 0.70835],
    house: [0.31787, 0.61079],
    cottage: [0.33472, 0.62957],
    'robindal-house': [0.81396, 0.40194],
    'robindal-mansion': [0.83667, 0.4063],
    'flower-house': [0.39087, 0.82367],
    'chapney-manor': [0.37061, 0.83138],
  };
  for (const [id, [x, y]] of Object.entries(clusters)) {
    const anchor = data.houses.find((house) => house.id === id).anchor;
    assert.equal(anchor.x, x, `${id} keeps its annotated x`);
    assert.equal(anchor.y, y, `${id} keeps its annotated y`);
  }
  const points = new Set(data.houses.map((house) => `${house.anchor.x}|${house.anchor.y}`));
  assert.equal(points.size, 26, 'no position is displaced to separate close markers');

  const doc = createDocument();
  const container = doc.createElement('div');
  renderHouseMarkers(doc, container, data.houses, data.areas);
  const markers = new Map(
    findAll(container, (node) => node.classList.contains('house-marker')).map((button) => [
      button.dataset.houseId,
      button,
    ]),
  );
  const jasmine = data.houses.find((house) => house.id === 'jasmine-palace').anchor;
  assert.equal(markers.get('jasmine-palace').style.left, `${Math.round(jasmine.x * 100000) / 1000}%`);
  assert.ok(
    markers.get('wood-cabin').getAttribute('aria-label').includes('text/map discrepancy recorded'),
  );
  assert.ok(
    markers.get('hut').getAttribute('aria-label').includes('developer correction over the wording'),
  );
});

test('anchors that are not finite normalized points never place a home exactly', () => {
  assert.equal(validAnchor(undefined), null);
  assert.equal(validAnchor({ x: Number.NaN, y: 0.5 }), null);
  assert.equal(validAnchor({ x: 0.5, y: Number.POSITIVE_INFINITY }), null);
  assert.equal(validAnchor({ x: '0.5', y: 0.5 }), null);
  assert.equal(validAnchor({ x: 1.4, y: 0.5 }), null);
  assert.equal(validAnchor({ x: -0.1, y: 0.5 }), null);
  assert.equal(validAnchor([0.5, 0.25]), null);
  const anchor = { x: 0.5, y: 0.25 };
  assert.equal(validAnchor(anchor), anchor);

  const doc = createDocument();
  const container = doc.createElement('div');
  const broken = { ...data.houses[0], anchor: { x: Number.NaN, y: 0.5, markerNumber: 1 } };
  const brokenArea = data.areas.find((candidate) => candidate.id === broken.areaId);
  assert.equal(renderHouseMarkers(doc, container, [broken], data.areas), 1);
  const [fallback] = findAll(container, (node) => node.classList.contains('house-marker'));
  assert.ok(
    fallback.classList.contains('house-marker--approximate'),
    'an unusable anchor is never used as an exact position',
  );
  assert.equal(fallback.dataset.markerNumber, undefined);
  assert.equal(fallback.style.left, `${Math.round(brokenArea.x * 100000) / 1000}%`);
  assert.equal(isPlacedOnMap(broken), true, 'the catalogue area still keeps it in the list');
  assert.equal(filterHouses([broken], data.areas, { placement: 'placed' }).length, 1);

  const orphan = { ...data.houses[0], id: 'orphan-home', anchor: null, areaId: null };
  assert.equal(isPlacedOnMap(orphan), false);
  assert.equal(renderHouseMarkers(doc, doc.createElement('div'), [orphan], data.areas), 0);
  assert.deepEqual(
    ids(filterHouses([orphan], data.areas, { placement: 'unplaced' })),
    ['orphan-home'],
  );
  assert.deepEqual(filterHouses([orphan], data.areas, { placement: 'placed' }), []);
});

test('homes outside their catalogue area keep the area as context, not as their position', () => {
  const outside = [];
  for (const house of data.houses) {
    const area = data.areas.find((candidate) => candidate.id === house.areaId);
    const ringRatio = Math.hypot(
      (house.anchor.x - area.x) / area.radiusX,
      (house.anchor.y - area.y) / area.radiusY,
    );
    if (ringRatio > 1.2) outside.push(house.id);
  }
  assert.deepEqual(
    outside,
    ['cottage', 'hut', 'beresclair-estate', 'wood-cabin', 'padfax-house', 'sunrise-manor'],
    'six annotated positions sit outside their recorded ring',
  );

  for (const id of outside) {
    const house = data.houses.find((candidate) => candidate.id === id);
    const area = data.areas.find((candidate) => candidate.id === house.areaId);
    const ringRatio = Math.hypot(
      (house.anchor.x - area.x) / area.radiusX,
      (house.anchor.y - area.y) / area.radiusY,
    );
    assert.ok(ringRatio > 1.2, `${id} annotated point sits outside its catalogue ring`);
    const doc = createDocument();
    const panel = doc.createElement('div');
    renderHouseDetails(doc, panel, {
      house,
      area,
      coordinateSource: data.coordinateSource,
    });
    assert.ok(panel.textContent.includes('kept as context'), `${id} keeps the ring as context`);
    assert.ok(
      panel.textContent.includes(`Marker ${house.anchor.markerNumber} is the developer's hand-placed annotation`),
      `${id} shows the annotation as the position`,
    );
  }
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
  renderHouseDetails(doc, panel, {
    house: safeHouse,
    area: safeArea,
    coordinateSource: data.coordinateSource,
  });
  const links = findAll(panel, (node) => node.tagName === 'A');
  assert.equal(links.length, 1);
  assert.equal(links[0].href, safeHouse.source);
  assert.match(links[0].rel, /noopener/);
  const text = panel.textContent;
  assert.ok(text.includes("Marker 1 is the developer's hand-placed annotation"), text);
  assert.ok(text.includes('kept as context'), text);
  assert.equal(text.includes('approximate approximate'), false, 'the area sentence reads once');
  assert.ok(text.includes('Position uncertainty'), text);
  assert.ok(text.includes('±0.00671 × ±0.00922 of the map'), text);
  assert.ok(text.includes('Developer-annotated housing map, 2026-10-28'), text);
  assert.deepEqual(
    findAll(panel, (node) => node.tagName === 'BUTTON').map((button) => button.dataset.action),
    ['show-marker', 'back-to-list'],
    'the panel offers no separate area-map action',
  );
});

test('discrepancy homes show a visible text/map note and keep the catalogue quote', () => {
  const doc = createDocument();
  const panel = doc.createElement('div');
  for (const id of ['wood-cabin', 'padfax-house', 'hut']) {
    const house = data.houses.find((candidate) => candidate.id === id);
    const area = data.areas.find((candidate) => candidate.id === house.areaId);
    renderHouseDetails(doc, panel, { house, area, coordinateSource: data.coordinateSource });
    const notes = findAll(panel, (node) => node.classList.contains('details__note--discrepancy'));
    assert.equal(notes.length, 1, `${id} shows exactly one discrepancy note`);
    assert.ok(notes[0].textContent.startsWith('Text/map discrepancy:'), notes[0].textContent);
    assert.ok(panel.textContent.includes(house.location), `${id} keeps the catalogue wording`);
    assert.ok(
      panel.textContent.includes('Catalogue wording agrees') === false,
      `${id} never claims the wording agrees`,
    );
  }
  const plain = data.houses.find((house) => house.id === 'brick-house');
  renderHouseDetails(doc, panel, {
    house: plain,
    area: data.areas.find((area) => area.id === plain.areaId),
    coordinateSource: data.coordinateSource,
  });
  assert.equal(findAll(panel, (node) => node.classList.contains('details__note--discrepancy')).length, 0);
  assert.equal(panel.textContent.toLowerCase().includes('discrepancy'), false);
});

test('house cards and the list carry the marker number, area and discrepancy wording', () => {
  const doc = createDocument();
  const list = doc.createElement('ul');
  const rendered = renderHouseList(doc, list, data.houses, data.areas, {
    reasons: data.unplacedReason,
  });
  assert.equal(rendered, 26);
  const cards = findAll(list, (node) => node.classList.contains('house-card'));
  assert.deepEqual(cards.map((card) => card.dataset.houseId), ids(housesInMarketOrder(data.houses)));

  const cabin = cards.find((card) => card.dataset.houseId === 'wood-cabin');
  assert.ok(cabin.textContent.includes('Marker 18'));
  assert.ok(cabin.textContent.includes('Thornmere Thicket river area'));
  assert.ok(cabin.textContent.includes('text/map discrepancy recorded'));
  assert.ok(cabin.textContent.includes('9,000 gold'));
  assert.ok(cabin.textContent.includes("Near Thornmere Thicket river.") === false);

  const home = cards.find((card) => card.dataset.houseId === 'house');
  assert.ok(home.textContent.includes('Marker 1'));
  assert.ok(home.textContent.includes('Nathorien · developer-annotated position'));
  assert.equal(home.textContent.toLowerCase().includes('discrepancy'), false);

  const hut = cards.find((card) => card.dataset.houseId === 'hut');
  assert.ok(hut.textContent.includes('developer correction over the wording'));
});

test('house details offer the marker action and no separate area map action', () => {
  const doc = createDocument();
  const panel = doc.createElement('div');
  const house = data.houses.find((candidate) => candidate.id === 'jasmine-palace');
  const area = data.areas.find((candidate) => candidate.id === house.areaId);
  renderHouseDetails(doc, panel, { house, area, coordinateSource: data.coordinateSource });

  const actions = findAll(panel, (node) => node.tagName === 'BUTTON').map(
    (button) => button.dataset.action,
  );
  assert.deepEqual(actions, ['show-marker', 'back-to-list']);
  assert.equal(panel.textContent.includes('Show area on map'), false);
  assert.ok(panel.textContent.includes(areaLabel(area)), 'the area stays as details context');
  assert.ok(panel.textContent.includes('kept as context'));
  assert.equal(panel.textContent.includes('dashed ring'), false, 'no ring is described or drawn');
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
  assert.equal(item.dataset.markerNumber, '1');
  const card = findAll(item, (node) => node.tagName === 'BUTTON')[0];
  assert.equal(card.dataset.areaId, area.id);
  assert.equal(card.dataset.markerNumber, '1');
  assert.match(card.textContent, /Marker 1/);
  assert.match(card.textContent, /Nathorien/);
  assert.match(card.textContent, /developer-annotated position/);
});
