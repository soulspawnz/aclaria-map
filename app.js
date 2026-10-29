/**
 * Aclaria map — housing layer.
 *
 * Plain ES module with no runtime dependencies. Data loading and rendering are
 * separate: this file reads data/housing.json, validates its shape and renders
 * one or more enabled layers. Pure helpers are exported for the node:test suite;
 * browser bootstrapping only runs when a document exists, so the module can be
 * imported safely in tests.
 */

const DATA_URL = new URL('./data/housing.json', import.meta.url);
const GOLD_FORMAT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 5;
export const PLACEMENT_VALUES = Object.freeze(['all', 'placed', 'unplaced']);

/**
 * Placement comes from the developer's annotated housing map: every house
 * carries one `anchor`. The named areas stay as context for the catalogue
 * wording in search, the list and the details panel; they are never a
 * substitute for an individual marker and are not drawn as a second numbered
 * map layer.
 */
export const ANCHOR_PRECISION_VALUES = Object.freeze(['developer-annotation']);
export const TEXT_AGREEMENT_VALUES = Object.freeze(['agrees', 'developer-corrected', 'differs']);
export const MARKER_SELECTOR = '.house-marker';

/**
 * Layer registry. A layer only gets a renderer when its dataset exists.
 * Future exploration and dungeon layers add an entry here together with their
 * own dataset; the housing layer must not fabricate markers for them.
 */
export const LAYER_RENDERERS = Object.freeze({
  housing: renderHousingLayer,
});

/* ------------------------------------------------------------------------- */
/* Pure helpers                                                              */
/* ------------------------------------------------------------------------- */

export function isSafeHttpUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function normalizeSearchText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function housesInMarketOrder(houses) {
  return (Array.isArray(houses) ? houses : [])
    .map((house, index) => ({ house, index }))
    .sort((a, b) => {
      const orderA = Number.isInteger(a.house?.order) ? a.house.order : Number.MAX_SAFE_INTEGER;
      const orderB = Number.isInteger(b.house?.order) ? b.house.order : Number.MAX_SAFE_INTEGER;
      return orderA - orderB || a.index - b.index;
    })
    .map((entry) => entry.house);
}

export function unplacedReasonFor(house, reasons) {
  if (!house || house.areaId || !reasons || typeof reasons !== 'object') return null;
  if (typeof reasons[house.id] === 'string') return reasons[house.id];
  const camelCaseId = String(house.id ?? '').replace(/-([a-z0-9])/g, (_, letter) => letter.toUpperCase());
  if (camelCaseId && typeof reasons[camelCaseId] === 'string') return reasons[camelCaseId];
  return null;
}

export function filterHouses(houses, areas, options = {}) {
  const byId = new Map((Array.isArray(areas) ? areas : []).map((area) => [area.id, area]));
  const placement = PLACEMENT_VALUES.includes(options.placement) ? options.placement : 'all';
  const tokens = normalizeSearchText(options.query).split(' ').filter(Boolean);

  return housesInMarketOrder(houses).filter((house) => {
    if (!house || typeof house !== 'object') return false;
    const placed = isPlacedOnMap(house);
    if (placement === 'placed' && !placed) return false;
    if (placement === 'unplaced' && placed) return false;
    if (tokens.length === 0) return true;
    const area = house.areaId ? byId.get(house.areaId) : null;
    const haystack = normalizeSearchText(
      [house.name, house.location, area?.name].filter(Boolean).join(' '),
    );
    return tokens.every((token) => haystack.includes(token));
  });
}

/**
 * A home is on the map when it has a developer anchor or a named catalogue
 * area. Anchor-first: an anchor is the position; the area is context.
 */
export function isPlacedOnMap(house) {
  if (!house || typeof house !== 'object') return false;
  return Boolean(validAnchor(house.anchor) || house.areaId);
}

/**
 * Accepts an anchor only when it is a finite, normalized point inside the
 * image. Anything else (missing, strings, NaN, Infinity, out of range) is
 * treated as no anchor rather than being projected onto the map.
 */
export function validAnchor(anchor) {
  if (!anchor || typeof anchor !== 'object' || Array.isArray(anchor)) return null;
  for (const key of ['x', 'y']) {
    if (!Number.isFinite(anchor[key]) || anchor[key] < 0 || anchor[key] > 1) return null;
  }
  return anchor;
}

