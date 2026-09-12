const params = new URLSearchParams(location.search);
const partition = params.get('partition') || '';
const userAgent = params.get('ua') || '';
const startUrl = params.get('start') || 'https://www.google.com';
const label = params.get('label') || '';
const diagnosticsUrl = params.get('diagnostics') || '';
document.getElementById('label').textContent = label;

// Multi-tab model: every profile keeps exactly ONE session (partition) —
// tabs are just multiple <webview> guests sharing that same partition, so
// cookies/localStorage/IndexedDB stay unified across tabs within a
// profile while still never touching any other profile's session.
let tabs = [];
let activeTabId = null;
let nextTabId = 1;
const webviewsEl = document.getElementById('webviews');
const tabbarEl = document.getElementById('tabbar');
const newTabBtn = document.getElementById('new-tab');

function createTab(options) {
  const id = nextTabId++;
  const webview = document.createElement('webview');
  webview.setAttribute('partition', partition);
  if (userAgent) webview.setAttribute('useragent', userAgent);
  webview.setAttribute('src', 'about:blank');
  // Stays laid out (never display:none) so its guest process always has
  // a correct, current size to render into — only visibility/z-index
  // switch when the tab isn't the active one. See the #webviews CSS
  // comment for why display-toggling caused a stuck small render area.
  webview.style.visibility = 'hidden';
  webview.style.zIndex = '0';
  webviewsEl.appendChild(webview);

  const tabEl = document.createElement('div');
  tabEl.className = 'tab';
  tabEl.dataset.tabId = String(id);
  tabEl.innerHTML =
    '<span class="tab-title">New Tab</span><span class="tab-close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></span>';
  tabbarEl.insertBefore(tabEl, newTabBtn);

  const tab = { id, webview, tabEl, url: 'about:blank', title: 'New Tab' };
  tabs.push(tab);

  webview.addEventListener('did-navigate', (e) => {
    tab.url = e.url;
    if (tab.id === activeTabId) document.getElementById('address').value = e.url;
  });
  webview.addEventListener('did-navigate-in-page', (e) => {
    tab.url = e.url;
    if (tab.id === activeTabId) document.getElementById('address').value = e.url;
  });
  webview.addEventListener('page-title-updated', (e) => {
    tab.title = e.title || tab.url;
    tabEl.querySelector('.tab-title').textContent = tab.title;
    tabEl.title = tab.title;
  });

  tabEl.querySelector('.tab-title').addEventListener('click', () => activateTab(id));
  tabEl.querySelector('.tab-close').addEventListener('click', (ev) => {
    ev.stopPropagation();
    closeTab(id);
  });

  if (options && options.duplicateFromUrl) {
    // The real per-profile fingerprint enforcement (CDP overrides) is
    // applied by the main process on every webview attach, then it
    // navigates to the normal start page — only after that do we hop to
    // the URL being duplicated, so enforcement is never raced.
    webview.addEventListener(
      'did-navigate',
      () => navigateTab(tab, options.duplicateFromUrl),
      { once: true },
    );
  }

  activateTab(id);
  return tab;
}

function activateTab(id) {
  activeTabId = id;
  for (const tab of tabs) {
    const isActive = tab.id === id;
    tab.webview.style.visibility = isActive ? 'visible' : 'hidden';
    tab.webview.style.zIndex = isActive ? '1' : '0';
    tab.webview.style.pointerEvents = isActive ? 'auto' : 'none';
    tab.tabEl.classList.toggle('active', isActive);
  }
  const active = tabs.find((t) => t.id === id);
  if (active) document.getElementById('address').value = active.url;
}

function closeTab(id) {
  if (tabs.length <= 1) return; // always keep at least one tab open
  const index = tabs.findIndex((t) => t.id === id);
  if (index === -1) return;
  const [tab] = tabs.splice(index, 1);
  tab.webview.remove();
  tab.tabEl.remove();
  if (activeTabId === id) {
    const next = tabs[index] || tabs[index - 1];
    if (next) activateTab(next.id);
  }
}

