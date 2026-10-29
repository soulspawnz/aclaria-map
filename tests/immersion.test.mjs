/**
 * Synthetic tests for Immersion mode.
 *
 * No browser and no dependency: orientation events, permission answers, timers
 * and animation frames are all injected, so every path (granted/denied/unsupported,
 * non-finite and missing angles, screen rotations, cleanup, reduced motion) is
 * exercised deterministically. These are SYNTHETIC readings — no physical-device
 * claim is made here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  TILT_LIMIT_DEG,
  DEADZONE_DEG,
  NO_DATA_TIMEOUT_MS,
  IMMERSION_MESSAGES,
  TILT_VAR_X,
  TILT_VAR_Y,
  normalizeScreenAngle,
  isUsableReading,
  screenRelativeTilt,
  applyDeadzone,
  clampDegrees,
  effectiveLimitDeg,
  tiltFromReading,
  smoothToward,
  isSettled,
  formatTilt,
  createImmersionController,
} from '../immersion.js';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

/* ------------------------------------------------------------------------- */
/* Fakes                                                                      */
/* ------------------------------------------------------------------------- */

function createEventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(handler);
    },
    removeEventListener(type, handler) {
      listeners.get(type)?.delete(handler);
    },
    dispatch(type, event = {}) {
      for (const handler of [...(listeners.get(type) ?? [])]) handler(event);
    },
    count(type) {
      return listeners.get(type)?.size ?? 0;
    },
  };
}

function createFakeElement(extra = {}) {
  const classes = new Set();
  const attributes = new Map();
  const listeners = createEventTarget();
  const properties = new Map();
  return {
    textContent: '',
    style: {
      setProperty(name, value) {
        properties.set(name, String(value));
      },
      getPropertyValue(name) {
        return properties.get(name) ?? '';
      },
    },
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
      toggle(name, force) {
        const add = force === undefined ? !classes.has(name) : Boolean(force);
        if (add) classes.add(name);
        else classes.delete(name);
        return add;
      },
    },
    setAttribute(name, value) {
      attributes.set(name, String(value));
    },
    getAttribute(name) {
      return attributes.has(name) ? attributes.get(name) : null;
    },
    addEventListener: (type, handler) => listeners.addEventListener(type, handler),
    removeEventListener: (type, handler) => listeners.removeEventListener(type, handler),
    dispatch: (type, event) => listeners.dispatch(type, event),
    countListeners: (type) => listeners.count(type),
    ...extra,
  };
}

function createFakeEnv(options = {}) {
  const win = createEventTarget();
  const doc = createEventTarget();
  doc.hidden = false;
  const frames = new Map();
  const timers = new Map();
  let frameId = 0;
  let timerId = 0;
  let now = 0;
  let permissionCalls = 0;

  const DeviceOrientationEvent =
    options.orientationEvent === undefined ? function DeviceOrientationEvent() {} : options.orientationEvent;
  if (options.permission !== undefined && DeviceOrientationEvent) {
    DeviceOrientationEvent.requestPermission = () => {
      permissionCalls += 1;
      return options.permission === 'throw' ? Promise.reject(new Error('denied')) : Promise.resolve(options.permission);
    };
  }

  const env = {
    win,
    doc,
    orientationEvent: DeviceOrientationEvent,
    screenAngleValue: options.screenAngle ?? 0,
    screenAngle: () => env.screenAngleValue,
    reducedMotion: () => Boolean(options.reducedMotion),
    requestFrame(fn) {
      frameId += 1;
      frames.set(frameId, fn);
      return frameId;
    },
    cancelFrame(id) {
      frames.delete(id);
    },
    setTimer(fn, ms) {
      timerId += 1;
      timers.set(timerId, { fn, at: now + ms });
      return timerId;
    },
    clearTimer(id) {
      timers.delete(id);
    },
  };

  return {
    env,
    win,
    doc,
    emitOrientation(beta, gamma) {
      win.dispatch('deviceorientation', { beta, gamma });
    },
    flushFrames(limit = 400) {
      let ran = 0;
      while (frames.size > 0 && ran < limit) {
        const [id, fn] = [...frames.entries()][0];
        frames.delete(id);
        fn(now);
        ran += 1;
      }
      return ran;
    },
    pendingFrames: () => frames.size,
    advance(ms) {
      now += ms;
      for (const [id, timer] of [...timers.entries()]) {
        if (timer.at <= now) {
          timers.delete(id);
          timer.fn();
        }
      }
    },
    pendingTimers: () => timers.size,
    get permissionCalls() {
      return permissionCalls;
    },
  };
}

