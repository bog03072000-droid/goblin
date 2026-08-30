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
  tabEl.innerHTML = '<span class="tab-title">New Tab</span><span class="tab-close">&times;</span>';
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
  let target = url.trim();
  if (!/^[a-zA-Z]+:\/\//.test(target)) target = 'https://' + target;
  tab.webview.setAttribute('src', target);
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

// First tab: left at about:blank (see attribute above) — the main
// process applies CDP Emulation overrides (platform, languages, hardware
// concurrency, screen) on 'did-attach-webview' and only then navigates to
// startUrl, so the very first real page load already reflects the full
// fingerprint instead of racing it with a visible reload. See
// profileWindowEntry.ts.
createTab();
