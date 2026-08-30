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
    const row = () => window.locator('tr', { has: window.locator('td', { hasText: 'Persistent Profile' }) });
    await expect(row()).toBeVisible({ timeout: 15_000 });

    // Configure it: rename via the editor, add a tag, so there's real
    // configuration state to verify survives, not just the row's existence.
    await row().getByRole('button', { name: 'Edit' }).click();
    await window.getByLabel('Description').fill('Configured before restart');
    await window.getByLabel('Tags (comma-separated)').fill('survives-restart');
    await window.getByRole('button', { name: 'Save' }).click();
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