function mount(options = {}) {
  const fake = createFakeEnv(options);
  const stage = createFakeElement();
  const viewport = createFakeElement();
  const button = createFakeElement();
  const status = createFakeElement();
  const controller = createImmersionController({
    stage,
    viewport,
    button,
    status,
    env: fake.env,
    getExtent: options.getExtent ?? (() => ({ width: 400, height: 300 })),
  });
  // Object.create keeps the live getters (permissionCalls) instead of snapshotting them.
  return Object.assign(Object.create(fake), { stage, viewport, button, status, controller });
}

const degrees = (value) => Number.parseFloat(String(value).replace('deg', ''));

/* ------------------------------------------------------------------------- */
/* Pure helpers                                                              */
/* ------------------------------------------------------------------------- */

test('screen angles normalise to the four supported quarters', () => {
  assert.equal(normalizeScreenAngle(0), 0);
  assert.equal(normalizeScreenAngle(90), 90);
  assert.equal(normalizeScreenAngle(180), 180);
  assert.equal(normalizeScreenAngle(270), 270);
  assert.equal(normalizeScreenAngle(360), 0);
  assert.equal(normalizeScreenAngle(-90), 270);
  assert.equal(normalizeScreenAngle(90.0001), 90);
  assert.equal(normalizeScreenAngle(undefined), 0);
  assert.equal(normalizeScreenAngle(null), 0);
  assert.equal(normalizeScreenAngle(Number.NaN), 0);
  assert.equal(normalizeScreenAngle('90'), 90);
});

test('missing, null and non-finite orientation values are not data', () => {
  assert.equal(isUsableReading({ beta: 0, gamma: 0 }), true);
  assert.equal(isUsableReading({ beta: -12.5, gamma: 4 }), true);
  assert.equal(isUsableReading({ beta: null, gamma: 4 }), false);
  assert.equal(isUsableReading({ beta: 4, gamma: undefined }), false);
  assert.equal(isUsableReading({ beta: Number.NaN, gamma: 1 }), false);
  assert.equal(isUsableReading({ beta: Number.POSITIVE_INFINITY, gamma: 1 }), false);
  assert.equal(isUsableReading({ beta: '12', gamma: 1 }), false);
  assert.equal(isUsableReading({}), false);
  assert.equal(isUsableReading(null), false);
  assert.equal(isUsableReading(undefined), false);
});

test('device angles rotate into screen axes for every screen orientation', () => {
  assert.deepEqual(screenRelativeTilt({ beta: 30, gamma: 10, screenAngle: 0 }), { pitch: 30, roll: 10 });
  const landscape = screenRelativeTilt({ beta: 30, gamma: 10, screenAngle: 90 });
  assert.ok(Math.abs(landscape.pitch + 10) < 1e-9);
  assert.ok(Math.abs(landscape.roll - 30) < 1e-9);
  const upsideDown = screenRelativeTilt({ beta: 30, gamma: 10, screenAngle: 180 });
  assert.ok(Math.abs(upsideDown.pitch + 30) < 1e-9);
  assert.ok(Math.abs(upsideDown.roll + 10) < 1e-9);
  const landscapeOther = screenRelativeTilt({ beta: 30, gamma: 10, screenAngle: 270 });
  assert.ok(Math.abs(landscapeOther.pitch - 10) < 1e-9);
  assert.ok(Math.abs(landscapeOther.roll + 30) < 1e-9);

  // extremes stay finite, missing values do not invent a pose
  const extreme = screenRelativeTilt({ beta: 180, gamma: -90, screenAngle: 0 });
  assert.equal(extreme.pitch, 180);
  assert.equal(extreme.roll, -90);
  assert.equal(screenRelativeTilt({ beta: null, gamma: 0 }), null);
  assert.equal(screenRelativeTilt({}), null);
  assert.equal(screenRelativeTilt(), null);
});

test('deadzone silences jitter and clamping bounds every extreme', () => {
  assert.equal(applyDeadzone(0, DEADZONE_DEG), 0);
  assert.equal(applyDeadzone(DEADZONE_DEG * 0.99, DEADZONE_DEG), 0);
  assert.equal(applyDeadzone(DEADZONE_DEG, DEADZONE_DEG), 0);
  assert.ok(Math.abs(applyDeadzone(2, 1) - 1) < 1e-9);
  assert.ok(Math.abs(applyDeadzone(-2, 1) + 1) < 1e-9);
  assert.equal(applyDeadzone(Number.NaN, 1), 0);

  assert.equal(clampDegrees(180), TILT_LIMIT_DEG);
  assert.equal(clampDegrees(-180), -TILT_LIMIT_DEG);
  assert.equal(clampDegrees(1.5), 1.5);
  assert.equal(clampDegrees(Number.NaN), 0);
  assert.equal(clampDegrees(Number.POSITIVE_INFINITY), 0);
});

