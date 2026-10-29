import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  ANCHOR_PRECISION_VALUES,
  LAYER_RENDERERS,
  PRECISION_VALUES,
  TEXT_AGREEMENT_VALUES,
  canonicalPublicUrl,
  isPlacedOnMap,
  mapAspectRatio,
  housesInMarketOrder,
  unplacedReasonFor,
  validateSiteData,
} from '../app.js';

const data = JSON.parse(await readFile(new URL('../data/housing.json', import.meta.url), 'utf8'));
const anchors = data.houses.map((house) => house.anchor);

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

test('every catalogue home carries one developer anchor inside its named area', () => {
  assert.equal(data.areas.length, 20);
  const placed = data.houses.filter((house) => isPlacedOnMap(house));
  assert.equal(placed.length, 26);
  assert.deepEqual(data.houses.filter((house) => !isPlacedOnMap(house)), []);
  assert.equal(
    data.areas.flatMap((area) => area.houseIds).length,
    26,
    'each home is listed by exactly one approximate area',
  );
  for (const house of data.houses) {
    assert.match(house.areaId, /^area-\d+$/, `${house.id} keeps a named catalogue area as context`);
    assert.equal(
      unplacedReasonFor(house, data.unplacedReason),
      null,
      `${house.id} is placed, so it carries no unplaced reason`,
    );
  }
});

test('the 26 anchors keep the annotation marker numbers in market order', () => {
  const homes = housesInMarketOrder(data.houses);
  assert.equal(anchors.length, 26);
  assert.deepEqual(
    homes.map((house) => house.anchor.markerNumber),
    Array.from({ length: 26 }, (_, index) => index + 1),
  );
  assert.equal(new Set(anchors.map((anchor) => anchor.markerNumber)).size, 26);
  for (const house of homes) {
    assert.equal(
      house.anchor.markerNumber,
      house.order,
      `${house.id} marker number is its catalogue order`,
    );
  }
});

test('anchor coordinates are finite normalized points with the annotation uncertainty', () => {
  const declared = data.coordinateSource;
  assert.equal(declared.kind, 'developer-annotation');
  assert.ok(ANCHOR_PRECISION_VALUES.includes(declared.kind));
  assert.equal(declared.published, '2026-10-28');
  assert.equal(declared.uncertaintyX, 0.00671);
  assert.equal(declared.uncertaintyY, 0.00922);

  const points = new Set();
  for (const house of data.houses) {
    const anchor = house.anchor;
    assert.equal(anchor.precision, 'developer-annotation', `${house.id} precision`);
    assert.equal(anchor.provenance, 'developer-annotation-2026-10-28', `${house.id} provenance`);
    assert.ok(TEXT_AGREEMENT_VALUES.includes(anchor.textAgreement), `${house.id} agreement value`);
    for (const key of ['x', 'y']) {
      assert.ok(Number.isFinite(anchor[key]), `${house.id} anchor ${key} is finite`);
      assert.ok(anchor[key] >= 0 && anchor[key] <= 1, `${house.id} anchor ${key} stays inside the image`);
    }
    assert.equal(anchor.uncertaintyX, declared.uncertaintyX, `${house.id} uncertaintyX is the annotation's`);
    assert.equal(anchor.uncertaintyY, declared.uncertaintyY, `${house.id} uncertaintyY is the annotation's`);
    points.add(`${anchor.x},${anchor.y}`);
  }
  assert.equal(points.size, 26, 'every home keeps its own annotated point');
  assert.deepEqual(
    [...new Set(anchors.map((anchor) => anchor.textAgreement))].sort(),
    ['agrees', 'developer-corrected', 'differs'],
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
    { 'approximate-city': 15, 'approximate-region': 5 },
  );
});

test('the unplaced reason map is retired but still protects positionless homes', () => {
  assert.deepEqual(data.unplacedReason, {}, 'no home is unplaced any more');
  const stripped = structuredClone(data);
  const house = stripped.houses[0];
  delete house.anchor;
  house.areaId = null;
  stripped.areas = stripped.areas.map((area) => ({
    ...area,
    houseIds: area.houseIds.filter((id) => id !== house.id),
  }));
  assert.ok(validateSiteData(stripped).some((problem) => problem.includes('no recorded reason')));
  stripped.unplacedReason = { [house.id]: 'No confident map label for this home yet.' };
  assert.deepEqual(validateSiteData(stripped), []);
  assert.equal(
    unplacedReasonFor(stripped.houses[0], stripped.unplacedReason),
    'No confident map label for this home yet.',
  );
});

