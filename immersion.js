/**
 * Aclaria map — optional Immersion mode.
 *
 * A small, self-contained module that tilts the map plane by a few degrees from
 * device orientation. It is a presentation effect only: it never touches the
 * housing data, marker coordinates, zoom/pan math or the map artwork.
 *
 * Ground rules this module keeps:
 * - Off by default. Nothing asks for motion access until the user presses the
 *   Immersion mode button (a real gesture, as iOS requires).
 * - Relative orientation only (`deviceorientation`, never the absolute/compass
 *   variant), no alpha/heading, no geolocation, no storage, no network.
 * - The first usable reading becomes the neutral pose, so the map starts flat.
 * - Deadzone + hard limit + smoothing: small, bounded motion instead of jitter.
 * - No idle render loop: animation frames run only while the tilt is moving and
 *   stop as soon as it settles.
 * - Honest failure: unsupported, denied, no readings or reduced motion all leave
 *   the flat map working and say so.
 *
 * Pure helpers are exported for the node:test suite; the controller takes an
 * injectable environment so the same paths can be tested without a browser.
 */

export const TILT_LIMIT_DEG = 3;
export const DEADZONE_DEG = 0.8;
export const SMOOTHING = 0.18;
export const SETTLE_EPSILON_DEG = 0.02;
export const NO_DATA_TIMEOUT_MS = 1600;
/** Largest sideways shift (px) a tilt may cause at the map edges. Horizon-
 *  limiting: it keeps the effect subtle when the stage is much larger than the
 *  viewport, without ever exceeding TILT_LIMIT_DEG. */
export const MAX_EDGE_SHIFT_PX = 24;

export const TILT_VAR_X = '--immersion-rotate-x';
export const TILT_VAR_Y = '--immersion-rotate-y';

export const IMMERSION_MESSAGES = Object.freeze({
  off: '',
  requesting: 'Waiting for permission…',
  on: '',
  'reduced-motion': 'Unavailable with reduced motion enabled.',
  unsupported: 'Unavailable on this device.',
  denied: 'Permission denied. You can try again.',
  'no-data': 'Unavailable. You can try again.',
  unavailable: 'Temporarily unavailable.',
  suspended: 'Paused.',
});

/* ------------------------------------------------------------------------- */
/* Pure helpers                                                              */
/* ------------------------------------------------------------------------- */

/** Screen angles are multiples of 90°; anything unusable falls back to 0. */
export function normalizeScreenAngle(angle) {
  const value = Number(angle);
  if (!Number.isFinite(value)) return 0;
  const quarter = Math.round(value / 90);
  if (Math.abs(value - quarter * 90) > 0.5) return 0;
  const wrapped = ((quarter * 90) % 360 + 360) % 360;
  return wrapped === 90 || wrapped === 180 || wrapped === 270 ? wrapped : 0;
}

/** A reading is usable only when both relative angles are real numbers. */
export function isUsableReading(reading) {
  if (!reading || typeof reading !== 'object') return false;
  return Number.isFinite(reading.beta) && Number.isFinite(reading.gamma);
}

/**
 * Rotates the device-frame tilt (beta = front/back, gamma = left/right) into the
 * screen's axes, so a phone held in landscape still tilts the way it looks.
 * Returns `{ pitch, roll }` in degrees, or null for unusable input.
 */
export function screenRelativeTilt({ beta, gamma, screenAngle } = {}) {
  if (!Number.isFinite(beta) || !Number.isFinite(gamma)) return null;
  const radians = (normalizeScreenAngle(screenAngle) * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    pitch: beta * cos - gamma * sin,
    roll: beta * sin + gamma * cos,
  };
}

/** Drops jitter inside the deadzone, keeping the sign outside it. */
export function applyDeadzone(value, deadzone = DEADZONE_DEG) {
  const magnitude = Math.abs(Number(value));
  if (!Number.isFinite(magnitude) || magnitude <= 0) return 0;
  const band = Number.isFinite(deadzone) && deadzone > 0 ? deadzone : 0;
  if (magnitude <= band) return 0;
  return Math.sign(value) * (magnitude - band);
}

export function clampDegrees(value, limit = TILT_LIMIT_DEG) {
  if (!Number.isFinite(value)) return 0;
  const bound = Number.isFinite(limit) && limit > 0 ? limit : TILT_LIMIT_DEG;
  return Math.max(-bound, Math.min(bound, value));
}

