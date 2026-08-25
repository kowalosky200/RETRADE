(() => {
  const STORAGE_KEY = 'retrade.monitor.configs.v1';
  const DEALS_KEY = 'retrade.monitor.demoDeals.v1';

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

  let monitors = readJson(STORAGE_KEY, defaultMonitors);
  let deals = readJson(DEALS_KEY, []);

  function readJson(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : structuredClone(fallback);
    } catch {
      return structuredClone(fallback);
    }
  }

  function saveMonitors() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(monitors));
  }

  function saveDeals() {
    localStorage.setItem(DEALS_KEY, JSON.stringify(deals));
  }

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

  function dealCard(deal) {
    const label = scoreLabel(deal.score);
    return `<article class="deal-card">
      <div class="monitor-top">
        <span class="deal-score ${deal.score >= 90 ? 'snipe' : ''}">${deal.score}</span>
        <span class="category-pill">${label}</span>
      </div>
      <div class="deal-title">${escapeHtml(deal.title)}</div>
      <div class="deal-meta"><span>${escapeHtml(deal.platform)}</span><span>${escapeHtml(deal.category)}</span><span>${escapeHtml(deal.age)}</span></div>
      <div class="deal-profit">${money(deal.price)} buy · ${money(deal.profit)} est. profit</div>
      <div class="deal-meta" style="margin-top:8px"><span>Resale ${money(deal.resale)}</span><span>Risk ${escapeHtml(deal.risk)}</span></div>
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

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
  }

  function openModal() {
    document.getElementById('monitorModal').classList.remove('hidden');
  }

  function closeModal() {
    document.getElementById('monitorModal').classList.add('hidden');
    document.getElementById('monitorForm').reset();
  }

  document.querySelectorAll('.nav-item[data-tab]').forEach(btn => btn.addEventListener('click', () => activeTab(btn.dataset.tab)));
  document.querySelectorAll('[data-jump]').forEach(btn => btn.addEventListener('click', () => activeTab(btn.dataset.jump)));

  ['newMonitorBtn', 'newMonitorBtnSecondary'].forEach(id => document.getElementById(id).addEventListener('click', openModal));
  ['closeMonitorModal', 'cancelMonitorModal'].forEach(id => document.getElementById(id).addEventListener('click', closeModal));
  document.getElementById('monitorModal').addEventListener('click', e => { if (e.target.id === 'monitorModal') closeModal(); });

  document.getElementById('monitorForm').addEventListener('submit', event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    monitors.unshift({
      id: crypto.randomUUID(),
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
    saveMonitors();
    renderMonitors();
    closeModal();
    activeTab('monitors');
  });

  document.getElementById('monitorGrid').addEventListener('click', event => {
    const button = event.target.closest('[data-action]');
    const card = event.target.closest('[data-id]');
    if (!button || !card) return;
    const index = monitors.findIndex(m => m.id === card.dataset.id);
    if (index < 0) return;
    if (button.dataset.action === 'toggle') monitors[index].enabled = !monitors[index].enabled;
    if (button.dataset.action === 'duplicate') monitors.splice(index + 1, 0, { ...monitors[index], id: crypto.randomUUID(), name: `${monitors[index].name} copy`, enabled: false });
    if (button.dataset.action === 'delete') monitors.splice(index, 1);
    saveMonitors();
    renderMonitors();
  });

  document.getElementById('dealFilter').addEventListener('change', renderDeals);
  document.getElementById('seedDemoBtn').addEventListener('click', () => {
    deals = structuredClone(demoDeals);
    saveDeals();
    renderDeals();
    activeTab('live');
  });

  renderMonitors();
  renderDeals();
})();