test('the tilt limit shrinks with the stage so the effect stays subtle', () => {
  assert.equal(effectiveLimitDeg(400, 300), TILT_LIMIT_DEG);
  const zoomed = effectiveLimitDeg(4000, 3000);
  assert.ok(zoomed > 0 && zoomed < TILT_LIMIT_DEG, `zoomed limit ${zoomed}`);
  assert.ok(effectiveLimitDeg(8000, 6000) < zoomed);
  assert.equal(effectiveLimitDeg(0, 0), TILT_LIMIT_DEG);
  assert.equal(effectiveLimitDeg(Number.NaN, 300), TILT_LIMIT_DEG);
  assert.equal(effectiveLimitDeg(-10, -10), TILT_LIMIT_DEG);
});

test('a reading is relative to the calibrated neutral and can never exceed 3 degrees', () => {
  const neutral = screenRelativeTilt({ beta: 40, gamma: 10, screenAngle: 0 });
  assert.deepEqual(tiltFromReading({ beta: 40, gamma: 10, screenAngle: 0, neutral }), { x: 0, y: 0 });
  // tiny movement inside the deadzone is ignored
  assert.deepEqual(tiltFromReading({ beta: 40.4, gamma: 10.2, screenAngle: 0, neutral }), { x: 0, y: 0 });
  // extremes clamp
  const extreme = tiltFromReading({ beta: 180, gamma: -90, screenAngle: 0, neutral });
  assert.equal(extreme.x, TILT_LIMIT_DEG);
  assert.equal(extreme.y, -TILT_LIMIT_DEG);
  // non-finite readings and missing neutral do not throw or invent motion
  assert.equal(tiltFromReading({ beta: null, gamma: 1, neutral }), null);
  assert.deepEqual(tiltFromReading({ beta: 41, gamma: 10, neutral: null }), { x: 0, y: 0 });
  assert.deepEqual(tiltFromReading(), null);
});

test('smoothing, settling and CSS formatting are bounded and finite', () => {
  const step = smoothToward({ x: 0, y: 0 }, { x: 3, y: -3 }, 0.5);
  assert.deepEqual(step, { x: 1.5, y: -1.5 });
  assert.equal(isSettled({ x: 3, y: 0 }, { x: 3.01, y: 0 }), true);
  assert.equal(isSettled({ x: 3, y: 2 }, { x: 0, y: 0 }), false);
  assert.equal(isSettled(null, { x: 0, y: 0 }), true);
  assert.deepEqual(formatTilt({ x: 2.3456, y: -1.2 }), { x: '2.35deg', y: '-1.20deg' });
  assert.deepEqual(formatTilt({ x: Number.NaN, y: undefined }), { x: '0.00deg', y: '0.00deg' });
});

/* ------------------------------------------------------------------------- */
/* Controller: permission and capability                                     */
/* ------------------------------------------------------------------------- */

test('desktop-style unsupported devices keep the flat map and say so', async () => {
  const world = mount({ orientationEvent: null });
  const result = await world.controller.enable();
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unsupported');
  const state = world.controller.getState();
  assert.equal(state.phase, 'off');
  assert.equal(state.statusKey, 'unsupported');
  assert.equal(world.button.textContent, 'Immersion mode: Off');
  assert.equal(world.button.getAttribute('aria-pressed'), 'false');
  assert.equal(world.status.textContent, IMMERSION_MESSAGES.unsupported);
  assert.equal(world.win.count('deviceorientation'), 0);
  assert.equal(world.viewport.classList.contains('is-immersive'), false);
});

test('a denied permission prompt never pretends to be enabled', async () => {
  const world = mount({ permission: 'denied' });
  const result = await world.controller.enable();
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'denied');
  assert.equal(world.permissionCalls, 1);
  assert.equal(world.controller.getState().statusKey, 'denied');
  assert.equal(world.button.textContent, 'Immersion mode: Off');
  assert.equal(world.button.getAttribute('aria-pressed'), 'false');
  assert.equal(world.win.count('deviceorientation'), 0);
  // a denied attempt is not silently retried when the page becomes visible again
  world.doc.hidden = true;
  world.doc.dispatch('visibilitychange');
  world.doc.hidden = false;
  world.doc.dispatch('visibilitychange');
  assert.equal(world.win.count('deviceorientation'), 0);
});

