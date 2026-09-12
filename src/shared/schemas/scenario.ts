import { z } from 'zod';

/**
 * A no-code automation scenario: a recorded sequence of real user actions
 * (click / typed text / navigation) that can be replayed later against any
 * running profile — see docs/SCENARIO_BUILDER.md for the recording/
 * playback architecture and its real, documented MVP limits (this is
 * explicitly a minimal first version, not a full visual script editor —
 * see that doc for what a fuller version would need).
 */
export const ScenarioStepSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('click'),
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    // Milliseconds since the previous step (or since recording started, for
    // the first step) — used to pace playback so it doesn't replay as one
    // instant burst. Capped at a sane maximum at playback time (see
    // scenarioPlayer.ts) so a long real pause while recording doesn't turn
    // into an equally long wait on every replay.
    delayMs: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal('type'),
    text: z.string(),
    delayMs: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal('navigate'),
    url: z.string(),
    delayMs: z.number().int().nonnegative(),
  }),
]);
export type ScenarioStep = z.infer<typeof ScenarioStepSchema>;

export const ScenarioSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(120),
  steps: z.array(ScenarioStepSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Scenario = z.infer<typeof ScenarioSchema>;

export const ScenarioSaveInputSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(120),
  steps: z.array(ScenarioStepSchema).min(1).max(200),
});
export type ScenarioSaveInput = z.infer<typeof ScenarioSaveInputSchema>;