function activeTab() {
  return tabs.find((t) => t.id === activeTabId) || null;
}

function navigateTab(tab, url) {
  // Routed through the main process (window.pfNav, see
  // browserShellPreload.ts) rather than the <webview> tag's `src` attribute
  // — attribute-based navigation goes through the webview guest-bridge's own
  // internal IPC hop, whose latency under load raced (non-deterministically)
  // against the main process's own loadURL() call for the default start
  // page. A real, reproducible CI-only failure, not a hypothetical one — see
  // profileWindowEntry.ts's did-attach-webview comment.
  window.pfNav.navigate(tab.webview.getWebContentsId(), url);
}

function navigate(url) {
  const tab = activeTab();
  if (tab) navigateTab(tab, url);
}

newTabBtn.addEventListener('click', () => createTab());
document.getElementById('duplicate').addEventListener('click', () => {
  const tab = activeTab();
  if (tab) createTab({ duplicateFromUrl: tab.url });
});
document.getElementById('go').addEventListener('click', () => navigate(document.getElementById('address').value));
document.getElementById('address').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') navigate(document.getElementById('address').value);
});
document.getElementById('diagnostics').addEventListener('click', () => createTab({ duplicateFromUrl: diagnosticsUrl }));
document.getElementById('test-human-input').addEventListener('click', async () => {
  const btn = document.getElementById('test-human-input');
  const tab = activeTab();
  if (!tab) return;
  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Running…';
  try {
    await window.pfHumanInput.test(tab.webview.getWebContentsId());
    btn.textContent = 'Done — watch the page';
  } catch (err) {
    btn.textContent = 'Failed: ' + (err && err.message ? err.message : String(err));
  } finally {
    btn.disabled = false;
    setTimeout(() => {
      btn.textContent = originalLabel;
    }, 2500);
  }
});
// --- Warm up profile (Cookie-Robot-style) -----------------------------
const warmupToggle = document.getElementById('warmup-toggle');
const warmupPanel = document.getElementById('warmup-panel');
const warmupUrlsEl = document.getElementById('warmup-urls');
const warmupDurationEl = document.getElementById('warmup-duration');
const warmupStartBtn = document.getElementById('warmup-start');
const warmupStatusEl = document.getElementById('warmup-status');

warmupToggle.addEventListener('click', (ev) => {
  ev.stopPropagation();
  warmupPanel.hidden = !warmupPanel.hidden;
});
document.addEventListener('click', (ev) => {
  if (!warmupPanel.hidden && !warmupPanel.contains(ev.target) && ev.target !== warmupToggle) {
    warmupPanel.hidden = true;
  }
});

window.pfWarmup.onProgress((p) => {
  var label = p.status === 'skipped-invalid-url' ? 'Skipped (invalid URL)' : p.status;
  warmupStatusEl.textContent = (p.index + 1) + '/' + p.total + ' — ' + label + ': ' + p.url;
});

warmupStartBtn.addEventListener('click', async () => {
  const urls = warmupUrlsEl.value
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  const minutes = Number(warmupDurationEl.value) || 5;
  const tab = activeTab();
  if (!tab) return;
  if (urls.length === 0) {
    warmupStatusEl.textContent = 'Enter at least one URL first.';
    return;
  }
  warmupStartBtn.disabled = true;
  warmupStatusEl.textContent = 'Starting…';
  try {
    const result = await window.pfWarmup.run(tab.webview.getWebContentsId(), urls, minutes * 60);
    warmupStatusEl.textContent = 'Done — visited ' + result.visited + ' page(s)' + (result.skipped ? ', skipped ' + result.skipped + ' invalid URL(s)' : '') + '.';
  } catch (err) {
    warmupStatusEl.textContent = 'Failed: ' + (err && err.message ? err.message : String(err));
  } finally {
    warmupStartBtn.disabled = false;
  }
});