test('a rejected permission call is reported as denied', async () => {
  const world = mount({ permission: 'throw' });
  const result = await world.controller.enable();
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'denied');
  assert.equal(world.controller.getState().statusKey, 'denied');
});

test('reduced motion keeps Immersion mode off and explains why', async () => {
  const world = mount({ permission: 'granted', reducedMotion: true });
  const result = await world.controller.enable();
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'reduced-motion');
  assert.equal(world.controller.getState().statusKey, 'reduced-motion');
  assert.equal(world.button.textContent, 'Immersion mode: Off');
  assert.equal(world.permissionCalls, 0, 'no permission prompt under reduced motion');
  assert.equal(world.win.count('deviceorientation'), 0);
  assert.match(world.status.textContent, /reduced motion/i);
});

test('no readings at all falls back to the flat map instead of faking a tilt', async () => {
  const world = mount({ permission: 'granted' });
  await world.controller.enable();
  assert.equal(world.controller.getState().phase, 'requesting');
  // a device that fires the event but never supplies angles is not data
  world.emitOrientation(null, undefined);
  world.emitOrientation(Number.NaN, 3);
  world.flushFrames();
  assert.equal(world.controller.getState().phase, 'requesting');
  world.advance(NO_DATA_TIMEOUT_MS + 1);
  const state = world.controller.getState();
  assert.equal(state.phase, 'off');
  assert.equal(state.statusKey, 'no-data');
  assert.equal(world.button.textContent, 'Immersion mode: Off');
  assert.equal(world.win.count('deviceorientation'), 0);
  assert.equal(world.stage.style.getPropertyValue(TILT_VAR_X), '0.00deg');
});

/* ------------------------------------------------------------------------- */
/* Controller: enabled behaviour                                             */
/* ------------------------------------------------------------------------- */

test('granted permission calibrates neutral, tilts smoothly and then idles', async () => {
  const world = mount({ permission: 'granted' });
  const result = await world.controller.enable();
  assert.equal(result.ok, true);
  assert.equal(world.permissionCalls, 1);

  world.emitOrientation(40, 10);
  let state = world.controller.getState();
  assert.equal(state.phase, 'on');
  assert.equal(state.neutral.pitch, 40);
  assert.equal(world.button.textContent, 'Immersion mode: On');
  assert.equal(world.button.getAttribute('aria-pressed'), 'true');
  assert.equal(world.viewport.classList.contains('is-immersive'), true);
  assert.equal(world.stage.style.getPropertyValue(TILT_VAR_X), '0.00deg');

  world.emitOrientation(70, 10);
  state = world.controller.getState();
  assert.ok(state.frameScheduled);
  assert.equal(state.target.x, TILT_LIMIT_DEG);

  const firstFrame = world.flushFrames(1);
  assert.equal(firstFrame, 1);
  const partial = degrees(world.stage.style.getPropertyValue(TILT_VAR_X));
  assert.ok(partial > 0 && partial < TILT_LIMIT_DEG, `partial tilt ${partial}`);

  world.flushFrames();
  assert.equal(degrees(world.stage.style.getPropertyValue(TILT_VAR_X)), TILT_LIMIT_DEG);
  assert.equal(world.pendingFrames(), 0, 'no render loop once the tilt settles');
  assert.equal(world.pendingTimers(), 0, 'the no-data timer is cleared by real readings');
});

test('tilt output stays inside the bound for extreme synthetic readings', async () => {
  const world = mount({ permission: 'granted' });
  await world.controller.enable();
  world.emitOrientation(0, 0);
  for (const [beta, gamma] of [
    [180, 180],
    [-180, -180],
    [95, -45],
    [Number.POSITIVE_INFINITY, 0],
    [0, Number.NaN],
  ]) {
    world.emitOrientation(beta, gamma);
    world.flushFrames();
    const x = degrees(world.stage.style.getPropertyValue(TILT_VAR_X));
    const y = degrees(world.stage.style.getPropertyValue(TILT_VAR_Y));
    assert.ok(Math.abs(x) <= TILT_LIMIT_DEG + 1e-9, `x ${x} for ${beta}/${gamma}`);
    assert.ok(Math.abs(y) <= TILT_LIMIT_DEG + 1e-9, `y ${y} for ${beta}/${gamma}`);
    assert.ok(Number.isFinite(x) && Number.isFinite(y));
  }
});

