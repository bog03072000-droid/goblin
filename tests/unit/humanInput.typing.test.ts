import { describe, it, expect } from 'vitest';
import { buildHumanTypingPlan } from '../../src/shared/automation/humanInput';

function makeSeededRng(values: number[]): () => number {
  let i = 0;
  return () => {
    const v = values[i % values.length]!;
    i++;
    return v;
  };
}

describe('buildHumanTypingPlan', () => {
  it('produces one event per character (no mistakes) with the right chars, in order', () => {
    const plan = buildHumanTypingPlan('abc', { mistakeProbability: 0 });
    expect(plan.map((e) => e.char)).toEqual(['a', 'b', 'c']);
  });

  it('the first event has delayMs 0; every subsequent event has a positive delay', () => {
    const plan = buildHumanTypingPlan('hello');
    expect(plan[0]!.delayMs).toBe(0);
    for (const event of plan.slice(1)) {
      expect(event.delayMs).toBeGreaterThan(0);
    }
  });

  it('delays are never below minDelayMs, even with a huge negative-pulling Gaussian sample', () => {
    // rng() values close to 1 for u1 push -2*ln(u1) toward 0, and a
    // particular u2 phase makes cos() negative — engineered here to try to
    // produce a low/negative raw sample, which minDelayMs must still floor.
    const rng = makeSeededRng([0.999999, 0.5]);
    const plan = buildHumanTypingPlan('aa', { minDelayMs: 30, meanDelayMs: 10, stdDevMs: 100, rng });
    for (const event of plan) {
      expect(event.delayMs).toBeGreaterThanOrEqual(0); // first event
    }
    expect(plan[1]!.delayMs).toBeGreaterThanOrEqual(30);
  });

  it('delay distribution is centered near meanDelayMs, not constant, over many samples', () => {
    const longText = 'a'.repeat(300);
    const plan = buildHumanTypingPlan(longText, { meanDelayMs: 100, stdDevMs: 20, mistakeProbability: 0 });
    const delays = plan.slice(1).map((e) => e.delayMs);
    const mean = delays.reduce((s, d) => s + d, 0) / delays.length;
    expect(mean).toBeGreaterThan(80);
    expect(mean).toBeLessThan(120);
    // Not constant: real variance, not every sample identical.
    const uniqueValues = new Set(delays.map((d) => Math.round(d * 1000)));
    expect(uniqueValues.size).toBeGreaterThan(10);
  });

  it('mistakeProbability: 0 (the default) never injects a mistake, regardless of rng', () => {
    const rngAlwaysTriggers = () => 0; // would satisfy rng() < mistakeProbability if probability > 0
    const plan = buildHumanTypingPlan('abcdef', { rng: rngAlwaysTriggers });
    expect(plan.some((e) => e.mistake)).toBe(false);
    expect(plan.some((e) => e.backspace)).toBe(false);
    expect(plan.map((e) => e.char)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('mistakeProbability: 1 injects a wrong-key + Backspace before every mistake-eligible (a-z) character', () => {
    const rng = makeSeededRng([0.999, 0.0001]); // rng() < 1 always true; picks the first neighbor deterministically
    const plan = buildHumanTypingPlan('ab', { mistakeProbability: 1, rng });
    // Each of 'a' and 'b' should be preceded by a mistake+backspace pair,
    // then the correct character itself.
    expect(plan.length).toBe(6);
    expect(plan[0]!.mistake).toBe(true);
    expect(plan[1]!.backspace).toBe(true);
    expect(plan[1]!.char).toBe('Backspace');
    expect(plan[2]!.char).toBe('a');
    expect(plan[2]!.mistake).toBeUndefined();
    expect(plan[3]!.mistake).toBe(true);
    expect(plan[4]!.backspace).toBe(true);
    expect(plan[5]!.char).toBe('b');
  });

  it('a mistyped character is always a real QWERTY-adjacent key to the intended one, never arbitrary', () => {
    const rng = makeSeededRng([0.999, 0.5, 0.999, 0.9]);
    const plan = buildHumanTypingPlan('s', { mistakeProbability: 1, rng });
    const mistypedChar = plan[0]!.char;
    expect(['a', 'd', 'w']).toContain(mistypedChar); // QWERTY_NEIGHBORS['s']
  });

  it('non-letter characters (digits, punctuation, space) never get a mistake, even at mistakeProbability: 1', () => {
    const rng = () => 0; // would always trigger a mistake for an eligible character
    const plan = buildHumanTypingPlan('1! ', { mistakeProbability: 1, rng });
    expect(plan.map((e) => e.char)).toEqual(['1', '!', ' ']);
    expect(plan.every((e) => !e.mistake && !e.backspace)).toBe(true);
  });

  it('an empty string produces an empty plan', () => {
    expect(buildHumanTypingPlan('')).toEqual([]);
  });
});
