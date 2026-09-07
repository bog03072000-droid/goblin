# Load test — database layer (raw data)

Generated: 2026-09-07T12:51:51.699Z

_Real measured numbers from this machine/run — not fabricated. Re-run with `npm run test:load` to reproduce._

## 20 profiles

| Operation | Time (ms) |
|---|---|
| create 20 profiles (total) | 20.89 |
| create 1 profile (average) | 1.04 |
| list all | 0.36 |
| search (name substring) | 0.27 |
| filter by tag | 0.14 |
| sort by name (client-side) | 5.92 |
| clone one profile (config) | 1.19 |
| delete one profile | 0.54 |

Process heap used at end of scale: 14.9 MB, RSS: 66.9 MB

## 50 profiles

| Operation | Time (ms) |
|---|---|
| create 50 profiles (total) | 45.42 |
| create 1 profile (average) | 0.91 |
| list all | 0.78 |
| search (name substring) | 0.27 |
| filter by tag | 0.22 |
| sort by name (client-side) | 0.03 |
| clone one profile (config) | 1.23 |
| delete one profile | 0.11 |

Process heap used at end of scale: 17.8 MB, RSS: 75.2 MB

## 100 profiles

| Operation | Time (ms) |
|---|---|
| create 100 profiles (total) | 100.27 |
| create 1 profile (average) | 1.00 |
| list all | 1.39 |
| search (name substring) | 0.29 |
| filter by tag | 0.40 |
| sort by name (client-side) | 0.07 |
| clone one profile (config) | 1.00 |
| delete one profile | 0.13 |

Process heap used at end of scale: 16.0 MB, RSS: 76.3 MB

## 200 profiles

| Operation | Time (ms) |
|---|---|
| create 200 profiles (total) | 169.88 |
| create 1 profile (average) | 0.85 |
| list all | 2.72 |
| search (name substring) | 1.59 |
| filter by tag | 0.69 |
| sort by name (client-side) | 0.13 |
| clone one profile (config) | 1.02 |
| delete one profile | 0.10 |

Process heap used at end of scale: 19.2 MB, RSS: 87.1 MB
