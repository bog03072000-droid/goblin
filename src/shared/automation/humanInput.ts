/**
 * Pure data-generation for human-like mouse/keyboard input, deliberately
 * containing zero CDP calls — see docs/BEHAVIORAL_EMULATION.md's Part 2 for
 * why this lives here rather than inside automationProxy.ts (a raw byte
 * pipe by design) or a driver module. Every function here just computes
 * *what* to send and *when*; `humanInputDriver.ts` is the thin layer that
 * actually dispatches it over a real CDP session.
 */

export interface Point {
  x: number;
  y: number;
}

export interface MousePathPoint extends Point {
  /** Milliseconds to wait after the previous point before dispatching this
   * one. Always 0 for the first point (dispatch immediately). */
  delayMs: number;
}

export interface HumanMousePathOptions {
  /** Number of intermediate points along the curve. Defaults to a value
   * proportional to distance (longer moves get more points), clamped to
   * [MIN_STEPS, MAX_STEPS] either way. */
  steps?: number;
  /** Total wall-clock time the movement should take, spread evenly across
   * `steps` (see the module comment on why per-step delay is uniform while
   * the eased *curve* parameter is what actually varies the visible
   * speed). Defaults to a value proportional to distance, clamped to
   * [MIN_DURATION_MS, MAX_DURATION_MS]. */
  durationMs?: number;
  /** Max random per-point deviation (pixels) added on top of the smooth
   * curve, simulating hand tremor. 0 disables jitter entirely. */
  jitterPx?: number;
  /** How far the curve's two control points are pushed perpendicular to
   * the straight line between `from` and `to`, in pixels — this is what
   * actually bows the path into a visible arc instead of a straight line.
   * Defaults to a value proportional to distance, clamped to
   * [MIN_CURVE_OFFSET_PX, MAX_CURVE_OFFSET_PX]. */
  curveOffsetPx?: number;
  /** When true, the path deliberately passes a few pixels beyond `to` and
   * adds 1-2 correction points moving back onto it — the "reach past and
   * correct" pattern real pointing devices commonly produce. The very
   * last point in the returned array is always exactly `to` regardless of
   * this setting. */
  overshoot?: boolean;
  /** Source of randomness, called with no arguments and expected to
   * return a value in [0, 1) — injectable so tests can assert exact,
   * reproducible output instead of only statistical properties. Defaults
   * to `Math.random`. */
  rng?: () => number;
}

const MIN_STEPS = 8;
const MAX_STEPS = 40;
const MIN_DURATION_MS = 150;
const MAX_DURATION_MS = 900;
const MIN_CURVE_OFFSET_PX = 5;
const MAX_CURVE_OFFSET_PX = 60;
const DEFAULT_JITTER_PX = 1.2;
const OVERSHOOT_PX = 6;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Cubic ease-in-out: slow at both ends, fast through the middle — the
 * same general shape a real hand's velocity profile follows when moving
 * between two points, per docs/BEHAVIORAL_EMULATION.md's Part 3. */
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function cubicBezier(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  const tt = t * t;
  const uu = u * u;
  const uuu = uu * u;
  const ttt = tt * t;
  return {
    x: uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
    y: uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y,
  };
}

/**
 * Generates the ordered sequence of intermediate mouse positions and
 * per-step delays a human-like move from `from` to `to` should send —
 * intended to become a real `Input.dispatchMouseEvent('mouseMoved', ...)`
 * call per point (see humanInputDriver.ts), not a single instant jump.
 *
 * Guarantees: the first point is always exactly `from` (delayMs: 0) and
 * the last point is always exactly `to`, regardless of jitter/overshoot —
 * jitter and overshoot only affect points strictly between them.
 */
export function buildHumanMousePath(from: Point, to: Point, options: HumanMousePathOptions = {}): MousePathPoint[] {
  const rng = options.rng ?? Math.random;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);

  if (distance === 0) {
    return [{ x: from.x, y: from.y, delayMs: 0 }];
  }

  const steps = Math.round(options.steps ?? clamp(distance / 8, MIN_STEPS, MAX_STEPS));
  const durationMs = options.durationMs ?? clamp(distance * 2, MIN_DURATION_MS, MAX_DURATION_MS);
  const jitterPx = options.jitterPx ?? DEFAULT_JITTER_PX;
  const curveOffsetPx = options.curveOffsetPx ?? clamp(distance * 0.15, MIN_CURVE_OFFSET_PX, MAX_CURVE_OFFSET_PX);

  // Perpendicular unit vector to the from->to line, used to bow the two
  // control points off the straight path.
  const perpX = -dy / distance;
  const perpY = dx / distance;

  const offset1 = (rng() * 2 - 1) * curveOffsetPx;
  const offset2 = (rng() * 2 - 1) * curveOffsetPx;
  const control1: Point = {
    x: from.x + dx * (1 / 3) + perpX * offset1,
    y: from.y + dy * (1 / 3) + perpY * offset1,
  };
  const control2: Point = {
    x: from.x + dx * (2 / 3) + perpX * offset2,
    y: from.y + dy * (2 / 3) + perpY * offset2,
  };

  const perStepDelay = durationMs / steps;
  const points: MousePathPoint[] = [];

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const eased = easeInOutCubic(t);
    const base = cubicBezier(from, control1, control2, to, eased);
    const isEndpoint = i === 0 || i === steps;
    const jitterX = isEndpoint || jitterPx === 0 ? 0 : (rng() * 2 - 1) * jitterPx;
    const jitterY = isEndpoint || jitterPx === 0 ? 0 : (rng() * 2 - 1) * jitterPx;
    points.push({
      x: base.x + jitterX,
      y: base.y + jitterY,
      delayMs: i === 0 ? 0 : perStepDelay,
    });
  }

  if (options.overshoot) {
    // Push the real target further out along the direction of travel, use
    // that as the path's second-to-last stop, then correct back onto the
    // exact real target as the true final point.
    const dirX = dx / distance;
    const dirY = dy / distance;
    const overshootPoint: MousePathPoint = {
      x: to.x + dirX * OVERSHOOT_PX,
      y: to.y + dirY * OVERSHOOT_PX,
      delayMs: perStepDelay,
    };
    points[points.length - 1] = overshootPoint;
    points.push({ x: to.x, y: to.y, delayMs: perStepDelay * 0.6 });
  }

  return points;
}
