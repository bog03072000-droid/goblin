# Load test — database layer (raw data)

Generated: 2026-09-09T14:58:01.682Z

_Real measured numbers from this machine/run — not fabricated. Re-run with `npm run test:load` to reproduce._

## 20 profiles

| Operation | Time (ms) |
|---|---|
| create 20 profiles (total) | 22.50 |
| create 1 profile (average) | 1.13 |
| list all | 0.42 |
| search (name substring) | 0.35 |
| filter by tag | 0.16 |
| sort by name (client-side) | 6.40 |
| clone one profile (config) | 1.30 |
| delete one profile | 0.23 |

Process heap used at end of scale: 14.9 MB, RSS: 66.9 MB

## 50 profiles

| Operation | Time (ms) |
|---|---|
| create 50 profiles (total) | 50.15 |
| create 1 profile (average) | 1.00 |
| list all | 0.85 |
| search (name substring) | 0.37 |
| filter by tag | 0.38 |
| sort by name (client-side) | 0.03 |
| clone one profile (config) | 1.14 |
| delete one profile | 0.11 |

Process heap used at end of scale: 17.9 MB, RSS: 75.0 MB

## 100 profiles

| Operation | Time (ms) |
|---|---|
| create 100 profiles (total) | 103.88 |
| create 1 profile (average) | 1.04 |
| list all | 1.84 |
| search (name substring) | 0.30 |
| filter by tag | 0.47 |
| sort by name (client-side) | 0.07 |
| clone one profile (config) | 1.05 |
| delete one profile | 0.10 |

Process heap used at end of scale: 16.1 MB, RSS: 76.4 MB

## 200 profiles

| Operation | Time (ms) |
|---|---|
| create 200 profiles (total) | 188.92 |
| create 1 profile (average) | 0.94 |
| list all | 2.81 |
| search (name substring) | 2.03 |
| filter by tag | 0.89 |
| sort by name (client-side) | 0.14 |
| clone one profile (config) | 1.47 |
| delete one profile | 0.12 |

Process heap used at end of scale: 19.2 MB, RSS: 86.9 MB
