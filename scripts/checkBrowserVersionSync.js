#!/usr/bin/env node
/**
 * Guards against exactly the drift docs/FINGERPRINT_AUDIT.md's "Ninth
 * investigation" (TLS ClientHello/JA3/JA4) flagged as a real, currently-
 * dormant risk: platformProfiles.ts hardcodes `browserVersion` (baked into
 * every generated profile's spoofed User-Agent), which today happens to
 * match the real, installed Electron/Chromium version — but nothing
 * enforced that beyond manual attention. If a future Electron upgrade
 * changes the real Chromium major version without this file being updated
 * to match, the spoofed UA would claim one Chrome version while the real
 * TLS handshake's extension set exhibits another — a new, easily
 * automatable detection signal (compare UA's claimed Chrome version
 * against a JA4 database lookup) that does not exist today. This script
 * makes that comparison itself, at build time, instead of relying on
 * someone remembering to check it by hand on every Electron bump.
 *
 * Run under plain Node (this is a build-time check, not part of the app
 * itself) — spawns the real Electron binary via printChromeVersion.js
 * specifically to read process.versions.chrome, which only exists inside
 * an actual Electron process.
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const electronBin = require('electron');
const printerScript = path.join(__dirname, 'printChromeVersion.js');

const result = spawnSync(electronBin, [printerScript], { encoding: 'utf-8', timeout: 30_000 });
if (result.error || result.status !== 0) {
  console.error('Failed to launch Electron to read its real Chromium version:');
  console.error(result.stderr || result.error);
  process.exit(1);
}

// The last non-empty line, in case Electron prints unrelated stray
// warnings to stdout before app.whenReady() resolves.
const lines = result.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
const actualChromeVersion = lines[lines.length - 1];
if (!actualChromeVersion || !/^\d+\.\d+\.\d+\.\d+$/.test(actualChromeVersion)) {
  console.error(`Could not parse a Chromium version out of Electron's output: ${JSON.stringify(result.stdout)}`);
  process.exit(1);
}
const actualMajor = actualChromeVersion.split('.')[0];

const platformProfilesPath = path.join(__dirname, '..', 'src', 'main', 'fingerprint', 'platformProfiles.ts');
const source = fs.readFileSync(platformProfilesPath, 'utf-8');
const configuredVersions = [...source.matchAll(/browserVersion:\s*'([\d.]+)'/g)].map((m) => m[1]);
if (configuredVersions.length === 0) {
  console.error(`No "browserVersion: '...'" literals found in ${platformProfilesPath} — did the field get renamed or restructured?`);
  process.exit(1);
}

const uniqueConfigured = [...new Set(configuredVersions)];
const mismatches = uniqueConfigured.filter((v) => v.split('.')[0] !== actualMajor);

if (mismatches.length > 0) {
  console.error(
    `browserVersion drift detected: platformProfiles.ts configures ${uniqueConfigured.join(', ')}, but the ` +
      `real installed Electron embeds Chromium ${actualChromeVersion} (major ${actualMajor}). Every generated ` +
      `profile's spoofed User-Agent would silently claim a different Chrome version than its real TLS ` +
      `handshake exhibits (see docs/FINGERPRINT_AUDIT.md's "Ninth investigation" for why that's a real, ` +
      `detectable signal). Update browserVersion in platformProfiles.ts to match the real Electron version.`,
  );
  process.exit(1);
}

console.log(
  `OK: platformProfiles.ts's browserVersion (${uniqueConfigured.join(', ')}) matches the real installed Electron's Chromium ${actualChromeVersion}.`,
);