// --- Scenario Builder (MVP) --------------------------------------------
const scenarioToggle = document.getElementById('scenario-toggle');
const scenarioPanel = document.getElementById('scenario-panel');
const scenarioRecordToggle = document.getElementById('scenario-record-toggle');
const scenarioRecordStatus = document.getElementById('scenario-record-status');
const scenarioSaveRow = document.getElementById('scenario-save-row');
const scenarioNameEl = document.getElementById('scenario-name');
const scenarioSaveBtn = document.getElementById('scenario-save');
const scenarioListEl = document.getElementById('scenario-list');
const scenarioPlayStatusEl = document.getElementById('scenario-play-status');

let scenarioRecording = false;
let scenarioRecordedSteps = null;

scenarioToggle.addEventListener('click', (ev) => {
  ev.stopPropagation();
  scenarioPanel.hidden = !scenarioPanel.hidden;
  if (!scenarioPanel.hidden) void refreshScenarioList();
});
document.addEventListener('click', (ev) => {
  if (!scenarioPanel.hidden && !scenarioPanel.contains(ev.target) && ev.target !== scenarioToggle) {
    scenarioPanel.hidden = true;
  }
});

async function refreshScenarioList() {
  let scenarios;
  try {
    scenarios = await window.pfScenario.list();
  } catch (err) {
    scenarioListEl.textContent = 'Failed to load: ' + (err && err.message ? err.message : String(err));
    return;
  }
  scenarioListEl.innerHTML = '';
  if (scenarios.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = 'No saved scenarios yet.';
    scenarioListEl.appendChild(empty);
    return;
  }
  scenarios.forEach((s) => {
    const item = document.createElement('div');
    item.className = 'scenario-list-item';
    const info = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'scenario-name';
    name.textContent = s.name;
    const count = document.createElement('div');
    count.className = 'scenario-step-count';
    count.textContent = s.steps.length + ' step(s)';
    info.appendChild(name);
    info.appendChild(count);
    const actions = document.createElement('div');
    actions.className = 'scenario-list-actions';
    const playBtn = document.createElement('button');
    playBtn.className = 'btn btn-sm btn-primary';
    playBtn.type = 'button';
    playBtn.textContent = 'Play';
    playBtn.addEventListener('click', () => void playScenarioById(s));
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn btn-sm';
    deleteBtn.type = 'button';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => void deleteScenarioById(s.id));
    actions.appendChild(playBtn);
    actions.appendChild(deleteBtn);
    item.appendChild(info);
    item.appendChild(actions);
    scenarioListEl.appendChild(item);
  });
}

async function playScenarioById(scenario) {
  const tab = activeTab();
  if (!tab) return;
  scenarioPlayStatusEl.textContent = 'Playing "' + scenario.name + '"…';
  try {
    await window.pfScenario.play(tab.webview.getWebContentsId(), scenario.steps);
    scenarioPlayStatusEl.textContent = 'Done playing "' + scenario.name + '".';
  } catch (err) {
    scenarioPlayStatusEl.textContent = 'Failed: ' + (err && err.message ? err.message : String(err));
  }
}

async function deleteScenarioById(id) {
  try {
    await window.pfScenario.delete(id);
    void refreshScenarioList();
  } catch (err) {
    scenarioPlayStatusEl.textContent = 'Failed to delete: ' + (err && err.message ? err.message : String(err));
  }
}

window.pfScenario.onPlayProgress((p) => {
  scenarioPlayStatusEl.textContent = 'Playing step ' + (p.index + 1) + '/' + p.total + ' (' + p.step.type + ')…';
});

