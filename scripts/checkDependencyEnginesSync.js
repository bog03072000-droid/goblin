#!/usr/bin/env node
/**
 * Same principle as checkBrowserVersionSync.js, generalized: fails the
 * build if any production dependency declares an `engines.node` range that
 * the REAL Node version bundled inside this project's installed Electron
 * doesn't satisfy — the exact class of bug that shipped, then got caught
 * only by a real E2E run, when undici@8 (engines.node >=22.19.0) was added
 * while Electron 32.3.3 bundles Node 20.18.1: importing it crashed every
 * profile start at module-load time (registerIpc.ts, which every profile
 * start path goes through, imported it transitively). Only production
 * `dependencies` are checked — devDependencies (vitest, playwright,
 * typescript, electron-builder, …) never run inside the packaged app's
 * main/renderer process, so their own Node requirements are irrelevant to
 * this specific failure mode.
 *
 * Deliberately does NOT check devDependencies' engines against the
 * Electron runtime, and does NOT check any dependency's engines against
 * the Node version running THIS script (irrelevant — the question is only
 * "will this satisfy Electron's bundled Node at runtime").
 */
const fs = require('node:fs');
const path = require('node:path');
const semver = require('semver');
const { getElectronRuntimeVersions } = require('./lib/getElectronRuntimeVersions');

let actualNodeVersion;
try {
  ({ node: actualNodeVersion } = getElectronRuntimeVersions());
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const rootPackageJsonPath = path.join(__dirname, '..', 'package.json');
const rootPackageJson = JSON.parse(fs.readFileSync(rootPackageJsonPath, 'utf-8'));
const productionDeps = Object.keys(rootPackageJson.dependencies || {});

const incompatible = [];
for (const name of productionDeps) {
  const depPackageJsonPath = path.join(__dirname, '..', 'node_modules', name, 'package.json');
  if (!fs.existsSync(depPackageJsonPath)) {
    // Not installed (e.g. optional peer dep never fetched) — nothing to
    // check; npm ci itself would already have failed loudly if this were
    // a real problem.
    continue;
  }
  const depPackageJson = JSON.parse(fs.readFileSync(depPackageJsonPath, 'utf-8'));
  const requiredRange = depPackageJson.engines && depPackageJson.engines.node;
  if (!requiredRange) continue;

  if (!semver.satisfies(actualNodeVersion, requiredRange, { includePrerelease: true })) {
    incompatible.push({ name, version: depPackageJson.version, requiredRange });
  }
}

if (incompatible.length > 0) {
  console.error(
    `Dependency/Electron Node version mismatch: the following production ` +
      `dependencies require a Node version this project's installed Electron ` +
      `does not provide (Electron bundles Node ${actualNodeVersion}):\n` +
      incompatible.map((d) => `  - ${d.name}@${d.version} requires node ${d.requiredRange}`).join('\n') +
      `\n\nImporting any of these inside the app's main process will fail at ` +
      `module-load time, not at typecheck/lint/unit-test time (unit tests mock ` +
      `most of these away) — only caught by a real E2E run against a built ` +
      `Electron binary until now. Downgrade to a version whose engines.node ` +
      `range includes ${actualNodeVersion}, or find an alternative dependency.`,
  );
  process.exit(1);
}

console.log(
  `OK: all ${productionDeps.length} production dependencies with an engines.node constraint are compatible with the installed Electron's bundled Node ${actualNodeVersion}.`,
);
