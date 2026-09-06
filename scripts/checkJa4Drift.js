#!/usr/bin/env node
/**
 * NOT part of the automated CI gate — a live network call to a third-party
 * service (tls.peet.ws) on every CI run was explicitly rejected as a
 * flakiness risk (see docs/FINGERPRINT_AUDIT.md's "Ninth investigation"
 * Result 4, and the JA3 section next to it). This is instead a one-time,
 * developer-invoked check to run manually after upgrading Electron — see
 * DEVELOPMENT.md's "Checking for JA4 drift after an Electron upgrade"
 * section for when and why.
 *
 * What it does: launches the real installed Electron binary, has it make a
 * real HTTPS request through Chromium's actual network stack to
 * https://tls.peet.ws/api/all (the same public TLS-fingerprint echo
 * service used in the original investigation — not a synthetic handshake),
 * and compares the returned JA4 hash against the reference value this
 * project's Chromium 128 build was confirmed to match at the time of that
 * investigation. It does NOT compare against ja4db.com automatically
 * (that database has no stable API contract to depend on) — a mismatch
 * here means "go check ja4db.com by hand and update this file's reference
 * value / docs/FINGERPRINT_AUDIT.md", not "the build is broken".
 */
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// The exact value docs/FINGERPRINT_AUDIT.md's Ninth investigation captured
// and confirmed against ja4db.com's public "Chromium Browser" entry for
// this project's Electron 32.3.3 / Chromium 128.0.6613.186 build.
const REFERENCE_JA4 = 't13d1516h2_8daaf6152771_02713d6af862';
const REFERENCE_CHROME_MAJOR = '128';

const electronBin = require('electron');
const probeScript = path.join(__dirname, 'ja4DriftProbe.js');

console.log('Launching the real installed Electron binary to capture a live JA4 fingerprint from tls.peet.ws...');
const result = spawnSync(electronBin, [probeScript], { encoding: 'utf-8', timeout: 30_000 });

if (result.error || result.status !== 0) {
  console.error('Failed to run the JA4 probe:', result.stderr || result.error);
  console.error('This usually means no internet access from this machine, or tls.peet.ws is down — retry, or run the same check manually against a different TLS-fingerprint echo service.');
  process.exit(1);
}

let parsed;
try {
  parsed = JSON.parse(result.stdout);
} catch (err) {
  console.error('Could not parse the probe\'s response as JSON:', result.stdout);
  process.exit(1);
}

const observedJa4 = parsed.tls && parsed.tls.ja4;
if (!observedJa4) {
  console.error('Response had no "tls.ja4" field — tls.peet.ws may have changed its response shape. Raw response:', JSON.stringify(parsed, null, 2));
  process.exit(1);
}

console.log(`Observed JA4: ${observedJa4}`);
console.log(`Reference JA4 (Chromium ${REFERENCE_CHROME_MAJOR}, from docs/FINGERPRINT_AUDIT.md): ${REFERENCE_JA4}`);

if (observedJa4 === REFERENCE_JA4) {
  console.log(`OK: JA4 matches the reference value — no drift detected for this Electron build.`);
  process.exit(0);
}

console.warn('');
console.warn('MISMATCH — this does not necessarily mean anything is broken, but it needs a human to confirm:');
console.warn(`  1. Look up "${observedJa4}" at https://ja4db.com and confirm it is still catalogued under`);
console.warn('     "Chromium Browser" (or the equivalent real-browser entry for whatever Chromium version');
console.warn('     this Electron upgrade now bundles) — not something that reads as automation/non-browser.');
console.warn('  2. If it checks out as a legitimate real-Chromium value: update REFERENCE_JA4 and');
console.warn('     REFERENCE_CHROME_MAJOR in this script, and add a dated note to docs/FINGERPRINT_AUDIT.md\'s');
console.warn('     "Ninth investigation" section recording the new value and the Electron/Chromium version it');
console.warn('     was captured against — same as the original investigation\'s own captures.');
console.warn('  3. If it does NOT check out (e.g. it is not catalogued as a real browser at all), that is a');
console.warn('     genuine regression worth investigating before shipping this Electron upgrade.');
process.exit(2);