scenarioRecordToggle.addEventListener('click', async () => {
  const tab = activeTab();
  if (!tab) return;
  if (!scenarioRecording) {
    scenarioRecordToggle.disabled = true;
    try {
      const result = await window.pfScenario.recordStart(tab.webview.getWebContentsId());
      if (!result.ok) {
        scenarioRecordStatus.textContent = 'Already recording on this tab.';
        return;
      }
      scenarioRecording = true;
      scenarioRecordedSteps = null;
      scenarioSaveRow.hidden = true;
      scenarioRecordToggle.textContent = 'Stop';
      scenarioRecordToggle.classList.add('scenario-record-toggle-active');
      scenarioRecordStatus.textContent = 'Recording — click and type on the page normally.';
    } catch (err) {
      scenarioRecordStatus.textContent = 'Failed to start: ' + (err && err.message ? err.message : String(err));
    } finally {
      scenarioRecordToggle.disabled = false;
    }
  } else {
    scenarioRecordToggle.disabled = true;
    try {
      const steps = await window.pfScenario.recordStop(tab.webview.getWebContentsId());
      scenarioRecording = false;
      scenarioRecordToggle.textContent = 'Record';
      scenarioRecordToggle.classList.remove('scenario-record-toggle-active');
      if (steps.length === 0) {
        scenarioRecordStatus.textContent = 'Nothing recorded — try clicking/typing before stopping.';
        scenarioSaveRow.hidden = true;
      } else {
        scenarioRecordedSteps = steps;
        scenarioRecordStatus.textContent = 'Recorded ' + steps.length + ' step(s).';
        scenarioSaveRow.hidden = false;
      }
    } catch (err) {
      scenarioRecordStatus.textContent = 'Failed to stop: ' + (err && err.message ? err.message : String(err));
    } finally {
      scenarioRecordToggle.disabled = false;
    }
  }
});

scenarioSaveBtn.addEventListener('click', async () => {
  const name = scenarioNameEl.value.trim();
  if (!name) {
    scenarioRecordStatus.textContent = 'Enter a name for this scenario first.';
    return;
  }
  if (!scenarioRecordedSteps || scenarioRecordedSteps.length === 0) return;
  try {
    await window.pfScenario.save({ name, steps: scenarioRecordedSteps });
    scenarioRecordStatus.textContent = 'Saved "' + name + '".';
    scenarioSaveRow.hidden = true;
    scenarioNameEl.value = '';
    scenarioRecordedSteps = null;
    void refreshScenarioList();
  } catch (err) {
    scenarioRecordStatus.textContent = 'Failed to save: ' + (err && err.message ? err.message : String(err));
  }
});

document.getElementById('home').addEventListener('click', () => navigate(startUrl));
document.getElementById('back').addEventListener('click', () => activeTab() && activeTab().webview.goBack());
document.getElementById('fwd').addEventListener('click', () => activeTab() && activeTab().webview.goForward());
document.getElementById('reload').addEventListener('click', () => activeTab() && activeTab().webview.reload());
document.getElementById('devtools').addEventListener('click', () => {
  const tab = activeTab();
  if (!tab) return;
  if (tab.webview.isDevToolsOpened()) tab.webview.closeDevTools();
  else tab.webview.openDevTools();
});

