import { describe, it, expect } from 'vitest';
import { buildHumanScrollPlan } from '../../src/shared/automation/humanInput';

function makeSeededRng(values: number[]): () => number {
  let i = 0;
  return () => {
    const v = values[i % values.length]!;
    i++;
    return v;
  };
}

describe('buildHumanScrollPlan', () => {
  it('a zero-distance scroll produces an empty plan', () => {
    expect(buildHumanScrollPlan(0)).toEqual([]);
  });

  it('the events\' deltaY sums to exactly the requested total, without overshoot', () => {
    const plan = buildHumanScrollPlan(1200, { overshoot: false });
    const total = plan.reduce((sum, e) => sum + e.deltaY, 0);
    expect(total).toBeCloseTo(1200, 6);
  });

  it('the events\' deltaY sums to exactly the requested total, WITH overshoot (the correction cancels it out)', () => {
    const plan = buildHumanScrollPlan(1200, { overshoot: true });
    const total = plan.reduce((sum, e) => sum + e.deltaY, 0);
    expect(total).toBeCloseTo(1200, 6);
  });

  it('scrolling up (negative total) produces negative deltaY values summing to the negative total', () => {
    const plan = buildHumanScrollPlan(-800, { overshoot: false });
    for (const e of plan) {
      expect(e.deltaY).toBeLessThanOrEqual(0);
    }
    const total = plan.reduce((sum, e) => sum + e.deltaY, 0);
    expect(total).toBeCloseTo(-800, 6);
  });

  it('the first event has delayMs 0; subsequent events (with no pause) share a uniform base delay', () => {
    const plan = buildHumanScrollPlan(1000, { steps: 10, durationMs: 500, pauseProbability: 0 });
    expect(plan[0]!.delayMs).toBe(0);
    for (const e of plan.slice(1)) {
      expect(e.delayMs).toBeCloseTo(50, 5); // 500ms / 10 steps
    }
  });

  it('overshoot adds exactly one corrective final event with the opposite sign of the main scroll', () => {
    const withOvershoot = buildHumanScrollPlan(1000, { steps: 8, overshoot: true });
    const withoutOvershoot = buildHumanScrollPlan(1000, { steps: 8, overshoot: false });
    expect(withOvershoot.length).toBe(withoutOvershoot.length + 1);
    const correction = withOvershoot[withOvershoot.length - 1]!;
    expect(correction.deltaY).toBeLessThan(0); // scrolling down overall -> correction scrolls back up
  });

  it('without overshoot, the cumulative scroll position never exceeds the requested total', () => {
    const plan = buildHumanScrollPlan(1000, { overshoot: false, steps: 12 });
    let cumulative = 0;
    for (const e of plan) {
      cumulative += e.deltaY;
      expect(cumulative).toBeLessThanOrEqual(1000.001);
    }
  });

  it('with overshoot, the cumulative position exceeds the requested total at some point before the final correction', () => {
    const plan = buildHumanScrollPlan(1000, { overshoot: true, steps: 12 });
    let cumulative = 0;
    let maxCumulative = 0;
    for (const e of plan) {
      cumulative += e.deltaY;
      maxCumulative = Math.max(maxCumulative, cumulative);
    }
    expect(maxCumulative).toBeGreaterThan(1000);
    // But the true final cumulative position lands back exactly on target.
    expect(cumulative).toBeCloseTo(1000, 6);
  });

  it('speed is non-uniform: the middle step covers more distance than the first or last step', () => {
    const plan = buildHumanScrollPlan(2000, { steps: 20, overshoot: false });
    const first = Math.abs(plan[0]!.deltaY);
    const middle = Math.abs(plan[Math.floor(plan.length / 2)]!.deltaY);
    const last = Math.abs(plan[plan.length - 1]!.deltaY);
    expect(middle).toBeGreaterThan(first);
    expect(middle).toBeGreaterThan(last);
  });

  it('pauseProbability: 0 (the default) never adds extra delay beyond the uniform per-step amount', () => {
    const rngAlwaysTriggers = () => 0; // would trigger a pause if probability > 0
    const plan = buildHumanScrollPlan(600, { steps: 6, durationMs: 300, rng: rngAlwaysTriggers });
    for (const e of plan.slice(1)) {
      expect(e.delayMs).toBeCloseTo(50, 5); // 300ms / 6 steps, no pause added
    }
  });

  it('pauseProbability: 1 adds pauseMs to every step after the first', () => {
    const rng = makeSeededRng([0]); // always < any positive probability
    const plan = buildHumanScrollPlan(600, { steps: 6, durationMs: 300, pauseProbability: 1, pauseMs: 100, rng });
    expect(plan[0]!.delayMs).toBe(0);
    for (const e of plan.slice(1)) {
      expect(e.delayMs).toBeCloseTo(50 + 100, 5);
    }
  });

  it('steps/durationMs are clamped to sane bounds for a tiny or huge distance', () => {
    const tiny = buildHumanScrollPlan(5);
    expect(tiny.length).toBeGreaterThanOrEqual(4); // MIN_SCROLL_STEPS
    const huge = buildHumanScrollPlan(50_000);
    expect(huge.length).toBeLessThanOrEqual(24); // MAX_SCROLL_STEPS
    const totalDelay = huge.slice(1).reduce((sum, e) => sum + e.delayMs, 0);
    expect(totalDelay).toBeLessThanOrEqual(1000.001); // MAX_SCROLL_DURATION_MS
  });

  it('an explicit steps/durationMs option overrides the distance-based default', () => {
    const plan = buildHumanScrollPlan(10_000, { steps: 5, durationMs: 100, overshoot: false });
    expect(plan.length).toBe(5);
    // 5 events means 4 non-first delays (the first is always 0), each
    // durationMs/steps = 20ms — unlike buildHumanMousePath (steps+1
    // points, so its delays do sum to the full duration), a scroll plan
    // with `steps` events has one fewer inter-event gap than points.
    const totalDelay = plan.slice(1).reduce((sum, e) => sum + e.delayMs, 0);
    expect(totalDelay).toBeCloseTo(80, 5);
  });
});