test('normalized coordinates and radii stay inside the image and keep image-space shape', () => {
  const aspect = mapAspectRatio(data.map);
  for (const area of data.areas) {
    assert.ok(area.x >= 0 && area.x <= 1, `${area.id} x`);
    assert.ok(area.y >= 0 && area.y <= 1, `${area.id} y`);
    assert.ok(area.x - area.radiusX >= -0.001, `${area.id} left`);
    assert.ok(area.y - area.radiusY >= -0.001, `${area.id} top`);
    assert.ok(area.x + area.radiusX <= 1.001, `${area.id} right`);
    assert.ok(area.y + area.radiusY <= 1.001, `${area.id} bottom`);
  }

  // `radiusX` is a fraction of image width and `radiusY` a fraction of image
  // height, so an area that is broad on the map keeps a large pixel ratio.
  const broadNorth = data.areas.find((area) => area.id === 'area-17');
  const pixelRatio =
    (broadNorth.radiusX * data.map.width) / (broadNorth.radiusY * data.map.height);
  assert.ok(pixelRatio > 3, 'northern mountain band is broad in image space');
  assert.ok(Math.abs(aspect - 1.373) < 0.001);
});

test('the two wording/map differences keep both records and a visible note', () => {
  const cases = [
    {
      id: 'wood-cabin',
      marker: 18,
      x: 0.6001,
      y: 0.28461,
      wording: 'Near Thornmere Thicket river.',
      needle: /central-north forest belt/,
      area: 'Thornmere Thicket river area',
    },
    {
      id: 'padfax-house',
      marker: 21,
      x: 0.49463,
      y: 0.74824,
      wording: 'In the main road to Druskane.',
      needle: /southern desert plain/,
      area: 'Druskane / approach road',
    },
  ];
  for (const entry of cases) {
    const house = data.houses.find((candidate) => candidate.id === entry.id);
    const area = data.areas.find((candidate) => candidate.id === house.areaId);
    assert.ok(house, `${entry.id} exists`);
    assert.equal(area.name, entry.area, `${entry.id} keeps its catalogue area context`);
    assert.equal(house.anchor.markerNumber, entry.marker);
    assert.equal(house.anchor.textAgreement, 'differs');
    assert.equal(house.anchor.x, entry.x, `${entry.id} uses the annotated x`);
    assert.equal(house.anchor.y, entry.y, `${entry.id} uses the annotated y`);
    assert.ok(
      house.location.includes(entry.wording),
      `${entry.id} keeps the catalogue wording verbatim`,
    );
    assert.match(house.anchor.discrepancy, entry.needle, `${entry.id} note describes the annotation`);
    assert.match(house.anchor.discrepancy, /catalogue wording/, `${entry.id} note keeps the wording visible`);
    assert.ok(
      house.anchor.discrepancy.includes('does not claim'),
      `${entry.id} explicitly claims neither a move nor a stale record`,
    );
    // The older inferred area point is not retained as this home's position.
    assert.ok(
      Math.hypot(house.anchor.x - area.x, house.anchor.y - area.y) > 0.05,
      `${entry.id} keeps the annotated position instead of the old inferred point`,
    );
  }
});

test('the Hut keeps the developer correction alongside the catalogue wording', () => {
  const hut = data.houses.find((house) => house.id === 'hut');
  const area = data.areas.find((candidate) => candidate.id === hut.areaId);
  assert.equal(hut.anchor.markerNumber, 11);
  assert.equal(hut.anchor.textAgreement, 'developer-corrected');
  assert.match(hut.anchor.discrepancy, /not on the island/);
  assert.match(hut.location, /Near the south desert islands\./);
  assert.equal(area.name, 'South desert islands — broad area');
  const ringRatio = Math.hypot(
    (hut.anchor.x - area.x) / area.radiusX,
    (hut.anchor.y - area.y) / area.radiusY,
  );
  assert.ok(ringRatio > 1.5, 'the annotated position is not inside the old island ring');
});