// --- Downloads --------------------------------------------------------
// Each event carries the full current state of one download (main process
// is the source of truth — profileWindowEntry.ts owns the DownloadItem and
// its own profile's session), so the panel just re-renders from the latest
// snapshot per id rather than tracking deltas itself.
const downloadsById = new Map();
// Speed/ETA aren't part of the main process's event payload (it only reports
// a byte-count snapshot per event, not a rate) — tracked client-side instead,
// keyed by download id, from the delta between consecutive 'progressing'
// events. Cleared once a download leaves the active state.
const speedSamples = new Map();
const downloadsToggle = document.getElementById('downloads-toggle');
const downloadsBadge = document.getElementById('downloads-badge');
const downloadsPanel = document.getElementById('downloads-panel');

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function formatBytes(n) {
  if (!n || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatEta(seconds) {
  if (!isFinite(seconds) || seconds < 0) return '';
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}

/** Called once per 'progressing' event, before the map is updated with the
 * new snapshot — needs the *previous* sample to compute a delta. Returns
 * null until a second sample exists (no rate can be known from one point). */
function sampleSpeed(id, receivedBytes, totalBytes) {
  const now = Date.now();
  const prev = speedSamples.get(id);
  speedSamples.set(id, { time: now, bytes: receivedBytes });
  if (!prev) return null;
  const dt = (now - prev.time) / 1000;
  if (dt <= 0) return null;
  const bytesPerSec = (receivedBytes - prev.bytes) / dt;
  if (bytesPerSec <= 0) return { bytesPerSec: 0, eta: null };
  const remaining = totalBytes > 0 ? totalBytes - receivedBytes : 0;
  return { bytesPerSec, eta: totalBytes > 0 ? remaining / bytesPerSec : null };
}

function renderDownloads() {
  const entries = Array.from(downloadsById.values()).reverse();
  const activeCount = entries.filter((d) => d.state === 'started' || d.state === 'progressing').length;
  downloadsBadge.hidden = activeCount === 0;
  downloadsBadge.textContent = String(activeCount);

  if (entries.length === 0) {
    downloadsPanel.innerHTML = '<div class="downloads-empty">No downloads yet</div>';
    return;
  }

  downloadsPanel.innerHTML = '';
  for (const d of entries) {
    const pct = d.totalBytes > 0 ? Math.min(100, Math.round((d.receivedBytes / d.totalBytes) * 100)) : 0;
    const item = document.createElement('div');
    item.className = 'download-item';
    const active = d.state === 'started' || d.state === 'progressing';
    if (!active) speedSamples.delete(d.id);
    const speed = active ? sampleSpeed(d.id, d.receivedBytes, d.totalBytes) : null;
    const safeName = escapeHtml(d.filename);
    const sizeText = active && d.totalBytes > 0 ? `${formatBytes(d.receivedBytes)}/${formatBytes(d.totalBytes)}` : '';
    const speedText = speed ? ` · ${formatBytes(speed.bytesPerSec)}/s` : '';
    const etaText = speed && speed.eta !== null ? ` · ETA ${formatEta(speed.eta)}` : '';
    item.innerHTML = `
      <div class="download-name" title="${safeName}">${safeName}</div>
      ${active ? `<div class="download-progress"><div class="download-progress-fill" style="width:${pct}%"></div></div>` : ''}
      <div class="download-row">
        <span class="download-status">${d.state}${active ? ` — ${pct}%${sizeText ? ' · ' + sizeText : ''}${speedText}${etaText}` : ''}</span>
        <span class="download-actions"></span>
      </div>
    `;
    const actions = item.querySelector('.download-actions');
    if (active) {
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'btn btn-sm';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', () => window.pfDownloads.cancel(d.id));
      actions.appendChild(cancelBtn);
    } else if (d.state === 'completed') {
      const openBtn = document.createElement('button');
      openBtn.className = 'btn btn-sm';
      openBtn.textContent = 'Open';
      openBtn.addEventListener('click', () => window.pfDownloads.open(d.id));
      const showBtn = document.createElement('button');
      showBtn.className = 'btn btn-sm';
      showBtn.textContent = 'Show in folder';
      showBtn.addEventListener('click', () => window.pfDownloads.showInFolder(d.id));
      actions.appendChild(openBtn);
      actions.appendChild(showBtn);
    }
    downloadsPanel.appendChild(item);
  }
}

window.pfDownloads.onEvent((event) => {
  downloadsById.set(event.id, event);
  renderDownloads();
});

downloadsToggle.addEventListener('click', (ev) => {
  ev.stopPropagation();
  downloadsPanel.hidden = !downloadsPanel.hidden;
});
document.addEventListener('click', (ev) => {
  if (!downloadsPanel.hidden && !downloadsPanel.contains(ev.target) && ev.target !== downloadsToggle) {
    downloadsPanel.hidden = true;
  }
});
renderDownloads();

// First tab: left at about:blank (see attribute above) — the main
// process applies CDP Emulation overrides (platform, languages, hardware
// concurrency, screen) on 'did-attach-webview' and only then navigates to
// startUrl, so the very first real page load already reflects the full
// fingerprint instead of racing it with a visible reload. See
// profileWindowEntry.ts.
createTab();
