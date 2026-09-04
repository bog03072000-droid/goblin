/**
 * Thin guard in front of `electron-azure-trusted-signing` (the real
 * package that does the actual Azure Trusted Signing work — see
 * DEVELOPMENT.md's "Code signing" section for the full story, including
 * why an npm package this doc used to point at instead doesn't exist).
 *
 * This wrapper exists because the real package has NO no-op guard of its
 * own: it throws immediately if `sign.env` isn't fully populated with real
 * credentials — confirmed directly, not assumed: pointing
 * `build.win.signtoolOptions.sign` straight at the package name broke even
 * the default, unsigned `npm run package` build (NSIS signs its
 * uninstaller unconditionally whenever a signtool is configured at all,
 * regardless of `signAndEditExecutable`), which is the opposite of what a
 * default build should do. This file restores "no real credentials
 * configured → build stays unsigned, exactly like today" as the default,
 * while still using the real signing package once `sign.env` is filled in.
 *
 * `configuration` is electron-builder's CustomWindowsSignTaskConfiguration —
 * passed straight through to the real package unchanged.
 */
const fs = require('node:fs');
const path = require('node:path');

const envPath = path.join(__dirname, '..', 'sign.env');

module.exports = async function sign(configuration) {
  if (!fs.existsSync(envPath)) return;

  const dotenv = require('dotenv');
  const { AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, TRUSTEDSIGNING_ACCOUNT_NAME, TRUSTEDSIGNING_PROFILE_NAME } = dotenv.parse(
    fs.readFileSync(envPath, 'utf-8'),
  );
  const hasRealConfig =
    AZURE_TENANT_ID && AZURE_CLIENT_ID && AZURE_CLIENT_SECRET && TRUSTEDSIGNING_ACCOUNT_NAME && TRUSTEDSIGNING_PROFILE_NAME;
  if (!hasRealConfig) return;

  const realSign = require('electron-azure-trusted-signing');
  return realSign(configuration);
};
