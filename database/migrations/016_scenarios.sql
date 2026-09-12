-- No-code automation scenarios (see docs/SCENARIO_BUILDER.md) — a recorded
-- sequence of click/type/navigate steps, not tied to any single profile
-- (a scenario recorded against one profile can be replayed against any
-- other running profile, the same "reusable script" model as a real
-- Puppeteer/Playwright script the automation API already supports writing
-- by hand). `steps` is a JSON array (ScenarioStepSchema[]), same
-- TEXT-holding-JSON approach as profiles.schedule_days/extension_paths —
-- a scenario's steps have no independent lifecycle or relational identity
-- of their own, so a join table would be pure overhead here.
CREATE TABLE scenarios (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  steps TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