export function mapAspectRatio(map) {
  const width = Number(map?.width);
  const height = Number(map?.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 0;
  return width / height;
}

/**
 * Largest box with the given aspect ratio that fits inside a viewport.
 * Used for the map stage so normalized coordinates never stretch.
 */
export function containFit(viewportWidth, viewportHeight, aspect) {
  if (!(viewportWidth > 0) || !(viewportHeight > 0) || !(aspect > 0)) {
    return { width: 0, height: 0 };
  }
  if (viewportWidth / aspect <= viewportHeight) {
    return { width: viewportWidth, height: viewportWidth / aspect };
  }
  return { width: viewportHeight * aspect, height: viewportHeight };
}

/** Center when the scaled map is smaller than the viewport; otherwise clamp. */
export function clampPanAxis(offset, scaledSize, viewportSize) {
  if (!(scaledSize > viewportSize)) return (viewportSize - scaledSize) / 2;
  return Math.max(viewportSize - scaledSize, Math.min(0, offset));
}

function roundPercent(value) {
  return Math.round(value * 100000) / 1000;
}

export function markerPosition(area) {
  return { left: roundPercent(area.x), top: roundPercent(area.y) };
}

/** Anchors use the same normalized model as areas: fractions of the image. */
export function anchorPosition(anchor) {
  return { left: roundPercent(anchor.x), top: roundPercent(anchor.y) };
}

export function markerNumberLabel(anchor) {
  return `Marker ${anchor.markerNumber}`;
}

/**
 * Coordinate provenance and textual-place agreement are separate facts.
 * `textAgreement` says how the annotated position relates to the catalogue
 * wording; it never changes or re-derives the coordinates.
 */
export function textAgreementLabel(value) {
  if (value === 'agrees') return 'Catalogue wording agrees';
  if (value === 'developer-corrected') return 'Developer correction over the catalogue wording';
  if (value === 'differs') return 'Text/map discrepancy recorded';
  return 'Catalogue agreement not recorded';
}

export function textAgreementShort(value) {
  if (value === 'developer-corrected') return 'developer correction over the wording';
  if (value === 'differs') return 'text/map discrepancy recorded';
  return '';
}

export function coordinateSourceLabel(coordinateSource) {
  if (!coordinateSource || typeof coordinateSource !== 'object') return 'Position source not recorded';
  const label =
    typeof coordinateSource.label === 'string' && coordinateSource.label
      ? coordinateSource.label
      : 'Position source';
  const published = typeof coordinateSource.published === 'string' ? coordinateSource.published : '';
  return published ? `${label}, ${published}` : label;
}

export function annotationUncertaintyText(coordinateSource) {
  const x = Number(coordinateSource?.uncertaintyX);
  const y = Number(coordinateSource?.uncertaintyY);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return '';
  return `±${x.toFixed(5)} × ±${y.toFixed(5)} of the map`;
}

export const PRECISION_VALUES = ['approximate-city', 'approximate-region'];

export function precisionLabel(precision) {
  if (precision === 'approximate-city') return 'Approximate city';
  if (precision === 'approximate-region') return 'Approximate region';
  if (precision === 'approximate-city-or-region') return 'Approximate city or region';
  return 'Approximate area';
}

export function formatGold(priceGold) {
  const value = Number(priceGold);
  if (!Number.isFinite(value)) return 'Price not listed';
  if (value === 0) return 'Free';
  return `${GOLD_FORMAT.format(value)} gold`;
}

export function capacityLabel(companionCapacity) {
  const value = Number(companionCapacity);
  if (!Number.isFinite(value)) return 'Not listed';
  return `${GOLD_FORMAT.format(value)} companion${value === 1 ? '' : 's'}`;
}

/**
 * Canonical public URL for a wiki page: revision pins (oldid) and similar
 * query parameters belong in internal verification records, not in links the
 * site publishes. Returns null for unsafe or unparsable URLs.
 */
export function canonicalPublicUrl(url) {
  if (!isSafeHttpUrl(url)) return null;
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete('oldid');
    if (parsed.searchParams.toString() === '') parsed.search = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

export function sourceLabel(url) {
  if (!isSafeHttpUrl(url)) return 'Source';
  try {
    const page = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '').replace(/_/g, ' ');
    if (page === 'Grand Homestead Market') return 'Grand Homestead Market catalogue';
    if (page.startsWith('File:')) return 'Aclaria world map file page';
    return page || 'Source';
  } catch {
    return 'Source';
  }
}

export function areaLabel(area) {
  return `Area ${area.number}: ${area.name}`;
}

/* ------------------------------------------------------------------------- */
/* Data validation                                                           */
/* ------------------------------------------------------------------------- */

/**
 * Anchor checks: the coordinates must be finite normalized numbers inside the
 * image, marker numbers must be unique per catalogue home, uncertainty must be
 * the annotation's own precision, and any wording/map difference must carry a
 * visible note. Problems are reported, never silently repaired.
 */
function addAnchorProblems(house, id, declaredUncertainty, markerNumbers, add) {
  const anchor = house.anchor;
  if (anchor === undefined || anchor === null) return;
  if (typeof anchor !== 'object' || Array.isArray(anchor)) {
    add(`House ${id} anchor is not an object.`);
    return;
  }
  if (!Number.isInteger(anchor.markerNumber) || anchor.markerNumber < 1) {
    add(`House ${id} anchor needs a positive integer marker number.`);
  } else if (markerNumbers.has(anchor.markerNumber)) {
    add(`Duplicate anchor marker number: ${anchor.markerNumber}.`);
  } else {
    markerNumbers.add(anchor.markerNumber);
  }
  for (const key of ['x', 'y']) {
    if (!Number.isFinite(anchor[key]) || anchor[key] < 0 || anchor[key] > 1) {
      add(`House ${id} has an out-of-range anchor ${key}.`);
    }
  }
  for (const key of ['uncertaintyX', 'uncertaintyY']) {
    if (!Number.isFinite(anchor[key]) || anchor[key] <= 0) {
      add(`House ${id} has an invalid anchor ${key}.`);
      continue;
    }
    const declared = declaredUncertainty ? Number(declaredUncertainty[key]) : Number.NaN;
    if (Number.isFinite(declared) && Math.abs(declared - anchor[key]) > 1e-9) {
      add(`House ${id} anchor ${key} does not match the declared annotation uncertainty.`);
    }
  }
  if (typeof anchor.precision !== 'string' || !ANCHOR_PRECISION_VALUES.includes(anchor.precision)) {
    add(`House ${id} anchor needs a supported precision (${ANCHOR_PRECISION_VALUES.join(' or ')}).`);
  }
  if (typeof anchor.provenance !== 'string' || !anchor.provenance.trim()) {
    add(`House ${id} anchor needs a recorded coordinate source.`);
  }
  if (
    typeof anchor.textAgreement !== 'string' ||
    !TEXT_AGREEMENT_VALUES.includes(anchor.textAgreement)
  ) {
    add(`House ${id} anchor needs a supported text agreement value (${TEXT_AGREEMENT_VALUES.join(', ')}).`);
  } else if (
    anchor.textAgreement !== 'agrees' &&
    (typeof anchor.discrepancy !== 'string' || !anchor.discrepancy.trim())
  ) {
    add(`House ${id} records a text/map difference without a visible note.`);
  }
  if (anchor.placeNote !== undefined && (typeof anchor.placeNote !== 'string' || !anchor.placeNote.trim())) {
    add(`House ${id} has an empty anchor place note.`);
  }
}

export function validateSiteData(data) {
  const problems = [];
  const add = (message) => problems.push(message);

  if (!data || typeof data !== 'object') return ['Data root is not an object.'];
  if (typeof data.schema !== 'string' || !data.schema) add('Missing schema identifier.');
  if (typeof data.updated !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.updated)) {
    add('Missing or invalid updated date.');
  }

  const map = data.map;
  if (!map || typeof map !== 'object') {
    add('Missing map metadata.');
  } else {
    if (!Number.isInteger(map.width) || map.width <= 0) add('Map width must be a positive integer.');
    if (!Number.isInteger(map.height) || map.height <= 0) add('Map height must be a positive integer.');
    if (typeof map.image !== 'string' || !map.image) add('Map image path is missing.');
    if (!isSafeHttpUrl(map.source)) add('Map source must be an http(s) URL.');
  }

  const houses = Array.isArray(data.houses) ? data.houses : [];
  const areas = Array.isArray(data.areas) ? data.areas : [];
  if (!Array.isArray(data.houses)) add('Houses must be an array.');
  if (!Array.isArray(data.areas)) add('Areas must be an array.');

  const declaredUncertainty =
    data.coordinateSource && typeof data.coordinateSource === 'object' ? data.coordinateSource : null;

  const houseIds = new Set();
  const markerNumbers = new Set();
  houses.forEach((house, index) => {
    if (!house || typeof house !== 'object') {
      add(`House entry ${index + 1} is not an object.`);
      return;
    }
    const id = typeof house.id === 'string' && house.id ? house.id : '?';
    if (id === '?') add(`House entry ${index + 1} is missing a string id.`);
    else if (houseIds.has(id)) add(`Duplicate house id: ${id}.`);
    else houseIds.add(id);
    if (!Number.isInteger(house.order) || house.order < 1) add(`House ${id} needs a positive integer market order.`);
    if (typeof house.name !== 'string' || !house.name.trim()) add(`House ${id} needs a name.`);
    if (!Number.isInteger(house.priceGold) || house.priceGold < 0) {
      add(`House ${id} needs a non-negative integer price.`);
    }
    if (!Number.isInteger(house.companionCapacity) || house.companionCapacity < 0) {
      add(`House ${id} needs a non-negative integer companion capacity.`);
    }
    if (typeof house.location !== 'string' || !house.location.trim()) {
      add(`House ${id} needs catalogue location wording.`);
    }
    if (!isSafeHttpUrl(house.source)) add(`House ${id} needs an http(s) source.`);
    if (house.areaId !== null && typeof house.areaId !== 'string') {
      add(`House ${id} has an invalid area reference.`);
    }
    addAnchorProblems(house, id, declaredUncertainty, markerNumbers, add);
  });

  const seenOrders = new Set();
  let previousOrder = 0;
  for (const house of houses) {
    if (!Number.isInteger(house?.order)) continue;
    if (seenOrders.has(house.order)) add('House market order values must be unique.');
    seenOrders.add(house.order);
    if (house.order < previousOrder) add('Houses are not stored in the original market order.');
    previousOrder = house.order;
  }

  const areaIds = new Set();
  const areaNumbers = new Set();
  for (const area of areas) {
    if (!area || typeof area !== 'object') {
      add('Area entry is not an object.');
      continue;
    }
    const id = typeof area.id === 'string' && area.id ? area.id : '?';
    if (id === '?') add('Area entry is missing a string id.');
    else if (areaIds.has(id)) add(`Duplicate area id: ${id}.`);
    else areaIds.add(id);
    if (!Number.isInteger(area.number) || area.number < 1) add(`Area ${id} needs a positive integer number.`);
    else if (areaNumbers.has(area.number)) add(`Duplicate area number: ${area.number}.`);
    else areaNumbers.add(area.number);
    if (typeof area.name !== 'string' || !area.name.trim()) add(`Area ${id} needs a name.`);
    if (typeof area.precision !== 'string' || !PRECISION_VALUES.includes(area.precision)) {
      add(`Area ${id} needs a supported precision label (${PRECISION_VALUES.join(' or ')}).`);
    }
    for (const key of ['x', 'y']) {
      if (!Number.isFinite(area[key]) || area[key] < 0 || area[key] > 1) {
        add(`Area ${id} has an out-of-range ${key} coordinate.`);
      }
    }
    for (const key of ['radiusX', 'radiusY']) {
      if (!Number.isFinite(area[key]) || area[key] <= 0) {
        add(`Area ${id} has an invalid ${key}.`);
      }
    }
    if (
      Number.isFinite(area.x) &&
      Number.isFinite(area.y) &&
      Number.isFinite(area.radiusX) &&
      Number.isFinite(area.radiusY)
    ) {
      const epsilon = 1e-6;
      if (area.x - area.radiusX < -epsilon || area.x + area.radiusX > 1 + epsilon) {
        add(`Area ${id} ring extends past the map horizontally.`);
      }
      if (area.y - area.radiusY < -epsilon || area.y + area.radiusY > 1 + epsilon) {
        add(`Area ${id} ring extends past the map vertically.`);
      }
    }
    if (!Array.isArray(area.houseIds)) add(`Area ${id} needs a houseIds array.`);
    else {
      for (const houseId of area.houseIds) {
        if (!houseIds.has(houseId)) add(`Area ${id} references unknown house ${houseId}.`);
      }
    }
  }

  for (const house of houses) {
    if (!house || house.areaId === null || house.areaId === undefined) continue;
    if (!areaIds.has(house.areaId)) {
      add(`House ${house.id} references unknown area ${house.areaId}.`);
      continue;
    }
    const area = areas.find((candidate) => candidate.id === house.areaId);
    if (!Array.isArray(area?.houseIds) || !area.houseIds.includes(house.id)) {
      add(`House ${house.id} is not listed by area ${house.areaId}.`);
    }
  }

  const unplacedHouses = houses.filter((house) => house && !isPlacedOnMap(house));
  if (unplacedHouses.length > 0 && (!data.unplacedReason || typeof data.unplacedReason !== 'object')) {
    add('Unplaced homes need a recorded reason.');
  }
  for (const house of unplacedHouses) {
    if (!unplacedReasonFor(house, data.unplacedReason)) {
      add(`Unplaced house ${house?.id ?? '?'} has no recorded reason.`);
    }
  }

  const anchoredHouses = houses.filter((house) => house && house.anchor);
  if (anchoredHouses.length > 0) {
    if (!declaredUncertainty) {
      add('Anchored homes need a declared coordinate source.');
    } else {
      if (
        typeof declaredUncertainty.kind !== 'string' ||
        !ANCHOR_PRECISION_VALUES.includes(declaredUncertainty.kind)
      ) {
        add(`The declared coordinate source needs a supported kind (${ANCHOR_PRECISION_VALUES.join(', ')}).`);
      }
      for (const key of ['label', 'published']) {
        if (typeof declaredUncertainty[key] !== 'string' || !declaredUncertainty[key].trim()) {
          add(`The declared coordinate source needs a ${key}.`);
        }
      }
      for (const key of ['uncertaintyX', 'uncertaintyY']) {
        if (!Number.isFinite(declaredUncertainty[key]) || declaredUncertainty[key] <= 0) {
          add(`The declared coordinate source needs a positive ${key}.`);
        }
      }
    }
  }

  const layers = Array.isArray(data.layers) ? data.layers : [];
  if (!Array.isArray(data.layers)) add('Layers must be an array.');
  const layerIds = new Set();
  for (const layer of layers) {
    if (!layer || typeof layer !== 'object') {
      add('Layer entry is not an object.');
      continue;
    }
    if (typeof layer.id !== 'string' || !layer.id) add('Layer entry is missing an id.');
    else if (layerIds.has(layer.id)) add(`Duplicate layer id: ${layer.id}.`);
    else layerIds.add(layer.id);
    if (typeof layer.label !== 'string' || !layer.label.trim()) add(`Layer ${layer.id ?? '?'} needs a label.`);
    if (typeof layer.enabled !== 'boolean') add(`Layer ${layer.id ?? '?'} needs an enabled flag.`);
    if (layer.enabled && !LAYER_RENDERERS[layer.id]) {
      add(`Enabled layer ${layer.id} has no renderer in this build.`);
    }
  }
  const housingLayer = layers.find((layer) => layer?.id === 'housing');
  if (!housingLayer || housingLayer.enabled !== true) add('The housing layer must exist and be enabled.');

  return problems;
}

