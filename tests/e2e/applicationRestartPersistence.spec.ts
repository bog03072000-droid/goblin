import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Not a page reload and not mocked repositories — two genuinely separate
 * `electron.launch()` calls (two full OS process lifetimes) against the same
 * `--user-data-dir`, proving the real SQLite file + on-disk profile storage
 * survive the manager application itself being fully closed and reopened.
 */
test.setTimeout(60_000);

test('a profile, its configuration, and its storage all survive closing and reopening the application', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-e2e-restart-persist-'));

  try {
    // --- First launch: create and configure a profile ---
    let app = await electron.launch({
      args: [path.join(__dirname, '..', '..'), `--user-data-dir=${userDataDir}`],
      env: { ...process.env, PF_E2E_LOCALE: 'en' },
    });
    let window = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');

    await window.getByPlaceholder('New profile name').fill('Persistent Profile');
    await window.getByRole('button', { name: 'New Profile' }).click();
    await window.locator('.modal-panel').getByRole('button', { name: 'Create profile' }).click();
    const row = () => window.locator('tr', { has: window.locator('td', { hasText: 'Persistent Profile' }) });
    await expect(row()).toBeVisible({ timeout: 15_000 });

    // A proxy to assign, so proxy configuration is also real state to verify
    // survives restart — not just the profile row and its description/tags.
    await window.getByText('Proxies', { exact: true }).click();
    await window.getByPlaceholder('Name', { exact: true }).fill('Persistent Proxy');
    await window.getByPlaceholder('Host').fill('127.0.0.1');
    await window.getByPlaceholder('Port').fill('8080');
    await window.getByRole('button', { name: 'Add Proxy' }).click();
    await expect(window.locator('td', { hasText: 'Persistent Proxy' })).toBeVisible({ timeout: 10_000 });
    await window.getByText('Profiles', { exact: true }).click();

    // Configure it: rename via the editor, add a tag, assign the proxy, and
    // read the auto-generated User-Agent — real configuration state to
    // verify survives, not just the row's existence.
    await row().getByRole('button', { name: 'Edit' }).click();
    await window.getByLabel('Description').fill('Configured before restart');
    await window.getByLabel('Tags (comma-separated)').fill('survives-restart');
    await window.getByRole('button', { name: 'Save' }).click();

    await window.getByText('proxy', { exact: true }).click();
    await window.getByLabel('Assigned proxy').selectOption({ label: 'Persistent Proxy (http://127.0.0.1:8080)' });
    await window.getByRole('button', { name: 'Save' }).click();

    await window.getByText('fingerprint', { exact: true }).click();
    const userAgentBefore = await window
      .locator('tr', { has: window.locator('th', { hasText: 'User-Agent' }) })
      .locator('td')
      .textContent();
    expect(userAgentBefore).toBeTruthy();

    await window.getByRole('button', { name: 'Close' }).click();

    const profileDirsBefore = fs.readdirSync(path.join(userDataDir, 'profiles'));
    expect(profileDirsBefore.length).toBe(1);
    const profileDir = path.join(userDataDir, 'profiles', profileDirsBefore[0]!);
    expect(fs.existsSync(path.join(profileDir, 'browser-data'))).toBe(true);

    // Fully close the application — a real process exit, not a page navigation.
    await app.close();

    // --- Second launch: same userData, brand-new OS process ---
    app = await electron.launch({
      args: [path.join(__dirname, '..', '..'), `--user-data-dir=${userDataDir}`],
      env: { ...process.env, PF_E2E_LOCALE: 'en' },
    });
    window = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');

    await expect(row()).toBeVisible({ timeout: 15_000 });
    await expect(row().locator('.tag', { hasText: 'survives-restart' })).toBeVisible();

    // Configuration (description) round-tripped through the real SQLite file.
    await row().getByRole('button', { name: 'Edit' }).click();
    await expect(window.getByLabel('Description')).toHaveValue('Configured before restart');

    // Proxy assignment survived the restart too.
    await window.getByText('proxy', { exact: true }).click();
    await expect(window.getByLabel('Assigned proxy')).toHaveValue(/.+/);
    await expect(window.getByLabel('Assigned proxy')).not.toHaveValue('');

    // The exact same fingerprint (not a freshly regenerated one) is still there.
    await window.getByText('fingerprint', { exact: true }).click();
    const userAgentAfter = await window
      .locator('tr', { has: window.locator('th', { hasText: 'User-Agent' }) })
      .locator('td')
      .textContent();
    expect(userAgentAfter).toBe(userAgentBefore);

    await window.getByRole('button', { name: 'Close' }).click();

    // On-disk storage directory is still exactly where it was.
    const profileDirsAfter = fs.readdirSync(path.join(userDataDir, 'profiles'));
    expect(profileDirsAfter).toEqual(profileDirsBefore);
    expect(fs.existsSync(path.join(profileDir, 'browser-data'))).toBe(true);

    // Starting it after the restart works cleanly (no stale-lock confusion
    // left over from the previous process — see LockManager's stale-lock
    // recovery, exercised here against a real prior app lifetime).
    await row().getByRole('button', { name: 'Start', exact: true }).click();
    await expect(row()).toHaveAttribute('data-status', 'RUNNING', { timeout: 30_000 });
    await row().getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(row()).toHaveAttribute('data-status', 'STOPPED', { timeout: 30_000 });

    await app.close();
  } finally {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