test('turning the screen recalibrates instead of jumping the map', async () => {
  const world = mount({ permission: 'granted', screenAngle: 0 });
  await world.controller.enable();
  world.emitOrientation(40, 0);
  world.emitOrientation(50, 0);
  world.flushFrames();
  assert.ok(degrees(world.stage.style.getPropertyValue(TILT_VAR_X)) > 0);

  world.env.screenAngleValue = 90;
  world.win.dispatch('orientationchange');
  assert.equal(world.stage.style.getPropertyValue(TILT_VAR_X), '0.00deg');
  world.emitOrientation(40, 0);
  const state = world.controller.getState();
  assert.equal(state.tilt.x, 0);
  assert.equal(state.phase, 'on');
});

test('dragging pauses the effect, releases cancel frames and resumes neutral', async () => {
  const world = mount({ permission: 'granted' });
  await world.controller.enable();
  world.emitOrientation(40, 0);
  world.emitOrientation(60, 0);
  world.flushFrames();
  assert.equal(degrees(world.stage.style.getPropertyValue(TILT_VAR_X)), TILT_LIMIT_DEG);

  world.viewport.dispatch('pointerdown', { pointerType: 'touch' });
  assert.equal(world.controller.getState().paused, true);
  assert.equal(world.stage.style.getPropertyValue(TILT_VAR_X), '0.00deg');
  assert.equal(world.pendingFrames(), 0);

  world.emitOrientation(90, 0);
  assert.deepEqual(world.controller.getState().target, { x: 0, y: 0 });

  world.win.dispatch('pointerup');
  assert.equal(world.controller.getState().paused, false);
  world.emitOrientation(90, 0);
  assert.equal(world.controller.getState().tilt.x, 0, 'recalibrated after the gesture');
});

/* ------------------------------------------------------------------------- */
/* Controller: cleanup                                                       */
/* ------------------------------------------------------------------------- */

test('turning Immersion mode off restores the neutral transform and listeners', async () => {
  const world = mount({ permission: 'granted' });
  await world.controller.enable();
  world.emitOrientation(40, 0);
  world.emitOrientation(60, 0);
  world.flushFrames();
  assert.equal(world.win.count('deviceorientation'), 1);

  world.controller.disable();
  const state = world.controller.getState();
  assert.equal(state.phase, 'off');
  assert.equal(state.enabled, false);
  assert.equal(world.win.count('deviceorientation'), 0);
  assert.equal(world.pendingFrames(), 0);
  assert.equal(world.pendingTimers(), 0);
  assert.equal(world.stage.style.getPropertyValue(TILT_VAR_X), '0.00deg');
  assert.equal(world.stage.style.getPropertyValue(TILT_VAR_Y), '0.00deg');
  assert.equal(world.viewport.classList.contains('is-immersive'), false);
  assert.equal(world.button.textContent, 'Immersion mode: Off');
  assert.equal(world.button.getAttribute('aria-pressed'), 'false');
});

test('hiding the page removes the sensor and restores flat; showing it re-arms', async () => {
  const world = mount({ permission: 'granted' });
  await world.controller.enable();
  world.emitOrientation(40, 0);
  world.emitOrientation(60, 0);
  world.flushFrames();

  world.doc.hidden = true;
  world.doc.dispatch('visibilitychange');
  assert.equal(world.win.count('deviceorientation'), 0);
  assert.equal(world.stage.style.getPropertyValue(TILT_VAR_X), '0.00deg');
  assert.equal(world.controller.getState().statusKey, 'suspended');
  assert.equal(world.button.getAttribute('aria-pressed'), 'false');

  world.doc.hidden = false;
  world.doc.dispatch('visibilitychange');
  assert.equal(world.win.count('deviceorientation'), 1);
  assert.equal(world.permissionCalls, 1, 'no second permission prompt on return');
  world.emitOrientation(10, 0);
  assert.equal(world.controller.getState().phase, 'on');
});

test('destroy removes every listener it added', async () => {
  const world = mount({ permission: 'granted' });
  await world.controller.enable();
  world.emitOrientation(40, 0);
  assert.equal(world.button.countListeners('click'), 1);
  world.controller.destroy();
  assert.equal(world.button.countListeners('click'), 0);
  assert.equal(world.viewport.countListeners('pointerdown'), 0);
  assert.equal(world.win.count('deviceorientation'), 0);
  assert.equal(world.win.count('pointerup'), 0);
  assert.equal(world.win.count('orientationchange'), 0);
  assert.equal(world.doc.count('visibilitychange'), 0);
});