/* ------------------------------------------------------------------------- */
/* DOM builders (document is injected so tests can use a minimal stub)       */
/* ------------------------------------------------------------------------- */

function element(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function chip(doc, text, className = 'chip') {
  return element(doc, 'span', className, text);
}

function appendFact(doc, list, term, value) {
  const row = element(doc, 'div', 'fact');
  row.append(element(doc, 'dt', undefined, term), element(doc, 'dd', undefined, value));
  list.append(row);
}

export function renderLayerChips(doc, container, layers) {
  container.replaceChildren();
  for (const layer of Array.isArray(layers) ? layers : []) {
    if (!layer || !layer.enabled) continue;
    container.append(element(doc, 'li', undefined, layer.label));
  }
  return container.children.length;
}

/**
 * Accessible name for one home marker: the home, its marker number, the
 * approximate area kept as context, and any wording/map difference.
 */
export function houseMarkerLabel(house, anchor, area) {
  const parts = [`Marker ${anchor.markerNumber}: ${house.name}`, 'developer-annotated position'];
  if (area) {
    parts.push(`${areaLabel(area)} (${precisionLabel(area.precision).toLowerCase()} context)`);
  }
  if (anchor.textAgreement !== 'agrees') {
    parts.push(`${textAgreementShort(anchor.textAgreement)} — see details`);
  }
  return `${parts.join('; ')}.`;
}

/**
 * Fallback label for a home that has no individual annotation: its position
 * can only come from the approximate catalogue area, and the label says so.
 */
function approximateHouseMarkerLabel(house, area) {
  return `Approximate position for ${house.name}: ${areaLabel(area)} (${
    precisionLabel(area.precision).toLowerCase()
  } from the catalogue wording, not an individual annotation).`;
}

/**
 * The housing layer draws exactly one marker per catalogue home — the
 * developer's annotated position. A home that has no anchor yet falls back to
 * its approximate catalogue area, and that fallback marker is drawn hollow,
 * labelled "~" and named as approximate; it carries no number, so the map never
 * presents a second numbering. Marker numbers are the annotation's own badge
 * numbers, in market order. Positions are never nudged apart: the list, the
 * details panel and zoom are the flow for closely spaced markers.
 */
export function renderHouseMarkers(doc, container, houses, areas = []) {
  const byId = new Map((Array.isArray(areas) ? areas : []).map((area) => [area.id, area]));
  let rendered = 0;
  for (const house of housesInMarketOrder(houses)) {
    if (!house || typeof house !== 'object' || typeof house.id !== 'string') continue;
    const anchor = validAnchor(house.anchor);
    const area = house.areaId ? byId.get(house.areaId) ?? null : null;
    const position = anchor ? anchorPosition(anchor) : area ? markerPosition(area) : null;
    if (!position) continue;
    const button = element(
      doc,
      'button',
      anchor ? 'house-marker' : 'house-marker house-marker--approximate',
    );
    button.type = 'button';
    button.dataset.houseId = house.id;
    if (anchor) button.dataset.markerNumber = String(anchor.markerNumber);
    button.setAttribute('aria-pressed', 'false');
    button.setAttribute(
      'aria-label',
      anchor ? houseMarkerLabel(house, anchor, area) : approximateHouseMarkerLabel(house, area),
    );
    button.style.left = `${position.left}%`;
    button.style.top = `${position.top}%`;
    button.append(
      element(doc, 'span', 'house-marker__badge', anchor ? String(anchor.markerNumber) : '~'),
    );
    container.append(button);
    rendered += 1;
  }
  return rendered;
}

function unplacedCardText(house, reasons) {
  const reason = unplacedReasonFor(house, reasons);
  return reason ? `Not yet placed on the map: ${reason}` : 'Not yet placed on the map';
}

/** One line for the card: anchor first, catalogue area as context. */
export function houseCardWhere(house, area, anchor) {
  if (!anchor) return area ? `${area.name} · approximate area` : null;
  const place = area ? `${area.name} · ` : '';
  const short = textAgreementShort(anchor.textAgreement);
  return `${place}developer-annotated position${short ? ` · ${short}` : ''}`;
}

export function buildHouseItem(doc, house, area, options = {}) {
  const anchor = validAnchor(house.anchor);
  const item = element(doc, 'li', 'house-item');
  item.dataset.houseId = house.id;
  if (!anchor && !area) item.classList.add('house-item--unplaced');
  if (anchor) item.dataset.markerNumber = String(anchor.markerNumber);

  const card = element(doc, 'button', 'house-card');
  card.type = 'button';
  card.dataset.houseId = house.id;
  if (area) card.dataset.areaId = area.id;
  if (anchor) card.dataset.markerNumber = String(anchor.markerNumber);

  const badgeText = anchor
    ? `Marker ${anchor.markerNumber}`
    : area
      ? 'Approx. area'
      : 'Not yet placed';
  const head = element(doc, 'span', 'house-card__head');
  head.append(
    element(doc, 'span', 'house-card__name', house.name),
    element(doc, 'span', 'house-card__area', badgeText),
  );
  const meta = element(
    doc,
    'span',
    'house-card__meta',
    `${formatGold(house.priceGold)} · ${capacityLabel(house.companionCapacity)}`,
  );
  const where = element(
    doc,
    'span',
    'house-card__where',
    houseCardWhere(house, area, anchor) ?? unplacedCardText(house, options.reasons),
  );

  card.append(head, meta, where);
  item.append(card);
  return item;
}

export function renderHouseList(doc, container, houses, areas, options = {}) {
  const byId = new Map((Array.isArray(areas) ? areas : []).map((area) => [area.id, area]));
  container.replaceChildren();
  for (const house of housesInMarketOrder(houses)) {
    if (!house || typeof house !== 'object' || typeof house.id !== 'string') continue;
    const area = house.areaId ? byId.get(house.areaId) ?? null : null;
    container.append(buildHouseItem(doc, house, area, { reasons: options.reasons }));
  }
  return container.children.length;
}

export function renderHouseDetails(doc, container, view) {
  const { house, area = null, reason = null, coordinateSource = null } = view ?? {};
  if (!house) throw new Error('renderHouseDetails needs a house.');
  const anchor = validAnchor(house.anchor);
  container.replaceChildren();

  const eyebrow = element(doc, 'p', 'details__eyebrow', 'Selected home');
  const title = element(doc, 'h2', 'details__title', house.name);
  const chips = element(doc, 'div', 'chips');
  const positionChip = anchor
    ? chip(doc, markerNumberLabel(anchor))
    : area
      ? chip(doc, 'Approximate position', 'chip chip--uncertain')
      : chip(doc, 'Not yet placed', 'chip chip--warning');
  const sourceChip = anchor
    ? chip(doc, 'Developer annotation', 'chip chip--uncertain')
    : area
      ? chip(doc, 'No individual annotation', 'chip chip--warning')
      : chip(doc, 'No map marker', 'chip chip--warning');
  chips.append(
    positionChip,
    sourceChip,
    area
      ? chip(doc, `Area ${area.number}: ${area.name}`)
      : chip(doc, 'No catalogue area', 'chip chip--warning'),
  );
  if (anchor && anchor.textAgreement !== 'agrees') {
    chips.append(chip(doc, textAgreementLabel(anchor.textAgreement), 'chip chip--warning'));
  }

  const facts = element(doc, 'dl', 'facts');
  appendFact(doc, facts, 'Price', formatGold(house.priceGold));
  appendFact(doc, facts, 'Companion capacity', capacityLabel(house.companionCapacity));
  if (anchor) {
    const uncertainty = annotationUncertaintyText(coordinateSource);
    if (uncertainty) appendFact(doc, facts, 'Position uncertainty', uncertainty);
    appendFact(doc, facts, 'Position source', coordinateSourceLabel(coordinateSource));
  } else if (area) {
    appendFact(
      doc,
      facts,
      'Position',
      `${areaLabel(area)} (${precisionLabel(area.precision).toLowerCase()} from the catalogue wording)`,
    );
  }

  const caption = element(doc, 'p', 'catalogue-quote__caption', 'Location');
  const quote = element(
    doc,
    'blockquote',
    'catalogue-quote',
    house.location ? `“${house.location}”` : 'No location wording recorded.',
  );

  const notes = [];
  if (anchor?.placeNote) {
    notes.push(element(doc, 'p', 'details__note details__note--place', anchor.placeNote));
  }
  if (anchor?.discrepancy) {
    notes.push(element(doc, 'p', 'details__note details__note--discrepancy', anchor.discrepancy));
  }

  const note = element(
    doc,
    'p',
    'details__note',
    anchor
      ? `Marker ${anchor.markerNumber} is the developer's hand-placed annotation for this home, not an in-game coordinate, address or property boundary.${
          area
            ? ` The catalogue wording names ${area.name}, an ${precisionLabel(
                area.precision,
              ).toLowerCase()} kept as context in this list and panel; the map draws only the numbered home markers.`
            : ''
        }`
      : area
        ? `${areaLabel(area)} is an ${precisionLabel(area.precision).toLowerCase()} from the catalogue wording. The map shows an approximate fallback marker for this home at that area, not its exact position, address or property boundary.`
        : `No marker is shown for this home. ${reason ?? 'The catalogue wording does not identify a confident map area.'} No coordinates are inferred.`,
  );

  const actions = element(doc, 'div', 'details__actions');
  if (anchor) {
    const button = element(doc, 'button', 'button', 'Show marker on map');
    button.type = 'button';
    button.dataset.action = 'show-marker';
    button.dataset.houseId = house.id;
    actions.append(button);
  }
  const back = element(doc, 'button', 'button button--ghost', 'Back to list');
  back.type = 'button';
  back.dataset.action = 'back-to-list';
  actions.append(back);

  const source = element(doc, 'p', 'details__source');
  const canonicalSource = canonicalPublicUrl(house.source);
  if (canonicalSource) {
    const label = element(doc, 'span', undefined, 'Source: ');
    const link = element(doc, 'a', undefined, sourceLabel(canonicalSource));
    link.href = canonicalSource;
    link.rel = 'noopener noreferrer';
    source.append(label, link);
  } else {
    source.textContent = 'Source link unavailable in this record.';
  }

  /* Placement notes are a footnote: the marker-provenance sentence and the
     annotation-vs-catalogue comparison sit beneath the primary details, actions
     and source, in a native disclosure. The disclosure opens by itself whenever
     the data records a divergence, so a real discrepancy is never hidden behind
     an extra tap while routine placement prose stays out of the way. */
  const placementNotes = element(doc, 'details', 'details__placement-notes');
  placementNotes.open = Boolean(anchor && anchor.textAgreement !== 'agrees');
  const placementBody = element(doc, 'div', 'details__placement-notes__body');
  placementBody.append(...notes, note);
  placementNotes.append(
    element(doc, 'summary', 'details__placement-notes__summary', 'Placement notes'),
    placementBody,
  );

  container.append(eyebrow, title, chips, facts, caption, quote, actions, source, placementNotes);
}

/* ------------------------------------------------------------------------- */
/* Browser application                                                       */
/* ------------------------------------------------------------------------- */

const ui = {};
const model = {
  data: null,
  areas: new Map(),
  houses: new Map(),
  query: '',
  placement: 'all',
  selectedHouseId: null,
  visible: [],
};
let mapController = null;
let announceTimer = 0;

function collectUi() {
  const ids = {
    mapViewport: 'map-viewport',
    mapStage: 'map-stage',
    mapImage: 'map-image',
    areaLayer: 'area-layer',
    layerList: 'layer-list',
    zoomIn: 'zoom-in',
    zoomOut: 'zoom-out',
    mapReset: 'map-reset',
    zoomLevel: 'zoom-level',
    immersionToggle: 'immersion-toggle',
    immersionStatus: 'immersion-status',
    dataNotice: 'data-notice',
    loadError: 'load-error',
    detailsPanel: 'details-panel',
    detailsEmpty: 'details-empty',
    detailsContent: 'details-content',
    searchInput: 'search-input',
    searchClear: 'search-clear',
    listStatus: 'list-status',
    houseList: 'house-list',
    listEmpty: 'list-empty',
    dataUpdated: 'data-updated',
    status: 'app-status',
  };
  const missing = [];
  for (const [key, id] of Object.entries(ids)) {
    ui[key] = document.getElementById(id);
    if (!ui[key]) missing.push(id);
  }
  if (missing.length > 0) throw new Error(`Missing page elements: ${missing.join(', ')}`);
  ui.filters = Array.from(document.querySelectorAll('.filter'));
}

async function loadSiteData() {
  const response = await fetch(DATA_URL, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Could not load housing data (HTTP ${response.status}).`);
  return response.json();
}

function motionBehavior() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
}

function isNarrowScreen() {
  return window.matchMedia('(max-width: 919px)').matches;
}

function announce(message) {
  if (!ui.status) return;
  window.clearTimeout(announceTimer);
  ui.status.textContent = '';
  announceTimer = window.setTimeout(() => {
    ui.status.textContent = message;
  }, 40);
}

function renderLayers() {
  ui.areaLayer.replaceChildren();
  const enabled = model.data.layers.filter((layer) => layer.enabled);
  for (const layer of enabled) {
    const renderer = LAYER_RENDERERS[layer.id];
    if (!renderer) continue;
    renderer(document, ui.areaLayer, model.data);
  }
}

/**
 * The housing layer is a single numbered house-marker layer. Named approximate
 * areas stay in the data, in search and in the list/details context; they are
 * deliberately not drawn as rings or as a second set of numbers.
 */
function renderHousingLayer(doc, container, data) {
  renderHouseMarkers(doc, container, data.houses, data.areas);
}

function updateMapChrome({ zoom }) {
  ui.zoomLevel.textContent = `${Math.round(zoom * 100)}%`;
  ui.zoomIn.disabled = zoom >= ZOOM_MAX;
  ui.zoomOut.disabled = zoom <= ZOOM_MIN;
}

function showDetails(house) {
  ui.detailsEmpty.hidden = true;
  ui.detailsContent.hidden = false;
  const area = house.areaId ? model.areas.get(house.areaId) ?? null : null;
  renderHouseDetails(document, ui.detailsContent, {
    house,
    area,
    reason: area ? null : unplacedReasonFor(house, model.data.unplacedReason),
    coordinateSource: model.data.coordinateSource ?? null,
  });
}

function showEmptyDetails() {
  ui.detailsContent.hidden = true;
  ui.detailsContent.replaceChildren();
  ui.detailsEmpty.hidden = false;
}

function syncSelection() {
  const selectedHouse = model.selectedHouseId
    ? model.houses.get(model.selectedHouseId) ?? null
    : null;
  const relatedAreaId = selectedHouse?.areaId ?? null;

  for (const marker of ui.areaLayer.querySelectorAll(MARKER_SELECTOR)) {
    const selected = marker.dataset.houseId === model.selectedHouseId;
    marker.setAttribute('aria-pressed', String(selected));
  }

  for (const card of ui.houseList.querySelectorAll('.house-card')) {
    const item = card.closest('li');
    const selected = card.dataset.houseId === model.selectedHouseId;
    if (selected) card.setAttribute('aria-current', 'true');
    else card.removeAttribute('aria-current');
    item?.classList.toggle('is-selected', selected);
    item?.classList.toggle(
      'is-related',
      !selected && Boolean(relatedAreaId) && card.dataset.areaId === relatedAreaId,
    );
  }
}

function revealDetailsIfNeeded() {
  if (!isNarrowScreen()) return;
  const rect = ui.detailsPanel.getBoundingClientRect();
  if (rect.top >= 0 && rect.bottom <= window.innerHeight) return;
  ui.detailsPanel.scrollIntoView({ block: 'start', behavior: motionBehavior() });
}

function selectHouse(houseId) {
  const house = model.houses.get(houseId);
  if (!house) return;
  const anchor = validAnchor(house.anchor);
  model.selectedHouseId = house.id;
  const area = house.areaId ? model.areas.get(house.areaId) ?? null : null;
  showDetails(house);
  syncSelection();
  const parts = [`${house.name}.`];
  if (anchor) {
    parts.push(`Marker ${anchor.markerNumber}, developer-annotated position.`);
    if (anchor.textAgreement !== 'agrees') parts.push(`${textAgreementLabel(anchor.textAgreement)}.`);
  } else if (area) {
    parts.push('Approximate fallback position from its catalogue area, not an individual annotation.');
  } else {
    parts.push('Not yet placed on the map.');
  }
  if (area) parts.push(`${areaLabel(area)}, approximate area context.`);
  announce(parts.join(' '));
  revealDetailsIfNeeded();
}

function backToList() {
  const card = model.selectedHouseId
    ? [...ui.houseList.querySelectorAll('.house-card')].find(
        (candidate) => candidate.dataset.houseId === model.selectedHouseId,
      )
    : null;
  const target = card ?? ui.houseList;
  target.scrollIntoView({ block: 'center', behavior: motionBehavior() });
  if (card) card.focus({ preventScroll: true });
}

function clearSelection() {
  model.selectedHouseId = null;
  showEmptyDetails();
  syncSelection();
  announce('Selection cleared.');
}

function revealMapIfNeeded() {
  if (isNarrowScreen()) {
    ui.mapViewport.scrollIntoView({ block: 'center', behavior: motionBehavior() });
  }
}

function showHouseOnMap(houseId) {
  const house = model.houses.get(houseId);
  const anchor = house ? validAnchor(house.anchor) : null;
  if (!house || !anchor || !mapController) return;
  mapController.centerOnPoint(anchor, Math.max(mapController.getZoom(), 2));
  announce(
    `Marker ${anchor.markerNumber}: ${house.name} centered on the map. The position is the developer's annotation, not a precise address.`,
  );
  revealMapIfNeeded();
}

function updateSearchClear() {
  ui.searchClear.hidden = model.query.length === 0;
}

function applyFilters() {
  model.visible = filterHouses(model.data.houses, model.data.areas, {
    query: model.query,
    placement: model.placement,
  });
  renderHouseList(document, ui.houseList, model.visible, model.data.areas, {
    reasons: model.data.unplacedReason,
  });

  const filtering = model.query.trim() !== '' || model.placement !== 'all';
  ui.listStatus.textContent = filtering
    ? `${model.visible.length} ${model.visible.length === 1 ? 'home' : 'homes'} match.`
    : '';
  ui.listEmpty.hidden = model.visible.length > 0;

  if (
    model.selectedHouseId &&
    !model.visible.some((house) => house.id === model.selectedHouseId)
  ) {
    model.selectedHouseId = null;
    showEmptyDetails();
  }

  syncSelection();
  updateSearchClear();
}

function updateFilterButtons() {
  for (const button of ui.filters) {
    button.setAttribute('aria-pressed', String(button.dataset.placement === model.placement));
  }
}

function showDataNotice(problems) {
  console.warn('Housing data validation problems:', problems);
  ui.dataNotice.hidden = false;
  ui.dataNotice.replaceChildren();
  const title = document.createElement('strong');
  title.textContent = 'Some housing records failed a consistency check. ';
  const body = document.createElement('span');
  body.textContent =
    'The page still shows every record it can read, without adding placements. See the project report for details.';
  ui.dataNotice.append(title, body);
}

function showLoadError(error) {
  console.error(error);
  ui.loadError.hidden = false;
  ui.loadError.textContent =
    'Could not load data/housing.json. Open this site through a local web server (for example "python -m http.server" from the repository root) or the published GitHub Pages URL, then reload.';
}

function bindStaticEvents() {
  ui.searchInput.addEventListener('input', () => {
    model.query = ui.searchInput.value;
    applyFilters();
  });
  ui.searchInput.addEventListener('search', () => {
    model.query = ui.searchInput.value;
    applyFilters();
  });
  ui.searchClear.addEventListener('click', () => {
    model.query = '';
    ui.searchInput.value = '';
    applyFilters();
    ui.searchInput.focus();
  });
  ui.searchInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || model.query === '') return;
    event.preventDefault();
    model.query = '';
    ui.searchInput.value = '';
    applyFilters();
  });

  for (const button of ui.filters) {
    button.addEventListener('click', () => {
      model.placement = button.dataset.placement;
      updateFilterButtons();
      applyFilters();
    });
  }

  ui.houseList.addEventListener('click', (event) => {
    const card = event.target.closest?.('.house-card');
    if (card) selectHouse(card.dataset.houseId);
  });

  ui.areaLayer.addEventListener('click', (event) => {
    const houseMarker = event.target.closest?.('.house-marker');
    if (houseMarker) selectHouse(houseMarker.dataset.houseId);
  });

  ui.detailsContent.addEventListener('click', (event) => {
    const target = event.target.closest?.('button');
    if (!target) return;
    if (target.dataset.action === 'show-marker') showHouseOnMap(target.dataset.houseId);
    else if (target.dataset.action === 'back-to-list') backToList();
    else if (target.dataset.houseId) selectHouse(target.dataset.houseId);
  });

  ui.zoomIn.addEventListener('click', () => mapController?.zoomIn());
  ui.zoomOut.addEventListener('click', () => mapController?.zoomOut());
  ui.mapReset.addEventListener('click', () => mapController?.reset());

  window.addEventListener('resize', () => mapController?.layout());
}

