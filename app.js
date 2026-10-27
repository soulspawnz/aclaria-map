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
    if (placement === 'placed' && !house.areaId) return false;
    if (placement === 'unplaced' && house.areaId) return false;
    if (tokens.length === 0) return true;
    const area = house.areaId ? byId.get(house.areaId) : null;
    const haystack = normalizeSearchText(
      [house.name, house.location, area?.name].filter(Boolean).join(' '),
    );
    return tokens.every((token) => haystack.includes(token));
  });
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

/** Ring bounds in percent of the map image (radiusX is a width fraction). */
export function areaRingGeometry(area) {
  return {
    left: roundPercent(area.x - area.radiusX),
    top: roundPercent(area.y - area.radiusY),
    width: roundPercent(area.radiusX * 2),
    height: roundPercent(area.radiusY * 2),
  };
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

  const houseIds = new Set();
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

  const unplacedHouses = houses.filter((house) => house && !house.areaId);
  if (unplacedHouses.length > 0 && (!data.unplacedReason || typeof data.unplacedReason !== 'object')) {
    add('Unplaced homes need a recorded reason.');
  }
  for (const house of unplacedHouses) {
    if (!unplacedReasonFor(house, data.unplacedReason)) {
      add(`Unplaced house ${house?.id ?? '?'} has no recorded reason.`);
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

export function renderAreaRings(doc, container, areas) {
  for (const area of Array.isArray(areas) ? areas : []) {
    const geometry = areaRingGeometry(area);
    const ring = element(doc, 'div', 'area-ring');
    ring.dataset.areaId = area.id;
    ring.setAttribute('aria-hidden', 'true');
    ring.style.left = `${geometry.left}%`;
    ring.style.top = `${geometry.top}%`;
    ring.style.width = `${geometry.width}%`;
    ring.style.height = `${geometry.height}%`;
    container.append(ring);
  }
  return Array.isArray(areas) ? areas.length : 0;
}

function countHousesByArea(houses) {
  const counts = new Map();
  for (const house of Array.isArray(houses) ? houses : []) {
    if (!house?.areaId) continue;
    counts.set(house.areaId, (counts.get(house.areaId) ?? 0) + 1);
  }
  return counts;
}

function markerLabel(area, count) {
  const homes = count === 1 ? '1 home' : `${count} homes`;
  return `${areaLabel(area)}. ${precisionLabel(area.precision)}; ${homes} listed.`;
}

export function renderAreaMarkers(doc, container, areas, houses = []) {
  const counts = countHousesByArea(houses);
  for (const area of Array.isArray(areas) ? areas : []) {
    const position = markerPosition(area);
    const button = element(doc, 'button', 'marker');
    button.type = 'button';
    button.dataset.areaId = area.id;
    button.setAttribute('aria-pressed', 'false');
    button.setAttribute('aria-label', markerLabel(area, counts.get(area.id) ?? 0));
    button.style.left = `${position.left}%`;
    button.style.top = `${position.top}%`;
    button.append(element(doc, 'span', 'marker__badge', String(area.number)));
    container.append(button);
  }
  return Array.isArray(areas) ? areas.length : 0;
}

function unplacedCardText(house, reasons) {
  const reason = unplacedReasonFor(house, reasons);
  return reason ? `Not yet placed on the map: ${reason}` : 'Not yet placed on the map';
}

export function buildHouseItem(doc, house, area, options = {}) {
  const item = element(doc, 'li', 'house-item');
  item.dataset.houseId = house.id;
  if (!area) item.classList.add('house-item--unplaced');

  const card = element(doc, 'button', 'house-card');
  card.type = 'button';
  card.dataset.houseId = house.id;
  if (area) card.dataset.areaId = area.id;

  const head = element(doc, 'span', 'house-card__head');
  head.append(
    element(doc, 'span', 'house-card__name', house.name),
    element(doc, 'span', 'house-card__area', area ? `Area ${area.number}` : 'Not yet placed'),
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
    area ? `${area.name} · approximate area` : unplacedCardText(house, options.reasons),
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
  const { house, area = null, reason = null } = view ?? {};
  if (!house) throw new Error('renderHouseDetails needs a house.');
  container.replaceChildren();

  const eyebrow = element(doc, 'p', 'details__eyebrow', 'Selected home');
  const title = element(doc, 'h2', 'details__title', house.name);
  const chips = element(doc, 'div', 'chips');
  chips.append(
    chip(doc, area ? `Area ${area.number}` : 'Not yet placed', area ? 'chip' : 'chip chip--warning'),
    chip(
      doc,
      area ? precisionLabel(area.precision) : 'No map area',
      area ? 'chip chip--uncertain' : 'chip chip--warning',
    ),
  );

  const facts = element(doc, 'dl', 'facts');
  appendFact(doc, facts, 'Price', formatGold(house.priceGold));
  appendFact(doc, facts, 'Companion capacity', capacityLabel(house.companionCapacity));

  const quote = element(
    doc,
    'blockquote',
    'catalogue-quote',
    house.location ? `“${house.location}”` : 'No catalogue location wording recorded.',
  );
  const caption = element(doc, 'p', 'catalogue-quote__caption', 'Catalogue location wording');

  const note = element(
    doc,
    'p',
    'details__note',
    area
      ? `Area ${area.number} (${area.name}) is an ${precisionLabel(area.precision).toLowerCase()} from the catalogue wording. The marker and ring do not show this home's exact position, address or property boundary.`
      : `No marker is shown for this home. ${reason ?? 'The catalogue wording does not identify a confident map area.'} No coordinates are inferred.`,
  );

  const actions = element(doc, 'div', 'details__actions');
  if (area) {
    const button = element(doc, 'button', 'button', 'Show area on map');
    button.type = 'button';
    button.dataset.action = 'show-area';
    button.dataset.areaId = area.id;
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

  container.append(eyebrow, title, chips, facts, quote, caption, note, actions, source);
}

export function renderAreaDetails(doc, container, view) {
  const { area, houses = [] } = view ?? {};
  if (!area) throw new Error('renderAreaDetails needs an area.');
  container.replaceChildren();

  const eyebrow = element(doc, 'p', 'details__eyebrow', 'Selected area');
  const title = element(doc, 'h2', 'details__title', areaLabel(area));
  const chips = element(doc, 'div', 'chips');
  chips.append(
    chip(doc, `Area ${area.number}`),
    chip(doc, precisionLabel(area.precision), 'chip chip--uncertain'),
    chip(doc, 'Not an address', 'chip'),
  );

  const actions = element(doc, 'div', 'details__actions');
  const showOnMap = element(doc, 'button', 'button', 'Show this area on the map');
  showOnMap.type = 'button';
  showOnMap.dataset.action = 'show-area';
  showOnMap.dataset.areaId = area.id;
  actions.append(showOnMap);

  const note = element(
    doc,
    'p',
    'details__note',
    'The dashed ring reflects the broad radius recorded for this area. It is data about the catalogue wording, not proof of a house location or a property boundary.',
  );

  const heading = element(doc, 'h3', undefined, 'Homes listed for this area');
  const list = element(doc, 'ul', 'area-home-list');
  const ordered = housesInMarketOrder(houses);
  for (const house of ordered) {
    const item = doc.createElement('li');
    const button = element(doc, 'button', 'link-button', `${house.name} — ${formatGold(house.priceGold)}`);
    button.type = 'button';
    button.dataset.houseId = house.id;
    item.append(button);
    list.append(item);
  }

  const foot = element(
    doc,
    'p',
    'details__source',
    'Catalogue entries in market order. Every area placement is approximate.',
  );

  container.append(eyebrow, title, chips, note, actions, heading, list);
  if (ordered.length === 0) {
    container.append(element(doc, 'p', 'empty', 'No homes are listed for this area.'));
  }
  container.append(foot);
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
  selectedAreaId: null,
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

function renderHousingLayer(doc, container, data) {
  renderAreaRings(doc, container, data.areas);
  renderAreaMarkers(doc, container, data.areas, data.houses);
}

function updateMapChrome({ zoom }) {
  ui.zoomLevel.textContent = `${Math.round(zoom * 100)}%`;
  ui.zoomIn.disabled = zoom >= ZOOM_MAX;
  ui.zoomOut.disabled = zoom <= ZOOM_MIN;
}

function showDetails(view) {
  ui.detailsEmpty.hidden = true;
  ui.detailsContent.hidden = false;
  if (view.type === 'house') {
    const { house } = view;
    const area = house.areaId ? model.areas.get(house.areaId) ?? null : null;
    renderHouseDetails(document, ui.detailsContent, {
      house,
      area,
      reason: area ? null : unplacedReasonFor(house, model.data.unplacedReason),
    });
  } else {
    renderAreaDetails(document, ui.detailsContent, {
      area: view.area,
      houses: model.data.houses.filter((house) => house.areaId === view.area.id),
    });
  }
}

function showEmptyDetails() {
  ui.detailsContent.hidden = true;
  ui.detailsContent.replaceChildren();
  ui.detailsEmpty.hidden = false;
}

function syncSelection() {
  const relatedAreaId = model.selectedHouseId ? null : model.selectedAreaId;

  for (const marker of ui.areaLayer.querySelectorAll('.marker')) {
    const selected = marker.dataset.areaId === model.selectedAreaId;
    marker.setAttribute('aria-pressed', String(selected));
  }
  for (const ring of ui.areaLayer.querySelectorAll('.area-ring')) {
    ring.classList.toggle('is-selected', ring.dataset.areaId === model.selectedAreaId);
  }

  for (const card of ui.houseList.querySelectorAll('.house-card')) {
    const item = card.closest('li');
    const selected = card.dataset.houseId === model.selectedHouseId;
    if (selected) card.setAttribute('aria-current', 'true');
    else card.removeAttribute('aria-current');
    item?.classList.toggle('is-selected', selected);
    item?.classList.toggle(
      'is-related',
      Boolean(relatedAreaId) && card.dataset.areaId === relatedAreaId,
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
  model.selectedHouseId = house.id;
  model.selectedAreaId = house.areaId ?? null;
  const area = house.areaId ? model.areas.get(house.areaId) ?? null : null;
  showDetails({ type: 'house', house });
  syncSelection();
  announce(
    area
      ? `${house.name}. ${areaLabel(area)}, approximate area.`
      : `${house.name}. Not yet placed on the map.`,
  );
  revealDetailsIfNeeded();
}

function selectArea(areaId) {
  const area = model.areas.get(areaId);
  if (!area) return;
  if (model.selectedAreaId === areaId && !model.selectedHouseId) {
    clearSelection();
    return;
  }
  model.selectedAreaId = areaId;
  model.selectedHouseId = null;
  showDetails({ type: 'area', area });
  syncSelection();
  announce(`${areaLabel(area)}. ${precisionLabel(area.precision)}.`);
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
  model.selectedAreaId = null;
  model.selectedHouseId = null;
  showEmptyDetails();
  syncSelection();
  announce('Selection cleared.');
}

function showAreaOnMap(areaId) {
  const area = model.areas.get(areaId);
  if (!area || !mapController) return;
  mapController.centerOnArea(area, Math.max(mapController.getZoom(), 2));
  announce(`${areaLabel(area)} centered on the map. The ring is approximate.`);
  if (isNarrowScreen()) {
    ui.mapViewport.scrollIntoView({ block: 'center', behavior: motionBehavior() });
  }
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
    model.selectedAreaId = null;
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
    const marker = event.target.closest?.('.marker');
    if (marker) selectArea(marker.dataset.areaId);
  });

  ui.detailsContent.addEventListener('click', (event) => {
    const target = event.target.closest?.('button');
    if (!target) return;
    if (target.dataset.action === 'show-area') showAreaOnMap(target.dataset.areaId);
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
}

/* ------------------------------------------------------------------------- */
/* Map interaction: pointer pan, pinch, wheel zoom, keyboard alternatives    */
/* ------------------------------------------------------------------------- */

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

  function apply() {
    stage.style.width = `${base.width * zoom}px`;
    stage.style.height = `${base.height * zoom}px`;
    stage.style.transform = `translate3d(${panX}px, ${panY}px, 0)`;
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

  function centerOnArea(area, targetZoom = Math.max(zoom, 2)) {
    if (!base.width || !base.height) return;
    const box = size();
    zoom = clampZoom(targetZoom);
    panX = box.width / 2 - area.x * base.width * zoom;
    panY = box.height / 2 - area.y * base.height * zoom;
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
    if (target && typeof target.closest === 'function' && target.closest('.marker')) return;
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
    if (event.target?.closest?.('.marker')) return;
    const rect = viewport.getBoundingClientRect();
    setZoom(
      zoom > 1.01 ? ZOOM_MIN : 2.5,
      event.clientX - rect.left,
      event.clientY - rect.top,
    );
  }

  function onFocusIn(event) {
    const marker = event.target?.closest?.('.marker');
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
    centerOnArea,
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
