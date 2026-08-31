# Load test — database layer (raw data)

Generated: 2026-08-31T07:30:15.294Z

_Real measured numbers from this machine/run — not fabricated. Re-run with `npm run test:load` to reproduce._

## 20 profiles

| Operation | Time (ms) |
|---|---|
| create 20 profiles (total) | 19.86 |
| create 1 profile (average) | 0.99 |
| list all | 0.29 |
| search (name substring) | 0.23 |
| filter by tag | 0.14 |
| sort by name (client-side) | 6.44 |
| clone one profile (config) | 1.18 |
| delete one profile | 1.32 |

Process heap used at end of scale: 13.6 MB, RSS: 65.6 MB

## 50 profiles

| Operation | Time (ms) |
|---|---|
| create 50 profiles (total) | 42.45 |
| create 1 profile (average) | 0.85 |
| list all | 0.67 |
| search (name substring) | 0.26 |
| filter by tag | 0.24 |
| sort by name (client-side) | 0.03 |
| clone one profile (config) | 0.94 |
| delete one profile | 1.10 |

Process heap used at end of scale: 15.8 MB, RSS: 71.3 MB

## 100 profiles

| Operation | Time (ms) |
|---|---|
| create 100 profiles (total) | 87.91 |
| create 1 profile (average) | 0.88 |
| list all | 1.18 |
| search (name substring) | 0.21 |
| filter by tag | 0.30 |
| sort by name (client-side) | 0.11 |
| clone one profile (config) | 1.23 |
| delete one profile | 1.23 |

Process heap used at end of scale: 12.4 MB, RSS: 72.2 MB

## 200 profiles

| Operation | Time (ms) |
|---|---|
| create 200 profiles (total) | 155.34 |
| create 1 profile (average) | 0.78 |
| list all | 2.31 |
| search (name substring) | 1.36 |
| filter by tag | 0.55 |
| sort by name (client-side) | 0.14 |
| clone one profile (config) | 1.28 |
| delete one profile | 1.10 |

Process heap used at end of scale: 12.6 MB, RSS: 77.3 MB