async function start() {
  collectUi();
  bindStaticEvents();

  let data;
  try {
    data = await loadSiteData();
  } catch (error) {
    showLoadError(error);
    return;
  }

  const problems = validateSiteData(data);
  if (problems.length > 0) showDataNotice(problems);
  if (!Array.isArray(data.houses) || !Array.isArray(data.areas) || !data.map) {
    ui.loadError.hidden = false;
    ui.loadError.textContent = 'The housing data is incomplete, so the map cannot be drawn.';
    return;
  }

  const aspect = mapAspectRatio(data.map);
  if (!(aspect > 0)) {
    ui.loadError.hidden = false;
    ui.loadError.textContent = 'The map dimensions are invalid, so the map cannot be drawn.';
    return;
  }

  model.data = data;
  model.areas = new Map(data.areas.map((area) => [area.id, area]));
  model.houses = new Map(data.houses.map((house) => [house.id, house]));

  ui.dataUpdated.textContent = data.updated;
  ui.mapViewport.style.setProperty('--map-aspect', `${data.map.width} / ${data.map.height}`);
  renderLayerChips(document, ui.layerList, data.layers);
  renderLayers();

  mapController = createMapController(
    { viewport: ui.mapViewport, stage: ui.mapStage },
    aspect,
    updateMapChrome,
  );
  mapController.layout();

  showEmptyDetails();
  applyFilters();
  updateFilterButtons();

  await startImmersion();
}

