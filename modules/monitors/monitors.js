(async () => {
  const store = window.RETRADE_MONITOR_STORE;
  if (!store) throw new Error('RETRADE monitor data store failed to load');

  const defaultMonitors = [
    { id: crypto.randomUUID(), name: 'Canon DSLR £0–100', category: 'Canon DSLR', search: 'Canon EOS DSLR', maxPrice: 100, minProfit: 40, minRoi: 25, reject: 'spares, broken, water damage', discord: true, enabled: true },
    { id: crypto.randomUUID(), name: 'Canon DSLR £101–200', category: 'Canon DSLR', search: 'Canon EOS DSLR', maxPrice: 200, minProfit: 50, minRoi: 25, reject: 'spares, broken, water damage', discord: true, enabled: true },
    { id: crypto.randomUUID(), name: 'MacBook £201–300', category: 'MacBook', search: 'MacBook Air M1, MacBook Pro M1', maxPrice: 300, minProfit: 50, minRoi: 20, reject: 'activation lock, MDM, liquid damage, no power', discord: true, enabled: true }
  ];

  const demoDeals = [
    { id: 'demo-1', title: 'Canon EOS 700D + 18-55mm STM', platform: 'Vinted', price: 68, landed: 75, resale: 169, profit: 61, score: 94, category: 'Canon DSLR', age: '18 sec', risk: 'Low' },
    { id: 'demo-2', title: 'MacBook Air M1 8GB 256GB', platform: 'Vinted', price: 245, landed: 258, resale: 379, profit: 76, score: 91, category: 'MacBook', age: '42 sec', risk: 'Low' },
    { id: 'demo-3', title: 'Canon EOS 600D Body + Charger', platform: 'Vinted', price: 42, landed: 49, resale: 99, profit: 31, score: 76, category: 'Canon DSLR', age: '3 min', risk: 'Medium' },
    { id: 'demo-4', title: 'Canon EOS 1300D + 18-55mm Kit', platform: 'Vinted', price: 82, landed: 90, resale: 149, profit: 38, score: 83, category: 'Canon DSLR', age: '7 min', risk: 'Low' },
    { id: 'demo-5', title: 'MacBook Air M1 16GB 256GB', platform: 'Vinted', price: 275, landed: 289, resale: 449, profit: 110, score: 97, category: 'MacBook', age: '11 min', risk: 'Low' }
  ];

  let monitors = [];
  let deals = [];
  let persistence = { mode: 'local', reason: 'Starting…' };

  function money(value) {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(Number(value) || 0);
  }

  function activeTab(name) {
    document.querySelectorAll('.nav-item[data-tab]').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === name));
    document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.toggle('active', panel.id === `tab-${name}`));
  }

  function scoreLabel(score) {
    if (score >= 90) return 'SNIPE';
    if (score >= 80) return 'BUY';
    return 'CHECK';
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
  }

  function showNotice(message, type = 'info') {
    const notice = document.getElementById('appNotice');
    notice.textContent = message;
    notice.className = `notice ${type}`;
    window.clearTimeout(showNotice.timer);
    showNotice.timer = window.setTimeout(() => notice.classList.add('hidden'), 4500);
  }

  function renderPersistenceStatus() {
    const cloud = persistence.mode === 'supabase';
    const mode = document.getElementById('storageMode');
    const detail = document.getElementById('storageDetail');
    const storage = document.getElementById('healthStorage');
    const supabase = document.getElementById('healthSupabase');
    const dot = document.getElementById('storageDot');

    mode.textContent = cloud ? 'Supabase persistence' : 'Local development storage';
    detail.textContent = cloud ? 'Authenticated cloud sync active' : persistence.reason;
    storage.textContent = cloud ? 'Cloud' : 'Local fallback';
    storage.className = cloud ? 'ok' : 'pending';
    supabase.textContent = cloud ? 'Connected' : 'Awaiting app client';
    supabase.className = cloud ? 'ok' : 'pending';
    dot.classList.toggle('connected', cloud);
  }

  function dealCard(deal) {
    const label = scoreLabel(deal.score);
    const listingAction = deal.url
      ? `<a class="mini-button link-button" href="${escapeHtml(deal.url)}" target="_blank" rel="noopener noreferrer">Open listing</a>`
      : '';
    return `<article class="deal-card">
      <div class="monitor-top">
        <span class="deal-score ${deal.score >= 90 ? 'snipe' : ''}">${deal.score}</span>
        <span class="category-pill">${label}</span>
      </div>
      <div class="deal-title">${escapeHtml(deal.title)}</div>
      <div class="deal-meta"><span>${escapeHtml(deal.platform)}</span><span>${escapeHtml(deal.category)}</span><span>${escapeHtml(deal.age)}</span></div>
      <div class="deal-profit">${money(deal.price)} buy · ${money(deal.profit)} est. profit</div>
      <div class="deal-meta" style="margin-top:8px"><span>Resale ${money(deal.resale)}</span><span>Risk ${escapeHtml(deal.risk)}</span></div>
      ${listingAction ? `<div class="monitor-actions">${listingAction}</div>` : ''}
    </article>`;
  }

  function renderDeals() {
    const filter = document.getElementById('dealFilter').value;
    const filtered = deals.filter(d => {
      if (filter === 'snipe') return d.score >= 90;
      if (filter === 'buy') return d.score >= 80;
      if (filter === 'check') return d.score < 80;
      return true;
    }).sort((a, b) => b.score - a.score);

    const live = document.getElementById('liveDeals');
    live.classList.toggle('empty-state', filtered.length === 0);
    live.innerHTML = filtered.length ? filtered.map(dealCard).join('') : 'No listings match this filter.';

    const recent = [...deals].sort((a, b) => b.score - a.score).slice(0, 4);
    const overview = document.getElementById('overviewDeals');
    overview.classList.toggle('empty-state', recent.length === 0);
    overview.innerHTML = recent.length ? recent.map(dealCard).join('') : 'No deal data yet. Load demo deals to preview the scoring experience.';

    document.getElementById('statDeals').textContent = deals.length;
    document.getElementById('statStrong').textContent = deals.filter(d => d.score >= 85).length;
    document.getElementById('statProfit').textContent = money(deals.reduce((sum, d) => sum + Math.max(0, Number(d.profit) || 0), 0));
  }

  function renderMonitors() {
    const grid = document.getElementById('monitorGrid');
    document.getElementById('statActive').textContent = monitors.filter(m => m.enabled).length;
    grid.innerHTML = monitors.length ? monitors.map(m => `<article class="monitor-card" data-id="${m.id}">
      <div class="monitor-top">
        <div><h3>${escapeHtml(m.name)}</h3><div class="monitor-meta"><span>${escapeHtml(m.category)}</span><span>Max ${money(m.maxPrice)}</span></div></div>
        <span class="badge ${m.enabled ? 'on' : 'off'}">${m.enabled ? 'LIVE' : 'PAUSED'}</span>
      </div>
      <p>${escapeHtml(m.search || 'No search terms set')}</p>
      <div class="monitor-meta"><span>Min profit ${money(m.minProfit)}</span><span>ROI ${Number(m.minRoi) || 0}%+</span><span>${m.discord ? 'Discord on' : 'Discord off'}</span></div>
      <div class="monitor-actions">
        <button class="mini-button" data-action="toggle">${m.enabled ? 'Pause' : 'Start'}</button>
        <button class="mini-button" data-action="duplicate">Duplicate</button>
        <button class="mini-button" data-action="delete">Delete</button>
      </div>
    </article>`).join('') : '<div class="panel empty-state">No monitors yet. Create your first monitor.</div>';
  }

  function openModal() {
    document.getElementById('monitorModal').classList.remove('hidden');
  }

  function closeModal() {
    document.getElementById('monitorModal').classList.add('hidden');
    document.getElementById('monitorForm').reset();
  }

  async function refreshMonitors() {
    monitors = await store.listMonitors();
    renderMonitors();
  }

  async function refreshDeals() {
    deals = await store.listDeals();
    renderDeals();
  }

  async function initialise() {
    persistence = await store.init();
    renderPersistenceStatus();

    monitors = await store.listMonitors();
    if (persistence.mode === 'local' && monitors.length === 0) {
      await store.replaceLocalMonitors(defaultMonitors);
      monitors = await store.listMonitors();
    }

    deals = await store.listDeals();
    renderMonitors();
    renderDeals();
  }

  document.querySelectorAll('.nav-item[data-tab]').forEach(btn => btn.addEventListener('click', () => activeTab(btn.dataset.tab)));
  document.querySelectorAll('[data-jump]').forEach(btn => btn.addEventListener('click', () => activeTab(btn.dataset.jump)));

  ['newMonitorBtn', 'newMonitorBtnSecondary'].forEach(id => document.getElementById(id).addEventListener('click', openModal));
  ['closeMonitorModal', 'cancelMonitorModal'].forEach(id => document.getElementById(id).addEventListener('click', closeModal));
  document.getElementById('monitorModal').addEventListener('click', event => { if (event.target.id === 'monitorModal') closeModal(); });

  document.getElementById('monitorForm').addEventListener('submit', async event => {
    event.preventDefault();
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      const form = new FormData(event.currentTarget);
      await store.createMonitor({
        name: form.get('name'),
        category: form.get('category'),
        search: form.get('search'),
        maxPrice: Number(form.get('maxPrice')),
        minProfit: Number(form.get('minProfit')),
        minRoi: Number(form.get('minRoi')),
        reject: form.get('reject'),
        discord: form.get('discord') === 'on',
        enabled: form.get('enabled') === 'on'
      });
      await refreshMonitors();
      closeModal();
      activeTab('monitors');
      showNotice('Monitor saved.', 'success');
    } catch (error) {
      console.error(error);
      showNotice(`Could not save monitor: ${error.message || 'Unknown error'}`, 'error');
    } finally {
      submit.disabled = false;
    }
  });

  document.getElementById('monitorGrid').addEventListener('click', async event => {
    const button = event.target.closest('[data-action]');
    const card = event.target.closest('[data-id]');
    if (!button || !card) return;
    const monitor = monitors.find(item => item.id === card.dataset.id);
    if (!monitor) return;

    button.disabled = true;
    try {
      if (button.dataset.action === 'toggle') {
        await store.updateMonitor(monitor.id, { enabled: !monitor.enabled });
      }
      if (button.dataset.action === 'duplicate') {
        await store.createMonitor({ ...monitor, id: undefined, name: `${monitor.name} copy`, enabled: false });
      }
      if (button.dataset.action === 'delete') {
        await store.deleteMonitor(monitor.id);
      }
      await refreshMonitors();
    } catch (error) {
      console.error(error);
      showNotice(`Monitor action failed: ${error.message || 'Unknown error'}`, 'error');
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById('dealFilter').addEventListener('change', renderDeals);
  document.getElementById('seedDemoBtn').addEventListener('click', async () => {
    try {
      await store.setDemoDeals(demoDeals);
      deals = [...demoDeals];
      renderDeals();
      activeTab('live');
      showNotice('Demo deals loaded locally for preview. They are never written to Supabase.', 'info');
    } catch (error) {
      console.error(error);
      showNotice('Could not load demo deals.', 'error');
    }
  });

  try {
    await initialise();
  } catch (error) {
    console.error('[RETRADE Monitors] Initialisation failed:', error);
    showNotice(`Monitors could not initialise: ${error.message || 'Unknown error'}`, 'error');
    renderPersistenceStatus();
    renderMonitors();
    renderDeals();
  }
})();
