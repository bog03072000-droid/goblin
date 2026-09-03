/**
 * electron-builder Windows signing hook — a TEMPLATE, not yet wired to a
 * real certificate. See DEVELOPMENT.md's "Code signing" section for the
 * full research this is based on: why an unsigned build shows two separate
 * Windows warnings, and the three real options with current (2026)
 * pricing/eligibility. This file exists so that once a real certificate or
 * Azure Trusted Signing enrollment is in hand, wiring it in is a config/env
 * change here, not new code.
 *
 * CURRENTLY A NO-OP either way:
 *  - It won't even run yet: build.win.signAndEditExecutable is set to
 *    `false` in package.json, which skips electron-builder's Windows
 *    signing step entirely (see DEVELOPMENT.md for why that flag is set —
 *    a Developer-Mode/admin-privilege workaround on the dev machine, not
 *    a signing-related choice). Flip it to `true` (electron-builder's own
 *    default) once you're ready to actually sign a release build, from an
 *    environment that doesn't have that limitation (a normal CI runner
 *    usually doesn't).
 *  - Even if it did run, the early return below skips signing unless the
 *    real certificate's env vars are actually set, so the ordinary unsigned
 *    dev/package build keeps working exactly as it does today.
 *
 * ── Option B: Azure Trusted Signing (recommended in DEVELOPMENT.md) ──────
 * 1. Enroll at https://azure.microsoft.com/en-us/products/artifact-signing
 *    (individual enrollment: US/Canada only as of this writing; org
 *    enrollment: also EU/UK — check current eligibility before committing).
 * 2. `npm install --save-dev @azure/trusted-signing-cli`
 * 3. Set these as CI secrets / env vars before `npm run package` (never
 *    commit them):
 *      AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET
 *        — a service principal with the "Trusted Signing Certificate
 *          Profile Signer" role on your Trusted Signing account.
 *      AZURE_ENDPOINT
 *        — e.g. https://eus.codesigning.azure.net (region-specific).
 *      AZURE_CODE_SIGNING_ACCOUNT_NAME, AZURE_CERTIFICATE_PROFILE_NAME
 *        — from the Trusted Signing account/profile you created.
 * 4. Uncomment the Option B block below.
 *
 * ── Option C: a traditional .pfx or hardware-token EV certificate ────────
 * A static, portable .pfx doesn't need this file at all: set the
 * CSC_LINK / CSC_KEY_PASSWORD env vars (see DEVELOPMENT.md) and remove
 * `win.sign` from package.json entirely — electron-builder signs with those
 * two directly. A hardware-token/HSM-bound EV certificate usually DOES need
 * this file, calling your CA's own signtool.exe invocation (the exact
 * command is CA- and token-specific — consult their electron-builder/
 * Windows signing instructions). Uncomment and adapt the Option C block
 * below once you have that command.
 *
 * `configuration` is electron-builder's CustomWindowsSignTaskConfiguration —
 * configuration.path is the absolute path to the .exe to sign in place.
 */
module.exports = async function sign(configuration) {
  const hasAzureTrustedSigningConfig =
    process.env.AZURE_TENANT_ID && process.env.AZURE_CLIENT_ID && process.env.AZURE_CLIENT_SECRET;

  if (!hasAzureTrustedSigningConfig) {
    // Nothing configured yet — leave the build unsigned, exactly as before
    // this file existed. Not an error: most local/dev packages are never
    // meant to be signed.
    return;
  }

  // ── Option B: Azure Trusted Signing ─────────────────────────────────────
  // const { trustedSigning } = require('@azure/trusted-signing-cli');
  // await trustedSigning({
  //   path: configuration.path,
  //   endpoint: process.env.AZURE_ENDPOINT,
  //   codeSigningAccountName: process.env.AZURE_CODE_SIGNING_ACCOUNT_NAME,
  //   certificateProfileName: process.env.AZURE_CERTIFICATE_PROFILE_NAME,
  //   // Matches electron-builder's own default signing algorithm.
  //   fileDigest: 'SHA256',
  // });

  // ── Option C: hardware-token / HSM EV certificate via your CA's signtool ─
  // const { execFile } = require('node:child_process');
  // await new Promise((resolve, reject) => {
  //   execFile(
  //     'signtool.exe',
  //     ['sign', '/fd', 'sha256', '/tr', 'http://timestamp.digicert.com', '/td', 'sha256', configuration.path],
  //     (err) => (err ? reject(err) : resolve()),
  //   );
  // });
};