/**
 * Tilt limit for the current stage size. A rotation of θ about the stage centre
 * moves the far edge by ≈ d·sin θ, where d is the half-diagonal. Capping that
 * shift keeps the effect subtle at high zoom; the result never exceeds `limit`.
 */
export function effectiveLimitDeg(
  width,
  height,
  limit = TILT_LIMIT_DEG,
  maxShift = MAX_EDGE_SHIFT_PX,
) {
  const bound = Number.isFinite(limit) && limit > 0 ? limit : TILT_LIMIT_DEG;
  const w = Number(width);
  const h = Number(height);
  const shift = Number.isFinite(maxShift) && maxShift > 0 ? maxShift : MAX_EDGE_SHIFT_PX;
  if (!(w > 0) || !(h > 0)) return bound;
  const halfDiagonal = Math.hypot(w, h) / 2;
  if (!(halfDiagonal > 0)) return bound;
  const capped = (Math.atan2(shift, halfDiagonal) * 180) / Math.PI;
  return Math.min(bound, Math.max(0, capped));
}

/**
 * Screen-space tilt relative to a calibrated neutral pose. `neutral` is a
 * `{ pitch, roll }` pair from `screenRelativeTilt`; the result is deadzoned and
 * hard-limited so it can never exceed `limit` degrees.
 */
export function tiltFromReading({
  beta,
  gamma,
  screenAngle = 0,
  neutral = null,
  limit = TILT_LIMIT_DEG,
  deadzone = DEADZONE_DEG,
} = {}) {
  const current = screenRelativeTilt({ beta, gamma, screenAngle });
  if (!current) return null;
  if (!neutral || !Number.isFinite(neutral.pitch) || !Number.isFinite(neutral.roll)) {
    return { x: 0, y: 0 };
  }
  return {
    x: clampDegrees(applyDeadzone(current.pitch - neutral.pitch, deadzone), limit),
    y: clampDegrees(applyDeadzone(current.roll - neutral.roll, deadzone), limit),
  };
}

/** One exponential smoothing step towards `target`. */
export function smoothToward(current, target, factor = SMOOTHING) {
  const from = current && Number.isFinite(current.x) && Number.isFinite(current.y) ? current : { x: 0, y: 0 };
  const to = target && Number.isFinite(target.x) && Number.isFinite(target.y) ? target : { x: 0, y: 0 };
  const k = Number.isFinite(factor) ? Math.max(0, Math.min(1, factor)) : SMOOTHING;
  return { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k };
}

export function isSettled(current, target, epsilon = SETTLE_EPSILON_DEG) {
  if (!current || !target) return true;
  return Math.abs(current.x - target.x) <= epsilon && Math.abs(current.y - target.y) <= epsilon;
}

export function formatTilt(tilt) {
  const x = Number.isFinite(tilt?.x) ? tilt.x : 0;
  const y = Number.isFinite(tilt?.y) ? tilt.y : 0;
  return { x: `${x.toFixed(2)}deg`, y: `${y.toFixed(2)}deg` };
}

/* ------------------------------------------------------------------------- */
/* Controller                                                                */
/* ------------------------------------------------------------------------- */

function defaultEnv() {
  const win = typeof window !== 'undefined' ? window : null;
  const doc = typeof document !== 'undefined' ? document : null;
  return {
    win,
    doc,
    orientationEvent: win && typeof win.DeviceOrientationEvent === 'function' ? win.DeviceOrientationEvent : null,
    screenAngle() {
      const angle = win?.screen?.orientation?.angle;
      if (Number.isFinite(angle)) return angle;
      const legacy = win?.orientation;
      return Number.isFinite(legacy) ? legacy : 0;
    },
    reducedMotion() {
      if (typeof win?.matchMedia !== 'function') return false;
      return win.matchMedia('(prefers-reduced-motion: reduce)').matches;
    },
    requestFrame(fn) {
      if (typeof win?.requestAnimationFrame === 'function') return win.requestAnimationFrame(fn);
      return setTimeout(fn, 16);
    },
    cancelFrame(id) {
      if (typeof win?.cancelAnimationFrame === 'function') win.cancelAnimationFrame(id);
      else clearTimeout(id);
    },
    setTimer(fn, ms) {
      return setTimeout(fn, ms);
    },
    clearTimer(id) {
      clearTimeout(id);
    },
  };
}