test('Lovely cabin is placed at Thaldris, which stays distinct from Thalvaris', () => {
  const cabin = data.houses.find((house) => house.id === 'lovely-cabin');
  const thaldris = data.areas.find((area) => area.name === 'Thaldris');
  const thalvaris = data.areas.find((area) => area.name === 'Thalvaris');
  assert.ok(thaldris, 'Thaldris is a named area');
  assert.ok(thalvaris, 'Thalvaris is a named area');
  assert.notEqual(thaldris.id, thalvaris.id);
  assert.equal(thaldris.precision, 'approximate-city');
  assert.deepEqual(thaldris.houseIds, ['lovely-cabin']);
  assert.equal(cabin.areaId, thaldris.id);
  assert.equal(cabin.anchor.markerNumber, 23);
  assert.equal(cabin.anchor.textAgreement, 'agrees');
  assert.match(cabin.location, /Marketplace of Thaldris\./);
  assert.equal(unplacedReasonFor(cabin, data.unplacedReason), null);
  assert.ok(!('lovely-cabin' in data.unplacedReason));
  assert.ok(
    Math.hypot(thaldris.x - thalvaris.x, thaldris.y - thalvaris.y) > 0.4,
    'Thaldris is nowhere near Thalvaris',
  );
});

test('the Nathorien pair keeps the developer distinction between inside and outside', () => {
  const house = data.houses.find((candidate) => candidate.id === 'house');
  const cottage = data.houses.find((candidate) => candidate.id === 'cottage');
  assert.equal(house.anchor.markerNumber, 1);
  assert.equal(cottage.anchor.markerNumber, 2);
  assert.match(house.anchor.placeNote, /inside Nathorien/);
  assert.match(cottage.anchor.placeNote, /outside Nathorien/);
  assert.match(house.location, /Nathorien’s residential quarter\./);
  assert.match(cottage.location, /Outskirts of Nathorien\./);
  assert.ok(
    Math.hypot(house.anchor.x - cottage.anchor.x, house.anchor.y - cottage.anchor.y) > 0.01,
    'the two homes no longer share one point',
  );
});

test('the Beresclair anchor names Hornveil as a note and keeps Ebonveil Thicket', () => {
  const house = data.houses.find((candidate) => candidate.id === 'beresclair-estate');
  const area = data.areas.find((candidate) => candidate.id === house.areaId);
  assert.equal(area.name, 'Ebonveil Thicket');
  assert.equal(house.anchor.textAgreement, 'agrees');
  assert.match(house.anchor.placeNote, /HORNVEIL/);
  assert.match(house.location, /Ebonveil Thicket with its own private land\./);
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

  const missingRenderer = structuredClone(data);
  missingRenderer.layers.find((layer) => layer.id === 'explorations').enabled = true;
  assert.ok(validateSiteData(missingRenderer).some((problem) => problem.includes('no renderer')));

  const anchorOutOfRange = structuredClone(data);
  anchorOutOfRange.houses[0].anchor.x = 1.4;
  assert.ok(
    validateSiteData(anchorOutOfRange).some((problem) => problem.includes('out-of-range anchor x')),
  );

  const anchorNotFinite = structuredClone(data);
  anchorNotFinite.houses[0].anchor.y = Number.POSITIVE_INFINITY;
  assert.ok(
    validateSiteData(anchorNotFinite).some((problem) => problem.includes('out-of-range anchor y')),
  );

  const anchorIsText = structuredClone(data);
  anchorIsText.houses[0].anchor = 'somewhere north';
  assert.ok(validateSiteData(anchorIsText).some((problem) => problem.includes('anchor is not an object')));

  const duplicateMarker = structuredClone(data);
  duplicateMarker.houses[1].anchor.markerNumber = 1;
  assert.ok(
    validateSiteData(duplicateMarker).some((problem) => problem.includes('Duplicate anchor marker number')),
  );

  const wrongUncertainty = structuredClone(data);
  wrongUncertainty.houses[0].anchor.uncertaintyX = 0.05;
  assert.ok(
    validateSiteData(wrongUncertainty).some((problem) =>
      problem.includes('does not match the declared annotation uncertainty'),
    ),
  );

  const silentDifference = structuredClone(data);
  delete silentDifference.houses.find((house) => house.id === 'wood-cabin').anchor.discrepancy;
  assert.ok(
    validateSiteData(silentDifference).some((problem) => problem.includes('without a visible note')),
  );

  const unsupportedPrecision = structuredClone(data);
  unsupportedPrecision.houses[0].anchor.precision = 'exact-address';
  assert.ok(
    validateSiteData(unsupportedPrecision).some((problem) => problem.includes('supported precision')),
  );

  const noCoordinateSource = structuredClone(data);
  delete noCoordinateSource.coordinateSource;
  assert.ok(
    validateSiteData(noCoordinateSource).some((problem) => problem.includes('declared coordinate source')),
  );

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
  assert.match(house.anchor.placeNote, /HEARTHGLEN/);
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
