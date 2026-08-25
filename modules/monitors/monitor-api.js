(() => {
  const MONITOR_KEY = 'retrade.monitor.configs.v1';
  const DEALS_KEY = 'retrade.monitor.demoDeals.v1';

  let mode = 'local';
  let reason = 'No shared Supabase client detected';
  let client = null;
  let user = null;

  function clone(value) {
    return typeof structuredClone === 'function'
      ? structuredClone(value)
      : JSON.parse(JSON.stringify(value));
  }

  function readJson(key, fallback = []) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : clone(fallback);
    } catch {
      return clone(fallback);
    }
  }

  function writeJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function getCandidateClient() {
    const configured = window.RETRADE_MONITOR_CONFIG?.supabaseClient;
    const candidates = [configured, window.RETRADE_SUPABASE, window.supabaseClient];
    return candidates.find(candidate => candidate && typeof candidate.from === 'function' && candidate.auth) || null;
  }

  function normaliseTerms(value) {
    if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean);
    return String(value || '')
      .split(/[\n,]+/)
      .map(v => v.trim())
      .filter(Boolean);
  }

  function normaliseReject(value) {
    return normaliseTerms(value);
  }

  function fromDb(row) {
    const terms = Array.isArray(row.search_terms) ? row.search_terms : [];
    const reject = row.filters?.reject_keywords;
    return {
      id: row.id,
      name: row.name,
      category: row.category_key || 'Custom',
      search: terms.join(', '),
      maxPrice: Number(row.price_max ?? 0),
      minProfit: Number(row.min_profit ?? 0),
      minRoi: Number(row.min_roi ?? 0),
      reject: Array.isArray(reject) ? reject.join(', ') : String(reject || ''),
      discord: Boolean(row.discord_enabled),
      enabled: Boolean(row.enabled),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  function toDb(input) {
    return {
      name: String(input.name || '').trim(),
      platform: 'vinted',
      category_key: String(input.category || 'Custom').trim(),
      enabled: Boolean(input.enabled),
      search_terms: normaliseTerms(input.search),
      filters: { reject_keywords: normaliseReject(input.reject) },
      price_min: 0,
      price_max: Number(input.maxPrice || 0),
      min_profit: Number(input.minProfit || 0),
      min_roi: Number(input.minRoi || 0),
      discord_enabled: Boolean(input.discord),
      retrade_alerts_enabled: true
    };
  }

  async function init() {
    client = getCandidateClient();
    if (!client) return status();

    try {
      const { data, error } = await client.auth.getUser();
      if (error) throw error;
      user = data?.user || null;
      if (!user) {
        reason = 'Supabase client found, but no authenticated user is available';
        return status();
      }

      const { error: probeError } = await client.from('monitors').select('id').limit(1);
      if (probeError) throw probeError;

      mode = 'supabase';
      reason = 'Connected';
      return status();
    } catch (error) {
      mode = 'local';
      reason = error?.message || 'Supabase connection unavailable';
      console.warn('[RETRADE Monitors] Falling back to local storage:', reason);
      return status();
    }
  }

  function status() {
    return { mode, reason, userId: user?.id || null };
  }

  async function listMonitors() {
    if (mode !== 'supabase') return readJson(MONITOR_KEY, []);
    const { data, error } = await client
      .from('monitors')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(fromDb);
  }

  async function replaceLocalMonitors(monitors) {
    writeJson(MONITOR_KEY, monitors);
    return clone(monitors);
  }

  async function createMonitor(input) {
    if (mode !== 'supabase') {
      const monitors = readJson(MONITOR_KEY, []);
      const monitor = { ...clone(input), id: input.id || crypto.randomUUID() };
      monitors.unshift(monitor);
      writeJson(MONITOR_KEY, monitors);
      return monitor;
    }

    const payload = { ...toDb(input), user_id: user.id };
    const { data, error } = await client.from('monitors').insert(payload).select('*').single();
    if (error) throw error;
    return fromDb(data);
  }

  async function updateMonitor(id, patch) {
    if (mode !== 'supabase') {
      const monitors = readJson(MONITOR_KEY, []);
      const index = monitors.findIndex(item => item.id === id);
      if (index < 0) throw new Error('Monitor not found');
      monitors[index] = { ...monitors[index], ...clone(patch) };
      writeJson(MONITOR_KEY, monitors);
      return clone(monitors[index]);
    }

    const current = (await listMonitors()).find(item => item.id === id);
    if (!current) throw new Error('Monitor not found');
    const payload = toDb({ ...current, ...patch });
    const { data, error } = await client
      .from('monitors')
      .update(payload)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    return fromDb(data);
  }

  async function deleteMonitor(id) {
    if (mode !== 'supabase') {
      const monitors = readJson(MONITOR_KEY, []).filter(item => item.id !== id);
      writeJson(MONITOR_KEY, monitors);
      return;
    }
    const { error } = await client.from('monitors').delete().eq('id', id);
    if (error) throw error;
  }

  async function listDeals() {
    if (mode !== 'supabase') return readJson(DEALS_KEY, []);

    const { data: matches, error: matchError } = await client
      .from('monitor_matches')
      .select('id,listing_id,monitor_id,score,decision,landed_cost,expected_resale_low,expected_resale_high,projected_profit_low,projected_profit_high,roi,risk_level,status,detected_at')
      .order('detected_at', { ascending: false })
      .limit(100);
    if (matchError) throw matchError;
    if (!matches?.length) return [];

    const listingIds = [...new Set(matches.map(row => row.listing_id).filter(Boolean))];
    const monitorIds = [...new Set(matches.map(row => row.monitor_id).filter(Boolean))];

    const [{ data: listings, error: listingError }, { data: monitors, error: monitorError }] = await Promise.all([
      client.from('monitor_listings').select('id,platform,title,item_price,delivered_price,url,first_seen_at').in('id', listingIds),
      client.from('monitors').select('id,name,category_key').in('id', monitorIds)
    ]);
    if (listingError) throw listingError;
    if (monitorError) throw monitorError;

    const listingMap = new Map((listings || []).map(row => [row.id, row]));
    const monitorMap = new Map((monitors || []).map(row => [row.id, row]));

    return matches.map(match => {
      const listing = listingMap.get(match.listing_id) || {};
      const monitor = monitorMap.get(match.monitor_id) || {};
      const resale = Number(match.expected_resale_high ?? match.expected_resale_low ?? 0);
      const profit = Number(match.projected_profit_high ?? match.projected_profit_low ?? 0);
      const detected = match.detected_at ? new Date(match.detected_at) : null;
      return {
        id: match.id,
        title: listing.title || 'Untitled listing',
        platform: listing.platform || 'Vinted',
        price: Number(listing.item_price ?? 0),
        landed: Number(match.landed_cost ?? listing.delivered_price ?? listing.item_price ?? 0),
        resale,
        profit,
        score: Number(match.score ?? 0),
        category: monitor.category_key || monitor.name || 'Monitor',
        age: detected ? relativeAge(detected) : '',
        risk: match.risk_level || 'Unknown',
        url: listing.url || null,
        status: match.status || 'new'
      };
    });
  }

  function relativeAge(date) {
    const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
    if (seconds < 60) return `${seconds} sec`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr`;
    return `${Math.floor(seconds / 86400)} day`;
  }

  async function setDemoDeals(deals) {
    writeJson(DEALS_KEY, deals);
    return clone(deals);
  }

  window.RETRADE_MONITOR_STORE = {
    init,
    status,
    listMonitors,
    replaceLocalMonitors,
    createMonitor,
    updateMonitor,
    deleteMonitor,
    listDeals,
    setDemoDeals
  };
})();