/* ------------------------------------------------------------------------- */
/* Interaction with the existing map                                         */
/* ------------------------------------------------------------------------- */

test('the tilt rides on the existing pan/zoom transform without changing it', async () => {
  const { createMapController } = await import('../app.js');
  const listeners = new Map();
  const viewport = {
    clientWidth: 800,
    clientHeight: 600,
    classList: { add() {}, remove() {}, toggle() {} },
    style: { setProperty() {} },
    setPointerCapture() {},
    addEventListener(name, handler) {
      listeners.set(name, handler);
    },
    getBoundingClientRect() {
      return { left: 0, top: 0 };
    },
  };
  const stage = createFakeElement();
  let chrome = null;
  const controller = createMapController({ viewport, stage }, 4 / 3, (state) => {
    chrome = state;
  });
  controller.layout();
  const flatTransform = stage.style.transform ?? stage.style.getPropertyValue('transform');

  // zoom + pan through the real handlers
  listeners.get('wheel')({ deltaY: -100, clientX: 400, clientY: 300, preventDefault() {} });
  listeners.get('pointerdown')({ pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 100, target: null });
  listeners.get('pointermove')({ pointerId: 1, pointerType: 'touch', clientX: 160, clientY: 140 });
  listeners.get('pointerup')({ pointerId: 1, pointerType: 'touch', clientX: 160, clientY: 140 });
  const movedTransform = stage.style.transform ?? stage.style.getPropertyValue('transform');

  assert.ok(controller.getZoom() > 1);
  assert.notEqual(movedTransform, flatTransform);
  assert.match(String(movedTransform), /^translate3d\(/);
  assert.match(String(movedTransform), /rotateX\(calc\(var\(--zoom-tilt/);
  assert.match(String(movedTransform), /rotateY\(var\(--immersion-rotate-y, 0deg\)\)/);
  assert.ok(chrome.zoom > 1, 'zoom state still reported to the map chrome');
});

test('immersion never records, transmits or reads a compass heading', async () => {
  const source = await read('immersion.js');
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/);
  assert.doesNotMatch(source, /\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket/);
  assert.doesNotMatch(source, /navigator\.geolocation|getCurrentPosition|watchPosition/);
  assert.doesNotMatch(source, /deviceorientationabsolute/);
  assert.doesNotMatch(source, /\.alpha\b/);
  assert.match(source, /'deviceorientation'/);
});

test('immersion keeps marker targets and the artwork untouched', async () => {
  const css = await read('styles.css');
  const html = await read('index.html');
  const app = await read('app.js');
  assert.match(css, /\.map-viewport\.is-immersive[^}]*perspective:/);
  assert.match(css, /\.house-marker__badge \{[^}]*rotateX\(calc\(-1 \* \(var\(--zoom-tilt/);
  assert.match(css, /width: 44px/);
  assert.doesNotMatch(html, /immersion[^"]*\.jpg|immersion[^"]*assets\//);
  assert.doesNotMatch(app, /https?:\/\//);
});


test('normal immersion states contain no explanatory copy', () => {
  assert.equal(IMMERSION_MESSAGES.off, '');
  assert.equal(IMMERSION_MESSAGES.on, '');
});


test('desktop pointer immersion works without sensors and cleans up on disable', async () => {
  const world=mount({orientationEvent:null});
  world.win.matchMedia=()=>({matches:true});
  world.viewport.getBoundingClientRect=()=>({left:0,top:0,width:400,height:300});
  const result=await world.controller.enable();
  assert.equal(result.reason,'pointer');
  assert.equal(world.controller.getState().enabled,true);
  world.viewport.dispatch('pointermove',{pointerType:'mouse',clientX:400,clientY:0});
  world.flushFrames();
  assert.ok(degrees(world.stage.style.getPropertyValue(TILT_VAR_X))>0);
  assert.ok(degrees(world.stage.style.getPropertyValue(TILT_VAR_Y))>0);
  world.viewport.dispatch('pointerleave');
  assert.equal(degrees(world.stage.style.getPropertyValue(TILT_VAR_X)),0);
  world.controller.disable();
  world.viewport.dispatch('pointermove',{pointerType:'mouse',clientX:400,clientY:0});
  assert.equal(world.pendingFrames(),0);
  world.controller.destroy();
  assert.equal(world.viewport.countListeners('pointermove'),0);
});