/**
 * @param {object} options
 * @param {HTMLElement} options.stage   element whose custom properties carry the tilt
 * @param {HTMLElement} options.viewport map viewport (pause during pan/pinch)
 * @param {HTMLButtonElement} options.button the Immersion mode toggle
 * @param {HTMLElement} options.status   polite status line
 * @param {object} [options.env]         injectable environment (tests)
 * @param {() => ({width:number,height:number})} [options.getExtent] stage size
 */
export function createImmersionController({
  stage,
  viewport,
  button,
  status,
  env: injected = null,
  getExtent = null,
} = {}) {
  const env = { ...defaultEnv(), ...(injected ?? {}) };
  const win = env.win;
  const doc = env.doc;

  let phase = 'off'; // off | requesting | on
  let statusKey = 'off';
  let listening = false;
  let paused = false;
  let neutral = null;
  let pendingRecalibration = true;
  let target = { x: 0, y: 0 };
  let current = { x: 0, y: 0 };
  let frameId = 0;
  let dataTimer = 0;
  let resumeOnVisible = false;
  let destroyed = false;

  function setCustomProperty(name, value) {
    stage?.style?.setProperty?.(name, value);
  }

  function paintTilt(tilt) {
    const formatted = formatTilt(tilt);
    setCustomProperty(TILT_VAR_X, formatted.x);
    setCustomProperty(TILT_VAR_Y, formatted.y);
  }

  function limit() {
    const extent = typeof getExtent === 'function' ? getExtent() : null;
    const width = Number(extent?.width);
    const height = Number(extent?.height);
    if (!(width > 0) || !(height > 0)) return TILT_LIMIT_DEG;
    return effectiveLimitDeg(width, height);
  }

  function render() {
    const enabled = phase === 'on';
    if (button) {
      button.textContent = enabled ? 'Immersion mode: On' : 'Immersion mode: Off';
      button.setAttribute('aria-pressed', enabled ? 'true' : 'false');
      button.classList.toggle('is-on', enabled);
      button.classList.toggle('is-busy', phase === 'requesting');
    }
    if (status) status.textContent = IMMERSION_MESSAGES[statusKey] ?? IMMERSION_MESSAGES.off;
    viewport?.classList?.toggle?.('is-immersive', enabled);
  }

  function announce() {
    // The status line is itself an aria-live region; nothing else to shout.
    if (status) status.textContent = IMMERSION_MESSAGES[statusKey] ?? IMMERSION_MESSAGES.off;
  }

  function resetTilt() {
    if (frameId) {
      env.cancelFrame(frameId);
      frameId = 0;
    }
    target = { x: 0, y: 0 };
    current = { x: 0, y: 0 };
    paintTilt(current);
  }

  function stopDataTimer() {
    if (dataTimer) {
      env.clearTimer(dataTimer);
      dataTimer = 0;
    }
  }

  function detachSensor() {
    if (!listening) return;
    listening = false;
    win?.removeEventListener?.('deviceorientation', onOrientation);
  }

  function attachSensor() {
    if (listening || destroyed) return;
    listening = true;
    win?.addEventListener?.('deviceorientation', onOrientation, { passive: true });
  }

  function settleOff(key) {
    phase = 'off';
    statusKey = key;
    resumeOnVisible = false;
    detachSensor();
    stopDataTimer();
    resetTilt();
    pendingRecalibration = true;
    neutral = null;
    render();
  }

  function onOrientation(event) {
    if (!listening || paused || phase === 'off') return;
    if (!isUsableReading(event)) return; // null/undefined angles are not data
    const reading = {
      beta: Number(event.beta),
      gamma: Number(event.gamma),
      screenAngle: env.screenAngle(),
    };
    const screen = screenRelativeTilt(reading);
    if (!screen) return;

    if (pendingRecalibration || !neutral) {
      neutral = screen;
      pendingRecalibration = false;
      stopDataTimer();
      if (phase !== 'on') {
        phase = 'on';
        statusKey = 'on';
        render();
      }
      resetTilt();
      return;
    }

    if (phase !== 'on') {
      phase = 'on';
      statusKey = 'on';
      render();
    }
    stopDataTimer();
    const next = tiltFromReading({ ...reading, neutral, limit: limit() });
    if (!next) return;
    target = next;
    if (!frameId) frameId = env.requestFrame(tick);
  }

  function tick() {
    frameId = 0;
    if (!listening || paused || phase !== 'on') return;
    current = smoothToward(current, target);
    if (isSettled(current, target)) {
      current = { x: target.x, y: target.y };
      paintTilt(current);
      return; // settled: no further frames until a new reading arrives
    }
    paintTilt(current);
    frameId = env.requestFrame(tick);
  }

  async function arm() {
    phase = 'requesting';
    statusKey = 'requesting';
    render();
    attachSensor();
    stopDataTimer();
    dataTimer = env.setTimer(() => {
      dataTimer = 0;
      if (phase === 'on') return;
      settleOff('no-data');
    }, NO_DATA_TIMEOUT_MS);
  }

  async function enable() {
    if (destroyed) return { ok: false, reason: 'destroyed' };
    if (phase === 'on' || phase === 'requesting') return { ok: true, reason: phase };
    if (env.reducedMotion()) {
      settleOff('reduced-motion');
      announce();
      return { ok: false, reason: 'reduced-motion' };
    }
    const Orientation = env.orientationEvent;
    if (!Orientation || typeof win?.addEventListener !== 'function') {
      settleOff('unsupported');
      return { ok: false, reason: 'unsupported' };
    }
    neutral = null;
    pendingRecalibration = true;
    resumeOnVisible = true;
    if (typeof Orientation.requestPermission === 'function') {
      phase = 'requesting';
      statusKey = 'requesting';
      render();
      let outcome;
      try {
        outcome = await Orientation.requestPermission();
      } catch {
        outcome = 'denied';
      }
      if (outcome !== 'granted') {
        resumeOnVisible = false;
        settleOff('denied');
        return { ok: false, reason: 'denied' };
      }
    }
    if (destroyed) return { ok: false, reason: 'destroyed' };
    await arm();
    return { ok: true, reason: 'arming' };
  }

  function disable() {
    if (destroyed) return;
    resumeOnVisible = false;
    settleOff('off');
  }

  function pause() {
    if (phase !== 'on' || paused) return;
    paused = true;
    resetTilt();
  }

  function resume() {
    if (!paused) return;
    paused = false;
    if (phase === 'on') {
      pendingRecalibration = true;
      neutral = null;
    }
  }

  function toggle() {
    return phase === 'on' || phase === 'requesting' ? (disable(), Promise.resolve({ ok: true })) : enable();
  }

  function onVisibilityChange() {
    if (!doc) return;
    if (doc.hidden) {
      if (phase === 'on' || phase === 'requesting') {
        resumeOnVisible = true;
        detachSensor();
        stopDataTimer();
        phase = 'off';
        statusKey = 'suspended';
        resetTilt();
        pendingRecalibration = true;
        neutral = null;
        render();
      }
      return;
    }
    if (!resumeOnVisible) return;
    resumeOnVisible = false;
    void arm();
  }

  function onScreenOrientationChange() {
    if (phase !== 'on') return;
    pendingRecalibration = true;
    neutral = null;
    resetTilt();
  }

  function onPointerDown() {
    pause();
  }

  function onPointerUp() {
    resume();
  }

  button?.addEventListener?.('click', onToggleClick);
  function onToggleClick() {
    void toggle();
  }
  viewport?.addEventListener?.('pointerdown', onPointerDown);
  win?.addEventListener?.('pointerup', onPointerUp, { passive: true });
  win?.addEventListener?.('pointercancel', onPointerUp, { passive: true });
  win?.addEventListener?.('blur', onPointerUp, { passive: true });
  doc?.addEventListener?.('visibilitychange', onVisibilityChange);
  win?.addEventListener?.('orientationchange', onScreenOrientationChange);
  win?.screen?.orientation?.addEventListener?.('change', onScreenOrientationChange);

  paintTilt(current);
  render();

  return {
    enable,
    disable,
    toggle,
    pause,
    resume,
    destroy() {
      destroyed = true;
      button?.removeEventListener?.('click', onToggleClick);
      viewport?.removeEventListener?.('pointerdown', onPointerDown);
      win?.removeEventListener?.('pointerup', onPointerUp);
      win?.removeEventListener?.('pointercancel', onPointerUp);
      win?.removeEventListener?.('blur', onPointerUp);
      doc?.removeEventListener?.('visibilitychange', onVisibilityChange);
      win?.removeEventListener?.('orientationchange', onScreenOrientationChange);
      win?.screen?.orientation?.removeEventListener?.('change', onScreenOrientationChange);
      detachSensor();
      stopDataTimer();
      resetTilt();
      viewport?.classList?.remove?.('is-immersive');
    },
    getState: () => ({
      phase,
      enabled: phase === 'on',
      statusKey,
      listening,
      paused,
      neutral,
      target: { ...target },
      tilt: { ...current },
      frameScheduled: Boolean(frameId),
    }),
  };
}