/**
 * Immersion mode is optional and loaded on demand. If the module is missing
 * (an older deployed build), the toggle says so plainly and the flat map keeps
 * working; the controller itself handles unsupported/denied/no-data the same way.
 */
async function startImmersion() {
  let immersion;
  try {
    immersion = await import('./immersion.js');
  } catch {
    ui.immersionToggle.disabled = true;
    ui.immersionStatus.textContent =
      'Immersion mode could not be loaded in this build. The map stays flat.';
    return;
  }
  immersion.createImmersionController({
    stage: ui.mapStage,
    viewport: ui.mapViewport,
    button: ui.immersionToggle,
    status: ui.immersionStatus,
    getExtent: () => ({ width: ui.mapStage.offsetWidth, height: ui.mapStage.offsetHeight }),
  });
}

/* ------------------------------------------------------------------------- */
/* Map interaction: pointer pan, pinch, wheel zoom, keyboard alternatives    */
/* ------------------------------------------------------------------------- */

export function zoomTiltDegrees(zoom, reduced = false) {
  if (reduced || !Number.isFinite(zoom)) return 0;
  const t = Math.min(1, Math.max(0, (zoom - 1) / 2));
  return 8 * t * t * (3 - 2 * t);
}

export function createMapController({ viewport, stage }, aspect, onChange = () => {}) {
  let base = { width: 0, height: 0 };
  let zoom = ZOOM_MIN;
  let panX = 0;
  let panY = 0;
  let pinchStart = null;
  let gestureDistance = 0;
  let lastPointerType = 'mouse';
  let lastTap = { time: 0, x: 0, y: 0 };
  const pointers = new Map();

  const clampZoom = (value) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
  const size = () => ({ width: viewport.clientWidth, height: viewport.clientHeight });

  const motionPreference = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
  motionPreference?.addEventListener?.('change', () => apply());
  function apply() {
    const tilt = zoomTiltDegrees(zoom, motionPreference?.matches);
    stage.style.setProperty('--zoom-tilt', `${tilt}deg`);
    viewport.style.setProperty('--map-perspective', `${Math.max(1400, base.height * zoom * 8)}px`);
    viewport.classList.toggle('is-zoom-immersive', tilt > 0);
    stage.style.width = `${base.width * zoom}px`;
    stage.style.height = `${base.height * zoom}px`;
    stage.style.transform =
      `translate3d(${panX}px, ${panY}px, 0) ` +
      'rotateX(calc(var(--zoom-tilt, 0deg) + var(--immersion-rotate-x, 0deg))) rotateY(var(--immersion-rotate-y, 0deg))';
    stage.style.setProperty('--zoom', String(zoom));
    onChange({ zoom, panX, panY });
  }

  function clampPan() {
    const box = size();
    panX = clampPanAxis(panX, base.width * zoom, box.width);
    panY = clampPanAxis(panY, base.height * zoom, box.height);
  }

  function layout() {
    const box = size();
    if (!box.width || !box.height) return;
    const previous = base;
    const center =
      previous.width > 0 && previous.height > 0
        ? {
            x: (box.width / 2 - panX) / (previous.width * zoom),
            y: (box.height / 2 - panY) / (previous.height * zoom),
          }
        : { x: 0.5, y: 0.5 };
    base = containFit(box.width, box.height, aspect);
    panX = box.width / 2 - center.x * base.width * zoom;
    panY = box.height / 2 - center.y * base.height * zoom;
    clampPan();
    apply();
  }

  function setZoom(nextZoom, focalX = viewport.clientWidth / 2, focalY = viewport.clientHeight / 2) {
    const next = clampZoom(nextZoom);
    if (Math.abs(next - zoom) < 0.0001) return;
    const contentX = base.width ? (focalX - panX) / (base.width * zoom) : 0.5;
    const contentY = base.height ? (focalY - panY) / (base.height * zoom) : 0.5;
    zoom = next;
    panX = focalX - contentX * base.width * zoom;
    panY = focalY - contentY * base.height * zoom;
    clampPan();
    apply();
  }

  function reset() {
    zoom = ZOOM_MIN;
    panX = 0;
    panY = 0;
    clampPan();
    apply();
  }

  /** Centers a normalized point (house anchor or area centre) on the viewport. */
  function centerOnPoint(point, targetZoom = Math.max(zoom, 2)) {
    if (!base.width || !base.height) return;
    const box = size();
    zoom = clampZoom(targetZoom);
    panX = box.width / 2 - point.x * base.width * zoom;
    panY = box.height / 2 - point.y * base.height * zoom;
    clampPan();
    apply();
  }

  function pointOf(event) {
    return { x: event.clientX, y: event.clientY };
  }

  function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function midpoint(a, b) {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  function onPointerDown(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const target = event.target;
    if (target && typeof target.closest === 'function' && target.closest(MARKER_SELECTOR)) return;
    lastPointerType = event.pointerType || 'mouse';
    if (pointers.size === 0) gestureDistance = 0;
    pointers.set(event.pointerId, pointOf(event));
    try {
      viewport.setPointerCapture(event.pointerId);
    } catch {
      /* pointer capture is best-effort */
    }
    if (pointers.size === 2) {
      const [first, second] = [...pointers.values()];
      const rect = viewport.getBoundingClientRect();
      const middle = midpoint(first, second);
      pinchStart = {
        distance: Math.max(1, distance(first, second)),
        zoom,
        focal: { x: middle.x - rect.left, y: middle.y - rect.top },
      };
    }
    viewport.classList.add('is-dragging');
  }

  function onPointerMove(event) {
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    const next = pointOf(event);
    pointers.set(event.pointerId, next);
    const moved = Math.hypot(next.x - previous.x, next.y - previous.y);
    gestureDistance += moved;

    if (pointers.size >= 2 && pinchStart) {
      const [first, second] = [...pointers.values()].slice(0, 2);
      const rect = viewport.getBoundingClientRect();
      const middle = midpoint(first, second);
      setZoom(
        (pinchStart.zoom * distance(first, second)) / pinchStart.distance,
        middle.x - rect.left,
        middle.y - rect.top,
      );
      return;
    }

    if (pointers.size === 1) {
      const box = size();
      panX = clampPanAxis(panX + (next.x - previous.x), base.width * zoom, box.width);
      panY = clampPanAxis(panY + (next.y - previous.y), base.height * zoom, box.height);
      apply();
    }
  }

  function onPointerUp(event) {
    const tracked = pointers.delete(event.pointerId);
    if (!tracked) return;
    if (pointers.size < 2) pinchStart = null;
    if (lastPointerType === 'touch' && pointers.size === 0) {
      const rect = viewport.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const now = Date.now();
      const nearby = Math.hypot(x - lastTap.x, y - lastTap.y) < 30;
      if (gestureDistance < 14 && now - lastTap.time < 320 && nearby) {
        lastTap = { time: 0, x: 0, y: 0 };
        setZoom(zoom > 1.01 ? ZOOM_MIN : 2.5, x, y);
      } else {
        lastTap = { time: now, x, y };
      }
    }
    if (pointers.size === 0) viewport.classList.remove('is-dragging');
  }

  function onWheel(event) {
    if (event.deltaY === 0) return;
    event.preventDefault();
    const rect = viewport.getBoundingClientRect();
    setZoom(
      zoom * (event.deltaY < 0 ? 1.2 : 1 / 1.2),
      event.clientX - rect.left,
      event.clientY - rect.top,
    );
  }

  function onKeyDown(event) {
    const box = size();
    const step = event.shiftKey ? Math.max(140, box.width * 0.3) : Math.max(48, box.width * 0.08);
    let handled = true;
    switch (event.key) {
      case 'ArrowLeft':
        panX = clampPanAxis(panX + step, base.width * zoom, box.width);
        break;
      case 'ArrowRight':
        panX = clampPanAxis(panX - step, base.width * zoom, box.width);
        break;
      case 'ArrowUp':
        panY = clampPanAxis(panY + step, base.height * zoom, box.height);
        break;
      case 'ArrowDown':
        panY = clampPanAxis(panY - step, base.height * zoom, box.height);
        break;
      case '+':
      case '=':
        setZoom(zoom * 1.25);
        break;
      case '-':
      case '_':
        setZoom(zoom / 1.25);
        break;
      case '0':
      case 'Home':
        reset();
        break;
      case 'Escape':
        clearSelection();
        break;
      default:
        handled = false;
    }
    if (handled) {
      event.preventDefault();
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) apply();
    }
  }

  function onDoubleClick(event) {
    if (lastPointerType === 'touch') return;
    if (event.target?.closest?.(MARKER_SELECTOR)) return;
    const rect = viewport.getBoundingClientRect();
    setZoom(
      zoom > 1.01 ? ZOOM_MIN : 2.5,
      event.clientX - rect.left,
      event.clientY - rect.top,
    );
  }

  function onFocusIn(event) {
    const marker = event.target?.closest?.(MARKER_SELECTOR);
    if (!marker) return;
    const box = size();
    const hostRect = viewport.getBoundingClientRect();
    const markerRect = marker.getBoundingClientRect();
    const margin = 12;
    const outside =
      markerRect.left < hostRect.left + margin ||
      markerRect.right > hostRect.right - margin ||
      markerRect.top < hostRect.top + margin ||
      markerRect.bottom > hostRect.bottom - margin;
    if (!outside) return;
    panX = clampPanAxis(
      panX + (hostRect.left + hostRect.width / 2) - (markerRect.left + markerRect.width / 2),
      base.width * zoom,
      box.width,
    );
    panY = clampPanAxis(
      panY + (hostRect.top + hostRect.height / 2) - (markerRect.top + markerRect.height / 2),
      base.height * zoom,
      box.height,
    );
    apply();
  }

  viewport.addEventListener('pointerdown', onPointerDown);
  viewport.addEventListener('pointermove', onPointerMove);
  viewport.addEventListener('pointerup', onPointerUp);
  viewport.addEventListener('pointercancel', onPointerUp);
  viewport.addEventListener('wheel', onWheel, { passive: false });
  viewport.addEventListener('keydown', onKeyDown);
  viewport.addEventListener('dblclick', onDoubleClick);
  viewport.addEventListener('focusin', onFocusIn);

  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => layout()).observe(viewport);
  }

  return {
    layout,
    reset,
    centerOnPoint,
    getZoom: () => zoom,
    zoomIn: () => setZoom(zoom * 1.25),
    zoomOut: () => setZoom(zoom / 1.25),
  };
}

/* ------------------------------------------------------------------------- */
/* Bootstrap                                                                 */
/* ------------------------------------------------------------------------- */

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  start().catch((error) => {
    console.error(error);
    const notice = document.getElementById('load-error');
    if (notice) {
      notice.hidden = false;
      notice.textContent = 'The map could not start. Reload the page, or view the source data directly.';
    }
  });
}
