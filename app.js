// ── HIERARCHY: Business → Function → Plan Type → Queues ─────────
const HIERARCHY = {
  'USPB': {
    'Recovery':    { 'Inbound': 5, 'Outbound': 3, 'CoreOps': 10, driver: { name: 'Write-Off Accounts', rate: 0.035 } },
    'Collections': { 'Inbound': 7, 'Outbound': 6, 'CoreOps': 4, driver: { name: 'Delinquent Accounts', rate: 0.028 } },
    'Fraud':       { 'Inbound': 8, 'Outbound': 2, 'CoreOps': 5, driver: { name: 'Flagged Transactions', rate: 0.012 } },
  },
  'Wealth': {
    'Customer Service': { 'Inbound': 10, 'Outbound': 3, 'CoreOps': 6, driver: { name: 'Active Accounts', rate: 0.020 } },
    'Chat':             { 'Inbound': 4,  'Outbound': 2, 'CoreOps': 3, driver: { name: 'Digital Active Users', rate: 0.015 } },
    'Mortgages':        { 'Inbound': 6,  'Outbound': 5, 'CoreOps': 8, driver: { name: 'Active Mortgage Loans', rate: 0.025 } },
  },
  'ICRM': {
    'Call':       { 'Inbound': 9,  'Outbound': 4, 'CoreOps': 7, driver: { name: 'Institutional Client Accounts', rate: 0.040 } },
    'Function 1': { 'Inbound': 3,  'Outbound': 7, 'CoreOps': 5, driver: { name: 'Active Portfolios', rate: 0.018 } },
    'Function 2': { 'Inbound': 6,  'Outbound': 3, 'CoreOps': 9, driver: { name: 'Trade Accounts', rate: 0.022 } },
    'Function 3': { 'Inbound': 5,  'Outbound': 8, 'CoreOps': 4, driver: { name: 'Custody Accounts', rate: 0.030 } },
  },
};

// Current selection state
let hierState = {
  business: 'USPB',
  func: 'Recovery',
  qtype: 'Inbound',
};

// The active queue list derived from hierarchy selection
let ACTIVE_QIDS = [];
let ACTIVE_QUEUE_META = {}; // qid -> {name, color, ...}

const Q_COLORS = [
  '#003B70','#D9261C','#1A5EA8','#0A7C4E','#B45309',
  '#6D28D9','#0E7490','#92400E','#BE123C','#1E3A5F'
];

function getQueueCount() {
  return HIERARCHY[hierState.business]?.[hierState.func]?.[hierState.qtype] || 0;
}

function buildActiveQueues() {
  const count = getQueueCount();
  ACTIVE_QIDS = [];
  ACTIVE_QUEUE_META = {};
  for (let i = 0; i < count; i++) {
    const qid = `q_${hierState.business.toLowerCase()}_${hierState.func.toLowerCase().replace(/\s+/g,'')}_${hierState.qtype.toLowerCase()}_${i+1}`;
    const name = `Plan ${i+1}`;
    const color = Q_COLORS[i % Q_COLORS.length];
    ACTIVE_QIDS.push(qid);
    ACTIVE_QUEUE_META[qid] = { name, color, idx: i };
  }
}

// Driver helpers
function getCurrentDriver() {
  const funcData = HIERARCHY[hierState.business]?.[hierState.func];
  return funcData?.driver || { name: 'Active Accounts', rate: 0.02 };
}

function getDriverCount(volume) {
  // Back-calculate driver count from volume using the contact rate
  const driver = getCurrentDriver();
  return Math.round(volume / driver.rate);
}

function getDriverCountForQueue(q) {
  return getDriverCount(q.vol);
}

// ── SYNTHETIC DATA LOOKUP ─────────────────────────────────────
// Get queue data from synthetic store for current hierarchy selection
function getSynthQueueData(queueIdx, year, month) {
  const key = `${hierState.business}|${hierState.func}|${queueIdx}`;
  const records = SYNTH_QUEUES[key];
  if (!records) return null;
  return records.find(r => r.yr === year && r.mo === month) || null;
}

function getSynthQueuesForMonth(year, month) {
  const count = getQueueCount();
  const results = [];
  for (let i = 1; i <= count; i++) {
    const key = `${hierState.business}|${hierState.func}|${i}`;
    const records = SYNTH_QUEUES[key];
    if (!records) continue;
    const rec = records.find(r => r.yr === year && r.mo === month);
    if (rec) {
      results.push({
        ...rec,
        qid: ACTIVE_QIDS[i-1] || `q_${i}`,
        qn: `Plan ${i}`,
        qIdx: i,
      });
    }
  }
  return results;
}

// Filtered version — only returns queues that are in ltSelectedQueues
function getFilteredSynthQueuesForMonth(year, month) {
  const all = getSynthQueuesForMonth(year, month);
  const selected = getSelectedQueueIds();
  return all.filter(q => selected.includes(q.qid));
}

function getSynthMonthlyAgg(year, month) {
  const qs = getSynthQueuesForMonth(year, month);
  return aggSynthQueues(qs, year, month);
}

function getFilteredSynthMonthlyAgg(year, month) {
  const qs = getFilteredSynthQueuesForMonth(year, month);
  return aggSynthQueues(qs, year, month);
}

function aggSynthQueues(qs, year, month) {
  if (qs.length === 0) return null;
  const totalVol = qs.reduce((s,q) => s + q.vol, 0);
  const avgAht = Math.round(qs.reduce((s,q) => s + q.aht * q.vol, 0) / (totalVol || 1));
  const avgShr = +(qs.reduce((s,q) => s + q.shr, 0) / qs.length).toFixed(2);
  const avgOcc = +(qs.reduce((s,q) => s + q.occ, 0) / qs.length).toFixed(2);
  const avgAvail = +(qs.reduce((s,q) => s + q.avail, 0) / qs.length).toFixed(2);
  const totalFte = qs.reduce((s,q) => s + q.erlang_fte, 0);
  const wd = qs[0]?.working_days || 22;
  return {
    vol: totalVol, aht: avgAht, shrinkage_pct: avgShr,
    occupancy_pct: avgOcc, availability_pct: avgAvail,
    erlang_fte: totalFte, working_days: wd, is_forecast: qs[0]?.fc || false,
    month_label: qs[0]?.ml || '',
  };
}

// Check for anomalies in the current selection for the actuals month
function getAnomaliesForCurrentSelection() {
  const results = [];
  SYNTH_ANOMALIES.forEach(a => {
    if (a.biz === hierState.business && a.func === hierState.func) {
      results.push(a);
    }
  });
  return results;
}

function getStatusForCurrentSelection() {
  const anomalies = getAnomaliesForCurrentSelection();
  if (anomalies.length === 0) {
    return {
      status: 'green',
      label: 'Complete',
      message: 'All actuals loaded. Data quality checks passed. No errors detected.',
    };
  }
  const queueWarnings = anomalies.map(a => `Plan ${a.qi}: ${a.desc}`);
  return {
    status: 'amber',
    label: 'Needs review',
    message: `Actuals loaded but ${anomalies.length} data quality issue${anomalies.length > 1 ? 's' : ''} detected:\n` + queueWarnings.join('\n'),
    anomalies,
  };
}

function initHierarchy() {
  const bSel = document.getElementById('hier-business');
  bSel.innerHTML = '';
  Object.keys(HIERARCHY).forEach(b => {
    const opt = document.createElement('option');
    opt.value = b; opt.textContent = b;
    if (b === hierState.business) opt.selected = true;
    bSel.appendChild(opt);
  });
  populateFunctions();
}

function populateFunctions() {
  const fSel = document.getElementById('hier-function');
  fSel.innerHTML = '';
  const funcs = Object.keys(HIERARCHY[hierState.business] || {});
  funcs.forEach(f => {
    const opt = document.createElement('option');
    opt.value = f; opt.textContent = f;
    if (f === hierState.func) opt.selected = true;
    fSel.appendChild(opt);
  });
  // If current func not in new business, select first
  if (!funcs.includes(hierState.func)) {
    hierState.func = funcs[0] || '';
    fSel.value = hierState.func;
  }
  populateQueueTypes();
}

function populateQueueTypes() {
  const qtSel = document.getElementById('hier-qtype');
  qtSel.innerHTML = '';
  const types = Object.keys(HIERARCHY[hierState.business]?.[hierState.func] || {}).filter(k => k !== 'driver');
  types.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t; opt.textContent = t;
    if (t === hierState.qtype) opt.selected = true;
    qtSel.appendChild(opt);
  });
  if (!types.includes(hierState.qtype)) {
    hierState.qtype = types[0] || '';
    qtSel.value = hierState.qtype;
  }
  updateHierContext();
  buildActiveQueues();
}

function onHierChange(level) {
  if (level === 'business') {
    hierState.business = document.getElementById('hier-business').value;
    hierState.func = Object.keys(HIERARCHY[hierState.business])[0] || '';
    hierState.qtype = 'Inbound';
    populateFunctions();
  } else if (level === 'function') {
    hierState.func = document.getElementById('hier-function').value;
    hierState.qtype = 'Inbound';
    populateQueueTypes();
  } else if (level === 'qtype') {
    hierState.qtype = document.getElementById('hier-qtype').value;
    updateHierContext();
    buildActiveQueues();
  }

  // Reset queue filter and approval state
  ltSelectedQueues = new Set(ACTIVE_QIDS);
  Object.keys(p1ApprovalState).forEach(k => delete p1ApprovalState[k]);
  buildLTQFList();

  // Update contextual labels across the app
  updateHierLabels();

  // Re-render the current active panel
  fcBuilt = false; // Reset so forecast table rebuilds
  const activeStep = [1,2,3,4].find(n => document.getElementById('nav-'+n)?.classList.contains('active')) || 3;
  ltStep(activeStep);
}

function updateHierContext() {
  const count = getQueueCount();
  const ctx = document.getElementById('hier-context');
  if (ctx) ctx.textContent = `${count} plan${count !== 1 ? 's' : ''} · FY2026`;
}

function updateHierLabels() {
  const b = hierState.business;
  const f = hierState.func;
  const qt = hierState.qtype;

  // Header bar
  const hRight = document.getElementById('h-right-ctx');
  if (hRight) hRight.textContent = `${b} · ${f.toUpperCase()} · ${qt.toUpperCase()} · SYNTHETIC DATA`;

  // Panel 1 subtitle
  const p1sub = document.getElementById('p1-context-sub');
  if (p1sub) p1sub.textContent = `${b} · ${f} · ${qt}`;

  // FD overlay subtitle
  const fdCtx = document.getElementById('fd-bar-ctx');
  if (fdCtx) fdCtx.textContent = `${b} · ${f.toUpperCase()} · ${qt.toUpperCase()} · LT FORECAST`;
}

// ── LT WORKSPACE QUEUE FILTER (shared across all panels) ─────────
let ltSelectedQueues = new Set();

function buildLTQFList() {
  const list = document.getElementById('ltqf-list');
  if (!list) return;
  list.innerHTML = '';
  ACTIVE_QIDS.forEach(qid => {
    const meta = ACTIVE_QUEUE_META[qid];
    const checked = ltSelectedQueues.has(qid);
    const div = document.createElement('div');
    div.className = 'qf-item' + (checked ? ' checked' : '');
    div.dataset.qid = qid;
    div.onclick = () => toggleLTQFItem(qid);
    div.innerHTML = `
      <div class="qf-check"></div>
      <div class="qf-dot" style="background:${meta?.color || '#003B70'};"></div>
      <span class="qf-name">${meta?.name || qid}</span>`;
    list.appendChild(div);
  });
  updateLTQFLabel();
}

function toggleLTQF() {
  const dd = document.getElementById('ltqf-dropdown');
  const btn = document.getElementById('ltqf-btn');
  const isOpen = dd.classList.contains('open');
  dd.classList.toggle('open', !isOpen);
  btn.classList.toggle('open', !isOpen);
  if (!isOpen) {
    setTimeout(() => document.addEventListener('click', closeLTQFOutside), 0);
  }
}
function closeLTQF() {
  document.getElementById('ltqf-dropdown')?.classList.remove('open');
  document.getElementById('ltqf-btn')?.classList.remove('open');
  document.removeEventListener('click', closeLTQFOutside);
}
function closeLTQFOutside(e) {
  const wrap = document.getElementById('ltqf-wrap');
  if (wrap && !wrap.contains(e.target)) closeLTQF();
}

function toggleLTQFItem(qid) {
  if (ltSelectedQueues.has(qid)) {
    ltSelectedQueues.delete(qid);
  } else {
    ltSelectedQueues.add(qid);
  }
  document.querySelectorAll('#ltqf-list .qf-item').forEach(el => {
    el.classList.toggle('checked', ltSelectedQueues.has(el.dataset.qid));
  });
  updateLTQFLabel();
  onLTQFChange();
}

function ltqfSelectAll() {
  ACTIVE_QIDS.forEach(qid => ltSelectedQueues.add(qid));
  document.querySelectorAll('#ltqf-list .qf-item').forEach(el => el.classList.add('checked'));
  updateLTQFLabel();
  onLTQFChange();
}

function ltqfSelectNone() {
  ltSelectedQueues.clear();
  document.querySelectorAll('#ltqf-list .qf-item').forEach(el => el.classList.remove('checked'));
  updateLTQFLabel();
  onLTQFChange();
}

function updateLTQFLabel() {
  const lbl = document.getElementById('ltqf-label');
  if (!lbl) return;
  const n = ltSelectedQueues.size;
  const total = ACTIVE_QIDS.length;
  if (n === total) {
    lbl.textContent = `All (${total})`;
  } else if (n === 0) {
    lbl.textContent = 'None';
  } else if (n === 1) {
    const qid = [...ltSelectedQueues][0];
    lbl.textContent = ACTIVE_QUEUE_META[qid]?.name || qid;
  } else {
    lbl.textContent = `${n} of ${total}`;
  }
}

function onLTQFChange() {
  // Re-render the current active panel with the new filter
  fcBuilt = false;
  const activeStep = [1,2,3,4].find(n => document.getElementById('nav-'+n)?.classList.contains('active')) || 3;
  if (activeStep === 1) renderPanel1();
  if (activeStep === 2) renderPanel2();
  if (activeStep === 3) renderPanel3();
  if (activeStep === 4) renderPanel4();
}

// Helper: get the currently selected queue IDs (for use by all panels)
function getSelectedQueueIds() {
  // If nothing selected, treat as all selected (graceful fallback)
  if (ltSelectedQueues.size === 0) return ACTIVE_QIDS;
  return [...ltSelectedQueues];
}

// ── SCREEN NAVIGATION ──────────────────────────────────────────
const BCRUMBS = {
  persona: () => `<span class="crumb active">Select persona</span>`,
  roles:   () => `<span class="crumb" onclick="show('persona','back')" style="cursor:pointer">Select persona</span><span class="crumb-sep">›</span><span class="crumb active">Capacity Planner</span>`,
  lt:      () => `<span class="crumb" onclick="show('persona','back')" style="cursor:pointer">Select persona</span><span class="crumb-sep">›</span><span class="crumb" onclick="show('roles','back')" style="cursor:pointer">Capacity Planner</span><span class="crumb-sep">›</span><span class="crumb active">Long Term Planning</span>`,
};

let cur = 'persona';

function show(next, dir) {
  const fromEl = document.getElementById('s-' + cur);
  const toEl   = document.getElementById('s-' + next);
  if (!fromEl || !toEl) return;

  const outCls = dir === 'forward' ? 'anim-out-l' : 'anim-out-r';
  const inCls  = dir === 'forward' ? 'anim-in-r'  : 'anim-in-l';

  fromEl.classList.add(outCls);
  setTimeout(() => {
    fromEl.classList.remove('active', outCls);
    toEl.classList.add('active', inCls);
    setTimeout(() => toEl.classList.remove(inCls), 240);
    document.getElementById('bcrumb').innerHTML = BCRUMBS[next]();
    cur = next;
    if (next === 'lt') { setTimeout(initLTModule, 80); }
  }, 180);
}

// ── LT STEP NAV ──────────────────────────────────────────────────
const STEP_TITLES = {
  1:'Data Actualization', 2:'HC Reconciliation',
  3:'Forecasting', 4:'Staffing Optimization'
};

function ltStep(n) {
  [1,2,3,4].forEach(i => {
    document.getElementById('nav-'+i)?.classList.remove('active');
    document.getElementById('p-'+i)?.classList.remove('active');
  });
  document.getElementById('nav-'+n)?.classList.add('active');
  document.getElementById('p-'+n)?.classList.add('active');
  document.getElementById('lt-title').textContent = STEP_TITLES[n];
  if (n===1) renderPanel1();
  if (n===2) renderPanel2();
  if (n===3) renderPanel3();
  if (n===4) renderPanel4();
}

// ── COLOUR + FORMAT HELPERS ───────────────────────────────────────
function qColor(qid) { return WFM.COLORS[qid] || '#003B70'; }
function gapColor(gap) {
  if (gap > 10)  return 'var(--red)';
  if (gap > 0)   return 'var(--amber)';
  if (gap > -5)  return 'var(--text3)';
  return 'var(--green)';
}
function fmtGap(g) { return (g >= 0 ? '+' : '') + g; }
function fmtPct(v) { return v.toFixed(1) + '%'; }

// ── PANEL 1 — DATA ACTUALIZATION ─────────────────────────────────
// ── PANEL 1 — PLAN APPROVAL STATE ─────────────────────────────
const p1ApprovalState = {}; // qid -> true/false

function p1Approve(qid) {
  p1ApprovalState[qid] = true;
  renderPanel1();
}

function p1Unapprove(qid) {
  p1ApprovalState[qid] = false;
  renderPanel1();
}

function updateP1ApprovalProgress() {
  const total = ACTIVE_QIDS.length;
  const approved = ACTIVE_QIDS.filter(qid => p1ApprovalState[qid] === true).length;
  const pct = total > 0 ? Math.round(approved / total * 100) : 0;
  const lbl = document.getElementById('p1-appr-label');
  const fill = document.getElementById('p1-appr-fill');
  if (lbl) lbl.textContent = `${approved} / ${total} plans approved`;
  if (fill) fill.style.width = pct + '%';
}

function renderPanel1() {
  const ACT_YEAR = 2026, ACT_MONTH = 2;

  // Use filtered synthetic data for the current hierarchy + queue selection
  const allQs = getSynthQueuesForMonth(ACT_YEAR, ACT_MONTH);
  const selected = getSelectedQueueIds();
  const qs = allQs.filter(q => selected.includes(q.qid));
  const m = getFilteredSynthMonthlyAgg(ACT_YEAR, ACT_MONTH);
  const prev = getFilteredSynthMonthlyAgg(ACT_YEAR, ACT_MONTH - 1) || getFilteredSynthMonthlyAgg(ACT_YEAR - 1, 12);

  if (!m || qs.length === 0) {
    document.getElementById('p1-status-msg').textContent = 'No data available for this selection.';
    document.getElementById('p1-queue-table').innerHTML = '';
    return;
  }

  // Update status based on anomalies — filter to selected queues and exclude approved plans
  const allAnomalies = getAnomaliesForCurrentSelection();
  const selectedQIdxs = new Set(qs.map(q => q.qIdx));
  const filteredAnomalies = allAnomalies.filter(a => {
    if (!selectedQIdxs.has(a.qi)) return false;
    const qid = ACTIVE_QIDS[a.qi - 1];
    if (qid && p1ApprovalState[qid] === true) return false;
    return true;
  });

  const badge = document.getElementById('p1-status-badge');
  const statusLabel = document.getElementById('p1-status-label');
  const statusMsg = document.getElementById('p1-status-msg');
  const anomalyList = document.getElementById('p1-anomaly-list');

  if (filteredAnomalies.length > 0) {
    badge.className = 'dp-status amber';
    statusLabel.textContent = 'Needs review';
    statusMsg.textContent = `Actuals loaded but ${filteredAnomalies.length} data quality issue${filteredAnomalies.length > 1 ? 's' : ''} detected. Manual review recommended.`;
    anomalyList.style.display = '';
    anomalyList.innerHTML = filteredAnomalies.map(a =>
      `<div style="display:flex;align-items:flex-start;gap:6px;padding:5px 8px;background:var(--amber-lt);border:1px solid #F5D9A8;border-radius:4px;margin-bottom:4px;">
        <span style="color:var(--amber);font-size:12px;flex-shrink:0;">⚠</span>
        <span style="font-size:11px;color:var(--text2);line-height:1.5;"><strong style="color:var(--amber);">Plan ${a.qi}:</strong> ${a.desc}</span>
      </div>`
    ).join('');
  } else {
    badge.className = 'dp-status green';
    statusLabel.textContent = 'Complete';
    statusMsg.textContent = 'All actuals loaded. Data quality checks passed. No errors detected.';
    anomalyList.style.display = 'none';
    anomalyList.innerHTML = '';
  }

  // Update driver column header
  const driverInfo = getCurrentDriver();
  const driverTh = document.getElementById('p1-driver-th');
  if (driverTh) driverTh.textContent = driverInfo.name;

  document.getElementById('p1-month-label').textContent = m.month_label || 'Feb 2026';
  document.getElementById('p1-q-label').textContent = m.month_label || 'Feb 2026';

  const totalFTE = m.erlang_fte || 0;
  const prevFTE = prev?.erlang_fte || totalFTE;

  function setMetric(id, val, dId, delta, deltaClass) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
    const dl = document.getElementById(dId);
    if (dl) { dl.textContent = delta; dl.className = 'dp-metric-delta ' + (deltaClass||''); }
  }

  const volDelta = prev ? m.vol - prev.vol : 0;
  const ahtDelta = prev ? m.aht - prev.aht : 0;
  setMetric('p1-vol',   WFM.fmtVol(m.vol),   'p1-vol-d',   prev ? (volDelta >= 0 ? '▲ +' : '▼ ') + WFM.fmtN(volDelta) + ' vs Jan' : '', volDelta > 0 ? 'up' : 'dn');
  setMetric('p1-aht',   m.aht + 's',          'p1-aht-d',   prev ? (ahtDelta >= 0 ? '▲ +' : '▼ ') + ahtDelta + 's vs Jan' : '', ahtDelta > 0 ? 'up' : 'dn');
  const shrDelta = prev ? m.shrinkage_pct - prev.shrinkage_pct : 0;
  const occDelta = prev ? m.occupancy_pct - prev.occupancy_pct : 0;
  const availDelta = prev ? m.availability_pct - prev.availability_pct : 0;
  setMetric('p1-shr',   fmtPct(m.shrinkage_pct), 'p1-shr-d', prev ? fmtPct(shrDelta) + 'pp vs Jan' : '', shrDelta > 0 ? 'up' : shrDelta < 0 ? 'dn' : '');
  setMetric('p1-occ',   fmtPct(m.occupancy_pct), 'p1-occ-d', prev ? fmtPct(occDelta) + 'pp vs Jan' : '', occDelta > 0 ? 'dn' : occDelta < 0 ? 'up' : '');
  setMetric('p1-avail', fmtPct(m.availability_pct), 'p1-avail-d', prev ? fmtPct(availDelta) + 'pp vs Jan' : '', availDelta > 0 ? 'dn' : availDelta < 0 ? 'up' : '');
  setMetric('p1-fte',   WFM.fmtN(totalFTE), 'p1-fte-d', fmtGap(totalFTE - prevFTE) + ' vs Jan', totalFTE > prevFTE ? 'up' : 'dn');

  // Build queue table
  const tbody = document.getElementById('p1-queue-table');
  if (!tbody) return;
  tbody.innerHTML = '';
  let totalDrivers = 0;
  let totalHC = 0;
  const anomalyQis = new Set(filteredAnomalies.map(a => a.qi));

  qs.forEach(q => {
    const qFTE = q.erlang_fte;
    const qDrivers = getDriverCountForQueue(q);
    totalDrivers += qDrivers;
    totalHC += q.hc;
    const hasAnomaly = anomalyQis.has(q.qIdx);
    const isApproved = p1ApprovalState[q.qid] === true;
    const tr = document.createElement('tr');
    if (hasAnomaly) tr.style.background = 'var(--amber-lt)';
    tr.innerHTML = `
      <td><span style="display:inline-flex;align-items:center;gap:6px;">
        <strong class="q-link" onclick="openCP('${q.qid}')">${q.qn}</strong>${q.spec ? '<span style="font-size:9px;background:var(--amber-lt);color:var(--amber);padding:1px 5px;border-radius:3px;margin-left:4px;">specialist</span>' : ''}
        ${hasAnomaly ? '<span style="font-size:10px;color:var(--amber);margin-left:2px;" title="Data quality issue">⚠</span>' : ''}
      </span></td>
      <td class="mono">${WFM.fmtN(q.hc)}</td>
      <td class="mono">${WFM.fmtN(qDrivers)}</td>
      <td class="mono">${WFM.fmtVol(q.vol)}</td>
      <td class="mono">${q.aht}s</td>
      <td class="mono">${fmtPct(q.shr)}</td>
      <td class="mono">${fmtPct(q.occ)}</td>
      <td class="mono">${fmtPct(q.avail)}</td>
      <td class="mono blue" style="font-weight:700;">${qFTE}</td>
      <td>${isApproved
        ? '<button style="font-size:9px;padding:3px 8px;border-radius:3px;border:1px solid #B8DECA;background:var(--green-lt);color:var(--green);cursor:pointer;font-weight:600;font-family:var(--sans);" onclick="p1Unapprove(\'' + q.qid + '\')">✓ Approved</button>'
        : '<button style="font-size:9px;padding:3px 8px;border-radius:3px;border:1px solid var(--border);background:var(--card);color:var(--blue3);cursor:pointer;font-weight:600;font-family:var(--sans);" onclick="p1Approve(\'' + q.qid + '\')">Approve Actuals</button>'
      }</td>`;
    tbody.appendChild(tr);
  });
  const totFTE = qs.reduce((s,q) => s + q.erlang_fte, 0);
  const totR = document.createElement('tr');
  totR.style.fontWeight = '700';
  totR.style.background = 'var(--blue-pale)';
  totR.innerHTML = `<td style="color:var(--blue);font-weight:700;">Total</td><td class="mono">${WFM.fmtN(totalHC)}</td><td class="mono">${WFM.fmtN(totalDrivers)}</td><td class="mono">${WFM.fmtVol(m.vol)}</td><td class="mono">${m.aht}s</td><td class="mono">${fmtPct(m.shrinkage_pct)}</td><td class="mono">${fmtPct(m.occupancy_pct)}</td><td class="mono">${fmtPct(m.availability_pct)}</td><td class="mono blue" style="font-weight:700;">${totFTE}</td><td></td>`;
  tbody.appendChild(totR);

  // Update approval progress bar
  updateP1ApprovalProgress();
}

// ── PANEL 2 — HC RECONCILIATION ───────────────────────────────────
let p2EditMode = false;
let p2UserOverrides = { hcPayroll: '', newHires: '', attrition: '', transferIn: '', transferOut: '' };

// KPI data: PAW systemic load vs NICE actuals
const P2_KPI = {
  cols: ['HC on Payroll', 'New Hires', 'Attrition', 'Transfer In', 'Transfer Out'],
  keys: ['hcPayroll', 'newHires', 'attrition', 'transferIn', 'transferOut'],
  paw:  [2004, 72, 20, 3, 10],
  nice: [2000, 68, 24, 2,  8],
};

// Planned/forecasted values for Feb 2026 (built into the forecast)
const P2_PLANNED = { beginningHC: 1962, newHires: 50, attrition: 20, transferIn: 2, transferOut: 8 };

// Shared SVG waterfall chart builder
function buildWaterfallSVG(bars) {
  const W = 460, H = 285, padL = 56, padR = 14, padT = 22, padB = 58;
  const cW = W - padL - padR, cH = H - padT - padB;

  let running = 0;
  bars.forEach(b => {
    if (b.type === 'ref') {
      b.base = 0; b.top = b.abs; running = b.abs;
    } else {
      b.base = b.delta > 0 ? running : running + b.delta;
      b.top  = b.delta > 0 ? running + b.delta : running;
      running += b.delta;
    }
    b.runAfter = running;
  });

  const allVals = bars.flatMap(b => [b.base, b.top]);
  const yMin = Math.min(...allVals) - 15;
  const yMax = Math.max(...allVals) + 15;
  const yRange = yMax - yMin;

  const toY = v => padT + cH - (v - yMin) / yRange * cH;
  const toH = (a, b) => Math.abs(toY(a) - toY(b));

  const n = bars.length;
  const barW = cW / n * 0.52;
  const slot  = cW / n;

  const tickStep = Math.ceil(yRange / 6 / 5) * 5;
  const ticks = [];
  for (let v = Math.ceil(yMin / tickStep) * tickStep; v <= yMax; v += tickStep) ticks.push(v);

  const COL = { ref: '#1A5EA8', pos: '#0A7C4E', neg: '#D9261C' };
  let svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;font-family:var(--sans);">`;

  ticks.forEach(v => {
    const y = toY(v);
    svg += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="#E0EAF3" stroke-width="1"/>`;
    svg += `<text x="${padL - 5}" y="${y + 4}" text-anchor="end" font-size="9" fill="#8898AA" font-family="monospace">${v.toLocaleString()}</text>`;
  });

  bars.forEach((b, i) => {
    if (i < n - 1) {
      const x1 = padL + i * slot + (slot - barW) / 2 + barW;
      const x2 = padL + (i + 1) * slot + (slot - barW) / 2;
      svg += `<line x1="${x1}" y1="${toY(b.runAfter)}" x2="${x2}" y2="${toY(b.runAfter)}" stroke="#C8D8E8" stroke-width="1" stroke-dasharray="3,2"/>`;
    }
  });

  bars.forEach((b, i) => {
    const x   = padL + i * slot + (slot - barW) / 2;
    const y   = toY(b.top);
    const h   = Math.max(toH(b.base, b.top), 5);
    const col = COL[b.type];
    const val = b.type === 'ref' ? b.abs.toLocaleString() : (b.delta >= 0 ? '+' + b.delta : String(b.delta));

    svg += `<rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="3" fill="${col}" opacity="${b.type === 'ref' ? '0.88' : '0.72'}"/>`;

    const lblY = b.type === 'neg' ? toY(b.base) + 13 : y - 5;
    svg += `<text x="${x + barW / 2}" y="${lblY}" text-anchor="middle" font-size="10" font-weight="700" fill="${col}" font-family="monospace">${val}</text>`;

    b.label.split('\n').forEach((line, li) => {
      svg += `<text x="${x + barW / 2}" y="${padT + cH + 16 + li * 13}" text-anchor="middle" font-size="10" fill="#4A5568">${line}</text>`;
    });
  });

  return svg + '</svg>';
}

function p2Mismatch(i) { return P2_KPI.nice[i] - P2_KPI.paw[i]; }

function p2FmtMismatch(v) {
  if (v === 0) return '<span style="color:var(--text3);">—</span>';
  const cls = 'font-family:var(--mono);font-weight:700;color:var(--red);';
  return `<span style="${cls}">${v > 0 ? '+' : ''}${v}</span>`;
}

function p2RenderKpiTable() {
  const el = document.getElementById('p2-kpi-table');
  if (!el) return;

  const colW = 'min-width:110px;text-align:right;padding:9px 14px;';
  const rowLbl = 'font-size:11px;font-weight:700;padding:9px 12px;white-space:nowrap;';

  let html = `<table class="dp-table" style="width:100%;">
    <thead><tr>
      <th style="text-align:left;min-width:160px;">Source / Metric</th>
      ${P2_KPI.cols.map(c => `<th style="text-align:right;min-width:110px;">${c}</th>`).join('')}
    </tr></thead>
    <tbody>`;

  // Row 1: PAW systemic load
  html += `<tr>
    <td style="${rowLbl}color:var(--blue3);">PAW — Systemic Load</td>
    ${P2_KPI.paw.map(v => `<td style="${colW}" class="mono">${v.toLocaleString()}</td>`).join('')}
  </tr>`;

  // Row 2: NICE values
  html += `<tr>
    <td style="${rowLbl}color:var(--text2);">NICE — Actual Values</td>
    ${P2_KPI.nice.map(v => `<td style="${colW}" class="mono">${v.toLocaleString()}</td>`).join('')}
  </tr>`;

  // Row 3: Mismatch (red highlight where non-zero)
  const mismatches = P2_KPI.cols.map((_, i) => p2Mismatch(i));
  const hasMismatch = mismatches.some(v => v !== 0);
  html += `<tr style="background:${hasMismatch ? '#FDF1F0' : 'var(--green-lt)'} ;">
    <td style="${rowLbl}color:var(--red);">Mismatch</td>
    ${mismatches.map(v => `<td style="${colW};">${p2FmtMismatch(v)}</td>`).join('')}
  </tr>`;

  // Row 4: Final data (matches NICE)
  html += `<tr style="background:var(--blue-pale);font-weight:700;">
    <td style="${rowLbl}color:var(--blue);font-weight:800;">Final (after reconciliation)</td>
    ${P2_KPI.nice.map(v => `<td style="${colW};font-family:var(--mono);font-weight:700;color:var(--blue3);">${v.toLocaleString()}</td>`).join('')}
  </tr>`;

  // Row 5: User overwrite (only shown in edit mode or when overrides exist)
  const hasOverrides = Object.values(p2UserOverrides).some(v => v !== '');
  if (p2EditMode || hasOverrides) {
    if (p2EditMode) {
      html += `<tr style="background:var(--amber-lt);">
        <td style="${rowLbl}color:var(--amber);font-weight:800;">Overwritten (user input)</td>
        ${P2_KPI.keys.map((k, i) => `
          <td style="${colW}">
            <input class="dp-editable" type="number" id="p2-ov-${k}"
              value="${p2UserOverrides[k] !== '' ? p2UserOverrides[k] : P2_KPI.nice[i]}"
              oninput="p2SaveOverride('${k}', this.value)"
              style="width:80px;text-align:right;" />
          </td>`).join('')}
      </tr>`;
    } else if (hasOverrides) {
      html += `<tr style="background:var(--amber-lt);">
        <td style="${rowLbl}color:var(--amber);font-weight:800;">Overwritten (user input)</td>
        ${P2_KPI.keys.map((k, i) => {
          const v = p2UserOverrides[k] !== '' ? Number(p2UserOverrides[k]).toLocaleString() : P2_KPI.nice[i].toLocaleString();
          return `<td style="${colW};font-family:var(--mono);font-weight:700;color:var(--amber);">${v}</td>`;
        }).join('')}
      </tr>`;
    }
  }

  html += `</tbody></table>`;
  el.innerHTML = html;
}

// Returns the final value for a KPI key: user override if set, else NICE actual
function p2GetFinal(key) {
  const idx = P2_KPI.keys.indexOf(key);
  const ov = p2UserOverrides[key];
  return ov !== '' ? Number(ov) : P2_KPI.nice[idx];
}

function p2SaveOverride(key, val) {
  p2UserOverrides[key] = val;
  p2RenderHCWalk();
  p2RenderWaterfall();
  p2RenderTrend();
  p2RenderMoMTable();
}

function p2ToggleEdit() {
  p2EditMode = !p2EditMode;
  const btn = document.getElementById('p2-edit-btn');
  if (btn) btn.textContent = p2EditMode ? '✓ Done editing' : '✎ Edit / Overwrite';
  if (p2EditMode) p2ResetConfirm();
  p2RenderKpiTable();
  p2RenderHCWalk();
  p2RenderWaterfall();
  p2RenderTrend();
  p2RenderMoMTable();
}

// Chart 1: Actual HC walk — opening balance → actual movements → closing balance
// Driven by reconciled/overridden values from the KPI table
function p2RenderHCWalk() {
  const el = document.getElementById('p2-hc-walk');
  if (!el) return;

  const newHires    = p2GetFinal('newHires');
  const attrition   = p2GetFinal('attrition');
  const transferIn  = p2GetFinal('transferIn');
  const transferOut = p2GetFinal('transferOut');
  const closingHC   = p2GetFinal('hcPayroll');
  // Opening HC is derived from the closing balance minus actual movements
  const openingHC   = closingHC - newHires + attrition - transferIn + transferOut;

  const hasOverrides = Object.values(p2UserOverrides).some(v => v !== '');
  const sub = document.getElementById('p2-walk-sub');
  if (sub) {
    sub.textContent = hasOverrides ? 'User-overridden values active' : 'Actual movements · reflects reconciled values';
    sub.style.color = hasOverrides ? 'var(--amber)' : '';
  }

  el.innerHTML = buildWaterfallSVG([
    { label: 'Opening\nHC',    abs: openingHC,    type: 'ref' },
    { label: 'New\nHires',     delta: +newHires,   type: 'pos' },
    { label: 'Attrition',      delta: -attrition,  type: 'neg' },
    { label: 'Transfer\nIn',   delta: +transferIn, type: 'pos' },
    { label: 'Transfer\nOut',  delta: -transferOut, type: 'neg' },
    { label: 'Closing\nHC',    abs: closingHC,     type: 'ref' },
  ]);
}

// Chart 2: Forecast vs actual bridge — planned closing HC → plan deviations → actual closing HC
// Shows where the month ended up differently from what was planned/forecasted
function p2RenderWaterfall() {
  const el = document.getElementById('p2-waterfall');
  if (!el) return;

  // Forecasted closing HC (built from planned movements)
  const forecastedClosing = P2_PLANNED.beginningHC
    + P2_PLANNED.newHires
    - P2_PLANNED.attrition
    + P2_PLANNED.transferIn
    - P2_PLANNED.transferOut; // 1962 + 50 - 20 + 2 - 8 = 1,986

  // Actual (reconciled/overridden) values
  const actualClosing   = p2GetFinal('hcPayroll');
  const hiresDev        = p2GetFinal('newHires')    - P2_PLANNED.newHires;    // +ve = more hires than planned
  const attrDev         = -(p2GetFinal('attrition') - P2_PLANNED.attrition);  // +ve = less attrition than planned
  const tInDev          = p2GetFinal('transferIn')  - P2_PLANNED.transferIn;
  const tOutDev         = -(p2GetFinal('transferOut') - P2_PLANNED.transferOut);

  const deviations = [
    { label: 'Unplanned\nHires',      delta: hiresDev  },
    { label: 'Attrition\nDeviation',  delta: attrDev   },
    { label: 'Transfer In\nDeviation',delta: tInDev    },
    { label: 'Transfer Out\nDeviation',delta: tOutDev  },
  ].filter(d => d.delta !== 0); // only show non-zero deviations

  const bars = [
    { label: 'Forecast\nClosing HC', abs: forecastedClosing, type: 'ref' },
    ...deviations.map(d => ({ label: d.label, delta: d.delta, type: d.delta >= 0 ? 'pos' : 'neg' })),
    { label: 'Actual\nClosing HC',   abs: actualClosing,     type: 'ref' },
  ];

  el.innerHTML = buildWaterfallSVG(bars);
}

// ── PANEL 2 — TREND CHART ─────────────────────────────────────────
const P2_TREND = {
  months: ['Sep 25','Oct 25','Nov 25','Dec 25','Jan 26','Feb 26','Mar 26','Apr 26','May 26','Jun 26','Jul 26','Aug 26','Sep 26','Oct 26','Nov 26','Dec 26','Jan 27','Feb 27'],
  // Indices 0-5 are actuals, 6-17 are forecast
  actualCount: 6,
  data: {
    hcPayroll: {
      label: 'HC on Payroll',
      actual:   [1876, 1898, 1912, 1940, 1962, 2000, null, null, null, null, null, null, null, null, null, null, null, null],
      forecast: [1880, 1895, 1910, 1932, 1970, 1986, 2015, 2028, 2040, 2052, 2065, 2078, 2090, 2100, 2112, 2120, 2132, 2145],
      comments: {
        3: 'Seasonal hiring intake for Q4 operations — 15 additional agents onboarded ahead of holiday volumes',
        4: 'Mumbai site added for USPB Fraud operations — +45 HC planned intake beginning Jan 2026. Drove elevated hiring above forecast.',
        5: 'HC reconciliation complete · Feb 2026 actuals confirmed at 2,000 via NICE',
        6: 'Forecasted ramp-up for Q1 2026 — planned intake of 24 new hires across 3 specialist plans',
        11: 'Planned headcount plateau — hiring to slow as capacity targets are met by Aug 2026',
      }
    },
    newHires: {
      label: 'New Hires',
      actual:   [45, 38, 32, 55, 80, 68, null, null, null, null, null, null, null, null, null, null, null, null],
      forecast: [42, 36, 30, 50, 70, 50, 24, 20, 18, 22, 20, 18, 15, 18, 20, 22, 20, 18],
      comments: {
        3: 'Q4 seasonal intake — 55 hires vs 50 planned due to early Q1 2026 demand signal',
        4: 'Mumbai site launch drove elevated hiring — 80 actual vs 70 planned. 10% above forecast.',
        5: 'Feb 2026 actuals: 68 new hires confirmed via NICE vs 50 planned. Onboarding pipeline carried over from Jan.',
        6: 'Planned cooldown post-Mumbai ramp — 24 hires targeted for Mar 2026',
        9: 'Jun 2026 hiring uptick planned ahead of Q3 volume peak',
      }
    },
    attrition: {
      label: 'Attrition',
      actual:   [18, 20, 22, 16, 28, 24, null, null, null, null, null, null, null, null, null, null, null, null],
      forecast: [20, 20, 20, 18, 22, 20, 22, 20, 18, 28, 20, 18, 20, 18, 18, 16, 20, 20],
      comments: {
        2: 'Nov 25 attrition slightly elevated — contract expirations across CRS cluster',
        4: 'Jan 2026 attrition spike — 28 vs 22 planned. Driven by voluntary exits following annual appraisal cycle.',
        9: 'Forecasted attrition peak in Jun 2026 — annual performance review cycle typically drives voluntary exits',
      }
    },
    transferIn: {
      label: 'Transfer In',
      actual:   [3, 2, 4, 5, 3, 2, null, null, null, null, null, null, null, null, null, null, null, null],
      forecast: [3, 2, 4, 4, 3, 2, 5, 4, 3, 2, 3, 4, 3, 2, 3, 4, 3, 2],
      comments: {
        3: 'Q4 cross-LOB transfers — 5 agents moved in from Wealth Management for seasonal support',
        6: 'Planned increase in transfers in — agents from ICRM being cross-skilled into USPB Fraud plans',
      }
    },
    transferOut: {
      label: 'Transfer Out',
      actual:   [5, 6, 4, 3, 10, 8, null, null, null, null, null, null, null, null, null, null, null, null],
      forecast: [5, 5, 4, 4, 8, 8, 6, 5, 5, 6, 5, 5, 5, 5, 5, 5, 5, 5],
      comments: {
        4: 'Jan 2026 — 10 agents transferred out to support new ICRM initiative launch. 25% above forecast.',
        5: 'Feb 2026 — 8 agents transferred out, in line with adjusted forecast',
      }
    },
  }
};

let p2TrendKPI = 'hcPayroll';

function p2RenderTrendBtns() {
  const el = document.getElementById('p2-trend-btns');
  if (!el) return;
  const kpis = [
    ['hcPayroll',   'HC on Payroll'],
    ['newHires',    'New Hires'],
    ['attrition',   'Attrition'],
    ['transferIn',  'Transfer In'],
    ['transferOut', 'Transfer Out'],
  ];
  el.innerHTML = kpis.map(([k, lbl]) => {
    const active = k === p2TrendKPI;
    return `<button id="p2-trend-btn-${k}" onclick="p2SelectTrend('${k}')"
      style="padding:5px 12px;font-size:10px;font-weight:700;border-radius:4px;cursor:pointer;border:1px solid var(--border);font-family:var(--sans);transition:all .15s;
      background:${active ? 'var(--blue)' : 'var(--card)'};color:${active ? '#fff' : 'var(--text2)'};">${lbl}</button>`;
  }).join('');
}

function p2SelectTrend(kpi) {
  p2TrendKPI = kpi;
  p2RenderTrendBtns();
  p2RenderTrend();
}

function p2ShowTip(evt, kpiKey, idx, isActual) {
  const tip = document.getElementById('p2-trend-tip');
  if (!tip) return;
  const kpiBase = P2_TREND.data[kpiKey];
  const FEB26   = P2_TREND.actualCount - 1;
  // Use live reconciled value for the Feb 26 actual point
  let val = isActual ? kpiBase.actual[idx] : kpiBase.forecast[idx];
  if (isActual && idx === FEB26 && P2_KPI.keys.includes(kpiKey)) val = p2GetFinal(kpiKey);
  const kpi = kpiBase;
  const comment = kpi.comments?.[idx];
  const month = P2_TREND.months[idx];
  const type  = isActual ? 'Actual' : 'Forecast';
  const valColor = isActual ? '#003B70' : '#6D28D9';

  let html = `<div style="font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">${month}</div>`;
  html += `<div style="display:flex;gap:10px;align-items:baseline;">
    <span style="font-family:monospace;font-size:16px;font-weight:700;color:${valColor};">${val?.toLocaleString()}</span>
    <span style="font-size:10px;padding:1px 6px;border-radius:3px;font-weight:600;background:${isActual ? '#E8F5EE' : '#EDE9FE'};color:${isActual ? '#0A7C4E' : '#5B21B6'};">${type}</span>
  </div>`;
  if (comment) {
    html += `<div style="margin-top:8px;padding-top:7px;border-top:1px solid var(--border-lt);font-size:10px;color:var(--text2);line-height:1.55;">
      <span style="color:var(--amber);font-weight:700;margin-right:4px;">&#9679;</span>${comment}
    </div>`;
  }
  tip.innerHTML = html;
  tip.style.display = 'block';

  const wrap = document.getElementById('p2-trend-wrap');
  const r = wrap.getBoundingClientRect();
  let left = evt.clientX - r.left + 14;
  let top  = evt.clientY - r.top  - 14;
  if (left + 250 > r.width) left = evt.clientX - r.left - 264;
  if (top < 0) top = 4;
  tip.style.left = left + 'px';
  tip.style.top  = top  + 'px';
}

function p2HideTip() {
  const tip = document.getElementById('p2-trend-tip');
  if (tip) tip.style.display = 'none';
}

function p2RenderTrend() {
  const el = document.getElementById('p2-trend-chart');
  if (!el) return;

  const kpiBase = P2_TREND.data[p2TrendKPI];
  const months  = P2_TREND.months;
  const n       = months.length;
  const actN    = P2_TREND.actualCount;
  const FEB26   = actN - 1; // index 5

  // Clone arrays so we can override Feb 26 with the live reconciled value
  const actualArr   = [...kpiBase.actual];
  const forecastArr = [...kpiBase.forecast];
  // The trend KPI keys match P2_KPI keys — override Feb 26 actual point
  if (P2_KPI.keys.includes(p2TrendKPI)) {
    actualArr[FEB26] = p2GetFinal(p2TrendKPI);
  }

  // Wrap so the rest of the function uses the overridden arrays
  const kpi = { ...kpiBase, actual: actualArr, forecast: forecastArr };

  // Collect all values for Y scale
  const allVals = [
    ...kpi.actual.filter(v => v !== null),
    ...kpi.forecast,
  ];
  const yPad  = (Math.max(...allVals) - Math.min(...allVals)) * 0.12;
  const yMin  = Math.min(...allVals) - yPad;
  const yMax  = Math.max(...allVals) + yPad;
  const yRange = yMax - yMin;

  const W = 760, H = 280, padL = 56, padR = 20, padT = 28, padB = 48;
  const cW = W - padL - padR, cH = H - padT - padB;

  const toX = i  => padL + (i / (n - 1)) * cW;
  const toY = v  => padT + cH - (v - yMin) / yRange * cH;

  // Y-axis ticks
  const tickStep = Math.ceil(yRange / 6 / 5) * 5 || 1;
  const ticks = [];
  for (let v = Math.ceil(yMin / tickStep) * tickStep; v <= yMax; v += tickStep) ticks.push(v);

  let svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;font-family:var(--sans);" onmouseleave="p2HideTip()">`;

  // Forecast shaded region background
  const fX = toX(actN - 1);
  svg += `<rect x="${fX}" y="${padT}" width="${W - padR - fX}" height="${cH}" fill="#F0F5FA" opacity=".6"/>`;

  // Gridlines + Y labels
  ticks.forEach(v => {
    const y = toY(v);
    svg += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="#E0EAF3" stroke-width="1"/>`;
    svg += `<text x="${padL - 6}" y="${y + 4}" text-anchor="end" font-size="9" fill="#8898AA" font-family="monospace">${v.toLocaleString()}</text>`;
  });

  // Actual/Forecast boundary line
  svg += `<line x1="${fX}" y1="${padT}" x2="${fX}" y2="${padT + cH}" stroke="#C8D8E8" stroke-width="1.5" stroke-dasharray="4,3"/>`;
  svg += `<text x="${fX - 6}" y="${padT + 10}" text-anchor="end" font-size="8" font-weight="700" fill="#8898AA" letter-spacing=".5">ACTUAL</text>`;
  svg += `<text x="${fX + 6}" y="${padT + 10}" text-anchor="start" font-size="8" font-weight="700" fill="#6D28D9" letter-spacing=".5" opacity=".7">FORECAST</text>`;

  // X-axis month labels (every other to avoid crowding)
  months.forEach((m, i) => {
    if (i % 2 === 0 || i === n - 1) {
      svg += `<text x="${toX(i)}" y="${padT + cH + 16}" text-anchor="middle" font-size="9" fill="${i < actN ? '#4A5568' : '#6D28D9'}" opacity="${i < actN ? '1' : '.7'}">${m}</text>`;
    }
  });

  // ── Forecast line (dashed, purple-ish) ──
  const fcPts = months.map((_, i) => `${toX(i)},${toY(kpi.forecast[i])}`).join(' ');
  svg += `<polyline points="${fcPts}" fill="none" stroke="#7C3AED" stroke-width="1.5" stroke-dasharray="5,3" opacity=".55"/>`;

  // ── Actual line (solid, blue) ──
  const actPts = months.slice(0, actN).map((_, i) => `${toX(i)},${toY(kpi.actual[i])}`).join(' ');
  svg += `<polyline points="${actPts}" fill="none" stroke="#003B70" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`;

  // ── Data points ──
  const isOverridden = P2_KPI.keys.includes(p2TrendKPI) && p2UserOverrides[p2TrendKPI] !== '';
  months.forEach((_, i) => {
    const isActual   = i < actN;
    const isOvPoint  = isActual && i === FEB26 && isOverridden;
    const val = isActual ? kpi.actual[i] : kpi.forecast[i];
    if (val === null) return;
    const x = toX(i), y = toY(val);
    const hasComment = kpi.comments?.[i] != null;
    const col = isOvPoint ? '#B45309' : (isActual ? '#003B70' : '#7C3AED');

    // Override pulse ring
    if (isOvPoint) {
      svg += `<circle cx="${x}" cy="${y}" r="11" fill="#B45309" opacity=".15"/>`;
    } else if (hasComment) {
      svg += `<circle cx="${x}" cy="${y}" r="${isActual ? 9 : 8}" fill="${col}" opacity=".12"/>`;
    }
    // Dot
    const r = isOvPoint ? 6 : (isActual ? 4.5 : 3.5);
    svg += `<circle cx="${x}" cy="${y}" r="${r}" fill="${col}" stroke="white" stroke-width="1.5" opacity="${isActual ? '1' : '.7'}"/>`;
    // Value label for overridden point
    if (isOvPoint) {
      svg += `<text x="${x}" y="${y - 12}" text-anchor="middle" font-size="9" font-weight="700" fill="#B45309">${val.toLocaleString()} ✎</text>`;
    }
    // Invisible large hit area for hover
    svg += `<circle cx="${x}" cy="${y}" r="14" fill="transparent"
      onmouseenter="p2ShowTip(event,'${p2TrendKPI}',${i},${isActual ? 1 : 0})"
      onmouseleave="p2HideTip()" style="cursor:pointer;"/>`;
  });

  // Legend
  const legY = H - 10;
  svg += `<line x1="${padL}" y1="${legY}" x2="${padL + 22}" y2="${legY}" stroke="#003B70" stroke-width="2.2"/>`;
  svg += `<circle cx="${padL + 11}" cy="${legY}" r="3.5" fill="#003B70" stroke="white" stroke-width="1"/>`;
  svg += `<text x="${padL + 28}" y="${legY + 4}" font-size="9" fill="#4A5568" font-weight="600">Actuals</text>`;
  svg += `<line x1="${padL + 80}" y1="${legY}" x2="${padL + 102}" y2="${legY}" stroke="#7C3AED" stroke-width="1.5" stroke-dasharray="5,3" opacity=".7"/>`;
  svg += `<circle cx="${padL + 91}" cy="${legY}" r="3" fill="#7C3AED" stroke="white" stroke-width="1" opacity=".7"/>`;
  svg += `<text x="${padL + 108}" y="${legY + 4}" font-size="9" fill="#6D28D9" font-weight="600" opacity=".8">Forecast</text>`;
  svg += `<circle cx="${padL + 162}" cy="${legY}" r="7" fill="#003B70" opacity=".12"/>`;
  svg += `<circle cx="${padL + 162}" cy="${legY}" r="3" fill="#4A5568"/>`;
  svg += `<text x="${padL + 175}" y="${legY + 4}" font-size="9" fill="#4A5568">Commentary available — hover to view</text>`;

  svg += '</svg>';
  el.innerHTML = svg;
}

// ── PANEL 2 — CONFIRM RECONCILIATION ─────────────────────────────
let p2Confirmed = false;

function p2ConfirmReconciliation() {
  p2Confirmed = true;
  const btn = document.getElementById('p2-confirm-btn');
  const status = document.getElementById('p2-confirm-status');
  if (btn) {
    btn.textContent = '✓ Reconciliation confirmed';
    btn.style.opacity = '.65';
    btn.disabled = true;
  }
  if (status) {
    const d = new Date();
    const ds = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    status.textContent = `Confirmed ${ds} · values locked in all charts below`;
    status.style.display = '';
  }
  // Refresh all charts and table with confirmed values
  p2RenderHCWalk();
  p2RenderWaterfall();
  p2RenderTrend();
  p2RenderMoMTable();
}

// Allow re-confirmation after a new edit
function p2ResetConfirm() {
  p2Confirmed = false;
  const btn = document.getElementById('p2-confirm-btn');
  if (btn) { btn.textContent = '✓ Confirm reconciliation'; btn.style.opacity = '1'; btn.disabled = false; }
  const status = document.getElementById('p2-confirm-status');
  if (status) status.style.display = 'none';
}

// ── PANEL 2 — MoM TABLE ───────────────────────────────────────────
const P2_MOM_PLANS = [
  { id: 'all',  name: 'All Plans (Combined)',        factor: 1.00 },
  { id: 'p1',   name: 'USPB Recovery — Inbound',     factor: 0.22 },
  { id: 'p2',   name: 'USPB Collections — Inbound',  factor: 0.18 },
  { id: 'p3',   name: 'USPB Fraud — Inbound',        factor: 0.15 },
  { id: 'p4',   name: 'Wealth Customer Service',      factor: 0.25 },
  { id: 'p5',   name: 'ICRM Call — Inbound',         factor: 0.20 },
];
let p2SelectedPlan = 'all';

function p2SelectPlan(id) {
  p2SelectedPlan = id;
  p2RenderMoMTable();
}

function p2RenderMoMPlanSelect() {
  const el = document.getElementById('p2-mom-plan');
  if (!el) return;
  el.innerHTML = P2_MOM_PLANS.map(p =>
    `<option value="${p.id}" ${p.id === p2SelectedPlan ? 'selected' : ''}>${p.name}</option>`
  ).join('');
}

// Build month-by-month row data, applying plan factor and live reconciled values for Feb 26
function p2GetMoMData(factor) {
  const actN = P2_TREND.actualCount;
  const FEB26 = actN - 1; // index 5

  function getVal(kpiKey, i) {
    const kpi = P2_TREND.data[kpiKey];
    let v = i < actN ? kpi.actual[i] : kpi.forecast[i];
    if (i === FEB26 && i < actN) v = p2GetFinal(kpiKey); // use confirmed/overridden value
    return Math.round((v || 0) * factor);
  }

  const rows = P2_TREND.months.map((month, i) => ({
    month,
    isActual:  i < actN,
    isCurrent: i === FEB26,
    closing:     getVal('hcPayroll',   i),
    newHires:    getVal('newHires',    i),
    attrition:   getVal('attrition',   i),
    transferIn:  getVal('transferIn',  i),
    transferOut: getVal('transferOut', i),
    opening: 0, // filled below
  }));

  // Chain opening HC so each month's opening = previous month's closing.
  // First row derives opening from its own movements (no prior month available).
  rows[0].opening = rows[0].closing - rows[0].newHires + rows[0].attrition
                    - rows[0].transferIn + rows[0].transferOut;
  for (let i = 1; i < rows.length; i++) {
    rows[i].opening = rows[i - 1].closing;
  }

  return rows;
}

function p2RenderMoMTable() {
  const el = document.getElementById('p2-mom-table');
  if (!el) return;
  const plan = P2_MOM_PLANS.find(p => p.id === p2SelectedPlan) || P2_MOM_PLANS[0];
  const rows = p2GetMoMData(plan.factor);

  const thStyle = 'text-align:right;';
  let html = `<table class="dp-table" style="width:100%;min-width:700px;">
    <thead><tr>
      <th>Month</th><th>Type</th>
      <th style="${thStyle}">Opening HC</th>
      <th style="${thStyle}">+ New Hires</th>
      <th style="${thStyle}">− Attrition</th>
      <th style="${thStyle}">+ Transfer In</th>
      <th style="${thStyle}">− Transfer Out</th>
      <th style="${thStyle}">Closing HC</th>
    </tr></thead><tbody>`;

  const td = (val, color) =>
    `<td style="text-align:right;font-family:var(--mono);font-weight:600;color:${color || 'var(--text2)'};">${val}</td>`;

  rows.forEach(r => {
    const rowBg = r.isCurrent
      ? 'background:var(--amber-lt);'
      : (!r.isActual ? 'background:var(--blue-pale);opacity:.92;' : '');
    const typeBadge = `<span style="font-size:9px;padding:2px 7px;border-radius:3px;font-weight:700;
      background:${r.isActual ? 'var(--green-lt)' : 'var(--blue-pale)'};
      color:${r.isActual ? 'var(--green)' : 'var(--blue3)'};">${r.isActual ? 'Actual' : 'Forecast'}</span>`;
    const monthCell = `<td style="font-weight:${r.isCurrent ? '700' : '500'};color:${r.isCurrent ? 'var(--amber)' : 'var(--text)'};">${r.month}${r.isCurrent ? ' &#9679;' : ''}</td>`;

    html += `<tr style="${rowBg}">
      ${monthCell}
      <td>${typeBadge}</td>
      ${td(r.opening.toLocaleString(), 'var(--blue3)')}
      ${td('+' + r.newHires, 'var(--green)')}
      ${td('−' + r.attrition, 'var(--red)')}
      ${td('+' + r.transferIn, 'var(--green)')}
      ${td('−' + r.transferOut, 'var(--red)')}
      ${td(r.closing.toLocaleString(), 'var(--blue)')}
    </tr>`;
  });

  html += '</tbody></table>';
  el.innerHTML = html;
}

function renderPanel2() {
  p2RenderKpiTable();
  p2RenderHCWalk();
  p2RenderWaterfall();
  p2RenderTrendBtns();
  p2RenderTrend();
  p2RenderMoMPlanSelect();
  p2RenderMoMTable();
}

// ── PANEL 3 — FORECASTING ─────────────────────────────────────────
let p3CurrentView = 'monthly';

function p3View(view) {
  p3CurrentView = view;
  const mView = document.getElementById('p3-monthly-view');
  const qView = document.getElementById('p3-queue-view');
  const bM = document.getElementById('btn-monthly');
  const bQ = document.getElementById('btn-queue');
  if (view === 'monthly') {
    mView.style.display = ''; qView.style.display = 'none';
    bM.style.background = 'var(--blue)'; bM.style.color = '#fff';
    bQ.style.background = 'var(--card)'; bQ.style.color = 'var(--text2)';
  } else {
    mView.style.display = 'none'; qView.style.display = '';
    bQ.style.background = 'var(--blue)'; bQ.style.color = '#fff';
    bM.style.background = 'var(--card)'; bM.style.color = 'var(--text2)';
  }
}

let p3AccType = 't3'; // 't3' or 'plan'

function setAccType(type) {
  p3AccType = type;
  const t3Btn = document.getElementById('acc-t3-btn');
  const planBtn = document.getElementById('acc-plan-btn');
  if (t3Btn && planBtn) {
    t3Btn.style.background = type === 't3' ? 'var(--blue)' : 'var(--card)';
    t3Btn.style.color = type === 't3' ? '#fff' : 'var(--text2)';
    planBtn.style.background = type === 'plan' ? 'var(--blue)' : 'var(--card)';
    planBtn.style.color = type === 'plan' ? '#fff' : 'var(--text2)';
  }
  renderP3Accuracy();
}

function renderP3Accuracy() {
  const accEl = document.getElementById('p3-accuracy');
  if (!accEl) return;
  const selectedQids = getSelectedQueueIds();
  const moNames = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const SEASONAL = [0, 1.12, 0.95, 1.02, 0.98, 0.94, 0.88, 0.86, 0.90, 0.96, 1.10, 1.08, 1.05];

  const varSel = document.getElementById('acc-var-sel');
  const accVar = varSel ? varSel.value : 'vol';

  // Variable extraction functions
  const varExtract = {
    vol:   (qs) => qs.reduce((s,q) => s + q.vol, 0),
    aht:   (qs) => qs.length > 0 ? Math.round(qs.reduce((s,q) => s + q.aht * q.vol, 0) / (qs.reduce((s,q)=>s+q.vol,0) || 1)) : 0,
    avail: (qs) => qs.length > 0 ? qs.reduce((s,q) => s + q.avail, 0) / qs.length : 0,
    occ:   (qs) => qs.length > 0 ? qs.reduce((s,q) => s + q.occ, 0) / qs.length : 0,
    fte:   (qs) => qs.reduce((s,q) => s + (q.erlang_fte || 0), 0),
  };

  // For volume and FTE, seasonal scaling matters. For AHT/avail/occ, use direct comparison
  const isSeasonalVar = (v) => v === 'vol' || v === 'fte';

  const last3 = [[2025,12],[2026,1],[2026,2]];

  accEl.innerHTML = last3.map(([y,m]) => {
    const actQs = getSynthQueuesForMonth(y, m);
    const actFiltered = actQs.filter(q => selectedQids.includes(q.qid));
    const actualVal = varExtract[accVar](actFiltered);

    let fcstVal = 0;
    if (p3AccType === 't3') {
      // T-3: compare against data from 3 months prior, scaled seasonally for vol/fte
      let fy = y, fm = m - 3;
      if (fm <= 0) { fm += 12; fy--; }
      const fcQs = getSynthQueuesForMonth(fy, fm);
      const fcFiltered = fcQs.filter(q => selectedQids.includes(q.qid));
      const baseVal = varExtract[accVar](fcFiltered);
      if (isSeasonalVar(accVar)) {
        fcstVal = Math.round(baseVal * SEASONAL[m] / (SEASONAL[fm] || 1));
      } else {
        // AHT/avail/occ don't vary much seasonally — apply small drift
        fcstVal = baseVal;
      }
    } else {
      // Plan: compare against August 2025 projection
      const augQs = getSynthQueuesForMonth(2025, 8);
      const augFiltered = augQs.filter(q => selectedQids.includes(q.qid));
      const augVal = varExtract[accVar](augFiltered);
      if (isSeasonalVar(accVar)) {
        fcstVal = Math.round(augVal * SEASONAL[m] / SEASONAL[8] * 1.02);
      } else {
        fcstVal = augVal;
      }
    }

    const mape = actualVal > 0 ? Math.abs(actualVal - fcstVal) / actualVal * 100 : 0;
    const acc = Math.max(0, (100 - mape)).toFixed(1);
    const cls = acc >= 90 ? 'dn' : 'up';
    return `<div class="dp-metric"><div class="dp-metric-val ${cls}">${acc}%</div><div class="dp-metric-lbl">${moNames[m]}</div></div>`;
  }).join('');
}

function renderP3ForecastAlerts(selectedQids) {
  const SEASONAL = [0, 1.12, 0.95, 1.02, 0.98, 0.94, 0.88, 0.86, 0.90, 0.96, 1.10, 1.08, 1.05];
  const alerts = [];
  const ACC_THRESHOLD = 90;
  const VOL_DEV_THRESHOLD = 15; // % deviation in actuals
  const AHT_DEV_THRESHOLD = 10; // % deviation in actuals
  const DRIVER_CHG_THRESHOLD = 10; // % change in driver forecast

  const count = getQueueCount();
  for (let i = 1; i <= count; i++) {
    const qid = ACTIVE_QIDS[i-1];
    if (!qid || !selectedQids.includes(qid)) continue;

    const key = hierState.business + '|' + hierState.func + '|' + i;
    const records = SYNTH_QUEUES[key];
    if (!records) continue;

    const planName = 'Plan ' + i;
    const feb26 = records.find(r => r.yr === 2026 && r.mo === 2);
    const jan26 = records.find(r => r.yr === 2026 && r.mo === 1);
    const nov25 = records.find(r => r.yr === 2025 && r.mo === 11);

    // --- TYPE 1: Actuals Deviation (Feb vs Jan) ---
    if (feb26 && jan26) {
      const volChg = jan26.vol > 0 ? Math.abs(feb26.vol - jan26.vol) / jan26.vol * 100 : 0;
      if (volChg > VOL_DEV_THRESHOLD) {
        const dir = feb26.vol > jan26.vol ? 'increased' : 'decreased';
        alerts.push({ plan: planName, type: 'actuals', variable: 'Volume',
          desc: 'Volume ' + dir + ' by ' + volChg.toFixed(0) + '% in Feb vs Jan actuals — sustained deviation may require forecast refresh', qid });
      }
      const ahtChg = jan26.aht > 0 ? Math.abs(feb26.aht - jan26.aht) / jan26.aht * 100 : 0;
      if (ahtChg > AHT_DEV_THRESHOLD) {
        const dir = feb26.aht > jan26.aht ? 'increased' : 'decreased';
        alerts.push({ plan: planName, type: 'actuals', variable: 'AHT',
          desc: 'AHT ' + dir + ' by ' + ahtChg.toFixed(0) + '% in Feb vs Jan — monitor for trend confirmation', qid });
      }
    }

    // --- TYPE 2: Driver Forecast Change (current vs plan vintage) ---
    const vintageKey = key;
    const curVintage = FORECAST_VINTAGES[vintageKey]?.mar26;
    const planVintage = FORECAST_VINTAGES[vintageKey]?.aug25;
    if (curVintage && planVintage && curVintage.length > 0 && planVintage.length > 0) {
      const curAvgVol = curVintage.reduce((s,r) => s + r.vol, 0) / curVintage.length;
      const planAvgVol = planVintage.reduce((s,r) => s + r.vol, 0) / planVintage.length;
      const driverChg = planAvgVol > 0 ? Math.abs(curAvgVol - planAvgVol) / planAvgVol * 100 : 0;
      if (driverChg > DRIVER_CHG_THRESHOLD) {
        const dir = curAvgVol > planAvgVol ? 'higher' : 'lower';
        alerts.push({ plan: planName, type: 'driver', variable: 'Drivers',
          desc: 'Driver-implied volume is ' + driverChg.toFixed(0) + '% ' + dir + ' than Aug plan — driver forecast may have changed', qid });
      }
    }

    // --- TYPE 3: Low T-3 Accuracy ---
    if (feb26 && nov25) {
      var varChecks = [
        { name: 'Volume', actual: feb26.vol, forecast: Math.round(nov25.vol * SEASONAL[2] / (SEASONAL[11] || 1)) },
        { name: 'AHT', actual: feb26.aht, forecast: nov25.aht },
        { name: 'Availability', actual: feb26.avail, forecast: nov25.avail },
        { name: 'Occupancy', actual: feb26.occ, forecast: nov25.occ },
      ];
      varChecks.forEach(function(v) {
        var mape = v.actual > 0 ? Math.abs(v.actual - v.forecast) / v.actual * 100 : 0;
        var acc = 100 - mape;
        if (acc < ACC_THRESHOLD) {
          alerts.push({ plan: planName, type: 'accuracy', variable: v.name,
            desc: v.name + ' T-3 forecast accuracy is only ' + acc.toFixed(1) + '% — below ' + ACC_THRESHOLD + '% threshold', qid });
        }
      });
    }
  }

  const badge = document.getElementById('p3-status-badge');
  const label = document.getElementById('p3-status-label');
  const msg = document.getElementById('p3-status-msg');
  const alertsEl = document.getElementById('p3-fc-alerts');

  if (alerts.length > 0) {
    const accCount = alerts.filter(function(a) { return a.type === 'accuracy'; }).length;
    const devCount = alerts.filter(function(a) { return a.type === 'actuals'; }).length;
    const drvCount = alerts.filter(function(a) { return a.type === 'driver'; }).length;
    badge.className = 'dp-status amber';
    label.textContent = 'Forecast Refresh Recommended';
    msg.textContent = alerts.length + ' alert' + (alerts.length > 1 ? 's' : '') + ' detected (' +
      [accCount > 0 ? accCount + ' accuracy' : '', devCount > 0 ? devCount + ' actuals deviation' : '', drvCount > 0 ? drvCount + ' driver change' : ''].filter(Boolean).join(', ') +
      '). Forecast refresh recommended.';

    var iconMap = { accuracy: '📉', actuals: '📊', driver: '🔀' };
    var labelMap = { accuracy: 'Low accuracy', actuals: 'Actuals deviation', driver: 'Driver change' };
    alertsEl.innerHTML = alerts.map(function(a) {
      return '<div style="display:flex;align-items:flex-start;gap:6px;padding:5px 8px;background:var(--amber-lt);border:1px solid #F5D9A8;border-radius:4px;margin-bottom:4px;">' +
        '<span style="font-size:12px;flex-shrink:0;">' + iconMap[a.type] + '</span>' +
        '<span style="font-size:11px;color:var(--text2);line-height:1.5;"><strong style="color:var(--amber);">' + a.plan + '</strong> <span style="font-size:9px;padding:1px 5px;border-radius:3px;background:var(--amber-lt);color:var(--amber);border:1px solid #F5D9A8;margin:0 3px;">' + labelMap[a.type] + '</span> ' + a.desc + '</span>' +
      '</div>';
    }).join('');
  } else {
    badge.className = 'dp-status green';
    label.textContent = 'On track';
    msg.textContent = 'All forecast variables within tolerance. No accuracy, actuals deviation, or driver change alerts.';
    alertsEl.innerHTML = '';
  }
}

function renderPanel3() {
  const selectedQids = getSelectedQueueIds();

  // Compute per-plan forecast alerts
  renderP3ForecastAlerts(selectedQids);

  // Accuracy strip
  renderP3Accuracy();

  // FTE strip (next 3 forecast months) — filtered by selected plans
  const peakEl = document.getElementById('p3-peak');
  if (peakEl) {
    const next3 = [[2026,3],[2026,4],[2026,5]];
    const moNames = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    peakEl.innerHTML = next3.map(([y,m]) => {
      const allQs = getSynthQueuesForMonth(y, m);
      const qs = allQs.filter(q => selectedQids.includes(q.qid));
      const fte = qs.reduce((s,q) => s + (q.erlang_fte || 0), 0);
      return `<div class="dp-metric"><div class="dp-metric-val neu">${fte}</div><div class="dp-metric-lbl">${moNames[m]}</div></div>`;
    }).join('');
  }

  // Monthly forecast table
  buildFcTable();

  // Populate month selector for plan view (always refresh on render)
  const sel = document.getElementById('p3-month-sel');
  if (sel && sel.options.length === 0) {
    const fcMonths = WFM.monthly.filter(r => r.is_forecast);
    fcMonths.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.year + '_' + m.month;
      opt.textContent = m.month_label;
      if (m.year===2026 && m.month===3) opt.selected = true;
      sel.appendChild(opt);
    });
  }
  renderQueueForecast();
}

// Monthly forecast table
let fcBuilt = false;
function buildFcTable() {
  if (fcBuilt) return; fcBuilt = true;
  const tbody = document.getElementById('fc-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const fcMonths = WFM.monthly.filter(r => r.is_forecast);
  const totalHC = 2000;

  fcMonths.forEach(m => {
    const fte = m.erlang_fte || 0;
    const variance = totalHC - fte;
    const vc = variance >= 0 ? 'var(--green)' : 'var(--red)';

    const tr = document.createElement('tr');
    tr.style.cursor = 'pointer';
    tr.title = 'Double-click to open forecast detail';
    tr.ondblclick = openFD;
    tr.innerHTML = `
      <td style="color:var(--text);font-weight:600;">${m.month_label}</td>
      <td class="mono">${WFM.fmtVol(m.vol)}</td>
      <td class="mono">${m.aht}s</td>
      <td class="mono">${fmtPct(m.shrinkage_pct)}</td>
      <td class="mono">${fmtPct(m.availability_pct)}</td>
      <td class="mono blue" style="font-weight:700;">${fte}</td>
      <td class="mono">${WFM.fmtN(totalHC)}</td>
      <td class="mono" style="color:${vc};font-weight:700;">${variance >= 0 ? '+' : ''}${variance}</td>`;
    tbody.appendChild(tr);
  });
}

function renderQueueForecast() {
  const sel = document.getElementById('p3-month-sel');
  if (!sel || !sel.value) return;
  const [y,m] = sel.value.split('_').map(Number);
  const moNames = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const ml = moNames[m] + ' ' + y;
  const ql = document.getElementById('p3-q-month');
  if (ql) ql.textContent = ml;

  const qs = getSynthQueuesForMonth(y, m);
  const tbody = document.getElementById('p3-queue-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  qs.forEach(q => {
    const qFTE = q.erlang_fte || 0;
    const variance = q.hc - qFTE;
    const vc = variance >= 0 ? 'var(--green)' : 'var(--red)';
    const planAlerts = getPlanAlerts(q.qid);
    const hasAlert = planAlerts.variables.length > 0;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span style="display:inline-flex;align-items:center;gap:6px;">
        <span class="q-link" onclick="openCP('${q.qid}')">${q.qn}</span>${q.spec?'<span style="font-size:9px;background:var(--amber-lt);color:var(--amber);padding:1px 5px;border-radius:3px;margin-left:4px;">specialist</span>':''}
        ${hasAlert ? '<span style="font-size:10px;color:var(--amber);margin-left:2px;" title="Forecast refresh recommended">⚠</span>' : ''}
      </span></td>
      <td class="mono">${WFM.fmtN(q.hc)}</td>
      <td class="mono">${WFM.fmtVol(q.vol)}</td>
      <td class="mono">${q.aht}s</td>
      <td class="mono">${fmtPct(q.shr)}</td>
      <td class="mono blue" style="font-weight:700;">${qFTE}</td>
      <td class="mono" style="color:${vc};font-weight:700;">${variance >= 0 ? '+' : ''}${variance}</td>
      <td class="mono" style="color:var(--green);">${q.xc > 0 ? '+'+q.xc : '—'}</td>
      <td><button style="font-size:9px;padding:3px 8px;border-radius:3px;border:1px solid var(--border);background:var(--card);color:var(--blue3);cursor:pointer;font-weight:600;font-family:var(--sans);white-space:nowrap;" onclick="openFDForPlan('${q.qid}')">View Forecast</button></td>
      <td><button style="font-size:9px;padding:3px 8px;border-radius:3px;border:1px solid var(--blue-lt);background:var(--blue-pale);color:var(--blue);cursor:pointer;font-weight:600;font-family:var(--sans);white-space:nowrap;" onclick="alert('Forecast refresh triggered for ${q.qn}. WatsonX model will retrain with latest actuals.\\n\\nThis feature will be available in production.')">Refresh Forecast</button></td>`;
    tbody.appendChild(tr);
  });

  // Totals row
  const totFTE = qs.reduce((s,q) => s + (q.erlang_fte || 0), 0);
  const totHC = qs.reduce((s,q) => s + q.hc, 0);
  const totVariance = totHC - totFTE;
  const totXc = qs.reduce((s,r)=>s+(r.xc||0),0);
  const totVol = qs.reduce((s,q) => s + q.vol, 0);
  const totR = document.createElement('tr');
  totR.style.cssText = 'font-weight:700;background:var(--blue-pale);';
  totR.innerHTML = `<td style="color:var(--blue);">Total</td><td class="mono">${WFM.fmtN(totHC)}</td><td class="mono">${WFM.fmtVol(totVol)}</td><td></td><td></td><td class="mono blue" style="font-weight:700;">${totFTE}</td><td class="mono" style="color:${totVariance>=0?'var(--green)':'var(--red)'};font-weight:700;">${totVariance>=0?'+':''}${totVariance}</td><td class="mono green">+${totXc}</td><td></td><td></td>`;
  tbody.appendChild(totR);
}

// ── PANEL 4 — STAFFING OPTIMIZATION ──────────────────────────────
function renderPanel4() {
  const cs = WFM.crossSkill;

  // KPI cards
  const kpiEl = document.getElementById('p4-kpi-row');
  if (kpiEl && kpiEl.children.length === 0) {
    const oct26qs = WFM.getQueuesForMonth(2026, 10);
    const octM = WFM.getMonth(2026, 10);
    const fteTotal = octM?.erlang_fte || 0;
    const totalHC = 2000;
    const variance = totalHC - fteTotal;
    const xcTotal = oct26qs.reduce((s,r)=>s+r.xc,0);

    const kpis = [
      { lbl:'Total HC', val:'2,000', sub:'End of Feb 2026', col:'var(--blue3)' },
      { lbl:'FTE requirement (Oct)', val:WFM.fmtN(fteTotal), sub:'Erlang C calculated demand', col:'var(--red)' },
      { lbl:'HC variance', val:(variance>=0?'+':'')+variance, sub:'HC minus FTE requirement', col: variance>=0?'var(--green)':'var(--red)' },
      { lbl:'X-skill capacity', val:'+'+xcTotal, sub:'Available at 85% efficiency', col:'var(--green)' },
    ];
    kpis.forEach(k => {
      kpiEl.innerHTML += `<div class="sf-card" style="min-width:150px;">
        <div class="sf-lbl">${k.lbl}</div>
        <div class="sf-val" style="color:${k.col};font-size:20px;">${k.val}</div>
        <div class="sf-sub">${k.sub}</div>
      </div>`;
    });
  }

  // Oct 26 staffing table
  const tbody = document.getElementById('p4-peak-tbody');
  if (tbody && tbody.children.length === 0) {
    const oct26qs = WFM.getQueuesForMonth(2026, 10);
    oct26qs.forEach(q => {
      const qFTE = q.erlang_fte || 0;
      const variance = q.hc - qFTE;
      const vc = variance >= 0 ? 'var(--green)' : 'var(--red)';
      const xst = q.xst.map(qid => `<span style="font-size:9px;padding:2px 6px;border-radius:3px;background:${qColor(qid)}20;color:${qColor(qid)};border:1px solid ${qColor(qid)}40;">${cs[qid]?.name}</span>`).join(' ') || '<span style="font-size:9px;color:var(--text3);">—</span>';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span style="display:inline-flex;align-items:center;gap:6px;"><span class="q-link" onclick="openCP('${q.qid}')">${q.qn}</span>${q.spec?'<span style="font-size:9px;background:var(--amber-lt);color:var(--amber);padding:1px 5px;border-radius:3px;">specialist</span>':''}</span></td>
        <td class="mono">${WFM.fmtN(q.hc)}</td>
        <td class="mono">${WFM.fmtVol(q.vol)}</td>
        <td class="mono">${q.aht}s</td>
        <td class="mono blue" style="font-weight:700;">${qFTE}</td>
        <td class="mono" style="color:${vc};font-weight:700;">${variance>=0?'+':''}${variance}</td>
        <td class="mono" style="color:var(--green);">${q.xc>0?'+'+q.xc:'—'}</td>
        <td style="min-width:120px;">${xst}</td>`;
      tbody.appendChild(tr);
    });
  }

  // Cross-skill grid
  const xgEl = document.getElementById('p4-xskill-grid');
  if (xgEl && xgEl.children.length === 0) {
    const clusters = [
      { name:'RB cluster', primary:'csrb', targets:[{t:'csrb_esc',e:70},{t:'csaa',e:80}] },
      { name:'Cards cluster (tri-flexible)', primary:'csaa', targets:[{t:'cscostco',e:85},{t:'csbc',e:85}] },
      { name:'CRS cluster (tri-flexible)', primary:'csthd', targets:[{t:'csbby',e:85},{t:'cssears',e:85}] },
      { name:'Specialist plans', primary:null, locked:['csrb_esc','csspa','cscan'] },
    ];
    clusters.forEach(cl => {
      let content = '';
      if (cl.locked) {
        content = cl.locked.map(qid => `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border-lt);">
          <span style="font-size:12px;color:var(--text2);flex:1;">${cs[qid]?.name}</span>
          <span style="font-size:9px;background:var(--amber-lt);color:var(--amber);padding:2px 7px;border-radius:3px;">locked</span>
        </div>`).join('');
      } else {
        content = cl.targets.map(({t,e}) => `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border-lt);">
          <span style="font-size:11px;color:var(--text3);">→</span>
          <span style="font-size:12px;color:var(--text2);flex:1;">${cs[t]?.name}</span>
          <span style="font-size:11px;font-family:var(--mono);color:var(--green);font-weight:700;">${e}%</span>
        </div>`).join('');
      }
      xgEl.innerHTML += `<div style="background:var(--bg);border-radius:6px;padding:12px 14px;">
        <div style="font-size:11px;font-weight:700;color:var(--blue);margin-bottom:8px;">${cl.name}</div>
        ${content}
      </div>`;
    });
  }

  // Hiring table
  const hiringTbody = document.getElementById('p4-hiring-tbody');
  if (hiringTbody && hiringTbody.children.length === 0) {
    const hiringPlan = [
      { q:'Q1 2026', peak:'Mar 2026', need:275, hcTarget:2080, attr:62, hires:142, start:'2 Feb 2026', lead:'6 weeks' },
      { q:'Q2 2026', peak:'Jun 2026', need:262, hcTarget:2090, attr:62, hires:72,  start:'1 Apr 2026', lead:'6 weeks' },
      { q:'Q3 2026', peak:'Oct 2026', need:320, hcTarget:2180, attr:65, hires:155, start:'1 Jul 2026', lead:'8 weeks' },
      { q:'Q4 2026', peak:'Dec 2026', need:298, hcTarget:2120, attr:60, hires:0,   start:'Attrition only', lead:'—' },
    ];
    hiringPlan.forEach(h => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-weight:600;color:var(--text);">${h.q}</td>
        <td class="mono">${h.peak}</td>
        <td class="mono blue" style="font-weight:700;">${h.need}</td>
        <td class="mono" style="color:var(--blue3);">${WFM.fmtN(h.hcTarget)}</td>
        <td class="mono red">−${h.attr}</td>
        <td class="mono green" style="font-weight:700;">+${h.hires}</td>
        <td class="mono">${h.start}</td>`;
      hiringTbody.appendChild(tr);
    });
  }
}

// ── CAPACITY PLAN OVERLAY (TM1-style with Actuals/Unadjusted/Adjustment views) ──
let cpCurrentQid = null;

// In-memory adjustment store: cpAdjustments[qid][year][month][metric] = number
const cpAdjustments = {};

function getCPAdj(qid, year, month, metric) {
  return cpAdjustments[qid]?.[year]?.[month]?.[metric] ?? 0;
}
function setCPAdj(qid, year, month, metric, value) {
  if (!cpAdjustments[qid]) cpAdjustments[qid] = {};
  if (!cpAdjustments[qid][year]) cpAdjustments[qid][year] = {};
  if (!cpAdjustments[qid][year][month]) cpAdjustments[qid][year][month] = {};
  if (value === 0 || value === '' || isNaN(value)) {
    delete cpAdjustments[qid][year][month][metric];
    // Clean up empty objects
    if (Object.keys(cpAdjustments[qid][year][month]).length === 0) delete cpAdjustments[qid][year][month];
    if (Object.keys(cpAdjustments[qid][year]).length === 0) delete cpAdjustments[qid][year];
    if (Object.keys(cpAdjustments[qid]).length === 0) delete cpAdjustments[qid];
  } else {
    cpAdjustments[qid][year][month][metric] = value;
  }
}

function countCPAdj(qid) {
  let count = 0;
  const qAdj = cpAdjustments[qid];
  if (!qAdj) return 0;
  Object.values(qAdj).forEach(yObj => Object.values(yObj).forEach(mObj => { count += Object.keys(mObj).length; }));
  return count;
}

function clearCPAdjustments() {
  const qid = cpCurrentQid;
  if (!qid) return;
  if (!confirm('Clear all adjustments for this plan?')) return;
  delete cpAdjustments[qid];
  renderCapPlan();
}

function openCP(qid) {
  cpCurrentQid = qid;
  const meta = ACTIVE_QUEUE_META[qid];
  const overlay = document.getElementById('cp-overlay');

  // Set header info
  document.getElementById('cp-q-name').textContent = meta?.name || qid;
  document.getElementById('cp-q-dot').style.background = meta?.color || '#003B70';
  document.getElementById('cp-q-spec').textContent = '';

  // Reset view to Actuals
  document.getElementById('cp-view-sel').value = 'actuals';

  // Determine queue index from ACTIVE_QIDS
  const qIdx = ACTIVE_QIDS.indexOf(qid) + 1;
  const synthKey = `${hierState.business}|${hierState.func}|${qIdx}`;
  const synthRecords = SYNTH_QUEUES[synthKey] || [];

  // Populate year selector from synth data
  const sel = document.getElementById('cp-year-sel');
  sel.innerHTML = '';
  const years = [...new Set(synthRecords.map(r => r.yr))].sort();
  years.forEach(y => {
    const opt = document.createElement('option');
    opt.value = y;
    opt.textContent = y;
    if (y === 2026) opt.selected = true;
    sel.appendChild(opt);
  });
  if (!years.includes(2026) && years.length > 0) sel.value = years[years.length - 1];

  overlay.classList.add('open');
  renderCapPlan();
}

function closeCP() {
  document.getElementById('cp-overlay').classList.remove('open');
}

function renderCapPlan() {
  const qid = cpCurrentQid;
  if (!qid) return;

  const year = parseInt(document.getElementById('cp-year-sel').value);
  const view = document.getElementById('cp-view-sel').value; // 'actuals' | 'unadjusted' | 'adjustment' | 'working'

  // Resolve queue index and synth key
  const qIdx = ACTIVE_QIDS.indexOf(qid) + 1;
  const synthKey = `${hierState.business}|${hierState.func}|${qIdx}`;
  const synthRecords = SYNTH_QUEUES[synthKey] || [];

  // Update badge
  const badge = document.getElementById('cp-view-badge');
  if (view === 'adjustment') {
    badge.className = 'cp-view-badge editable';
    badge.textContent = 'EDITABLE';
  } else if (view === 'working') {
    badge.className = 'cp-view-badge editable';
    badge.textContent = 'FORECAST EDITABLE';
  } else {
    badge.className = 'cp-view-badge readonly';
    badge.textContent = 'READ ONLY';
  }

  // Show upload button only for editable views
  const uploadBtn = document.getElementById('cp-upload-btn');
  if (uploadBtn) uploadBtn.style.display = (view === 'adjustment' || view === 'working') ? '' : 'none';

  // Update adj count / clear btn
  const adjCount = countCPAdj(qid);
  const adjCountEl = document.getElementById('cp-adj-count');
  const clearBtn = document.getElementById('cp-clear-adj-btn');
  if (adjCount > 0) {
    adjCountEl.style.display = '';
    adjCountEl.innerHTML = `${adjCount} adjustment${adjCount > 1 ? 's' : ''}<span class="cp-dirty-dot"></span>`;
    clearBtn.style.display = '';
  } else {
    adjCountEl.style.display = 'none';
    clearBtn.style.display = 'none';
  }

  // Get months for this queue in the selected year from synth data
  const allMonths = [];
  for (let m = 1; m <= 12; m++) {
    const rec = synthRecords.find(r => r.yr === year && r.mo === m);
    if (rec) {
      const qData = { ...rec, qid, qn: `Plan ${qIdx}` };
      const mData = { working_days: rec.working_days, vol: rec.vol, month_label: rec.ml };
      allMonths.push({ mo: m, q: qData, m: mData });
    }
  }

  // Filter: Actuals/Unadjusted/Adjustment show only actual months; Working shows all
  const months = (view === 'working')
    ? allMonths
    : allMonths.filter(({q}) => !q.fc);

  if (months.length === 0) {
    document.getElementById('cp-thead').innerHTML = '<tr><th colspan="13" style="text-align:center;color:var(--text3);">No data available for this year</th></tr>';
    document.getElementById('cp-tbody').innerHTML = '';
    return;
  }

  // Build header
  const moNames = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const thead = document.getElementById('cp-thead');
  thead.innerHTML = '<tr><th>Metric</th>' +
    months.map(({mo, q}) => `<th class="${q.fc ? 'cp-fc' : ''}">${moNames[mo]} ${year}<br><span style="font-size:8px;font-weight:400;color:${q.fc ? 'var(--blue3)' : 'var(--text3)'};letter-spacing:0;">${q.fc ? 'FCST' : 'ACT'}</span></th>`).join('') +
    '</tr>';

  // Define the metrics (key, label, accessor from queue data, format function)
  const metrics = [];
  function addMetric(key, label, fn, opts = {}) { metrics.push({ key, label, fn, ...opts }); }
  function addSection(label) { metrics.push({ section: label }); }

  // ── DEMAND DRIVERS ──
  addSection('Demand Drivers');
  const driverInfo = getCurrentDriver();
  addMetric('driver', driverInfo.name, (q,m) => getDriverCountForQueue(q), { fmt: v => WFM.fmtN(v), adjType: 'int', highlight: true });
  addMetric('contact_rate', 'Contact Rate', (q,m) => driverInfo.rate * 100, { fmt: v => v.toFixed(1) + '%', derived: true });
  addMetric('vol', 'Calls Received', (q,m) => q.vol, { fmt: v => WFM.fmtN(v), adjType: 'int' });
  addMetric('avg_daily_vol', 'Avg Daily Volume', (q,m) => Math.round(q.vol / m.working_days), { fmt: v => WFM.fmtN(v), derived: true });
  addMetric('aht', 'AHT (seconds)', (q,m) => q.aht, { fmt: v => v + 's', adjType: 'int' });
  addMetric('aht_min', 'AHT (minutes)', (q,m) => q.aht / 60, { fmt: v => v.toFixed(2), derived: true });
  addMetric('workload_hrs', 'Call Workload (hrs)', (q,m) => Math.round(q.vol * q.aht / 3600), { fmt: v => WFM.fmtN(v), derived: true });

  // ── OPERATIONAL PARAMETERS ──
  addSection('Operational Parameters');
  addMetric('shr', 'Shrinkage %', (q,m) => q.shr, { fmt: fmtPct, adjType: 'float' });
  addMetric('occ', 'Occupancy %', (q,m) => q.occ, { fmt: fmtPct, adjType: 'float' });
  addMetric('avail', 'Availability %', (q,m) => q.avail, { fmt: fmtPct, adjType: 'float' });
  addMetric('working_days', 'Working Days', (q,m) => m.working_days, { fmt: v => v, adjType: 'int' });

  // ── FTE REQUIREMENT ──
  addSection('FTE Requirement');
  addMetric('eff_fte_cp', 'FTE Requirement', (q,m) => q.erlang_fte || 0, { fmt: v => v, adjType: 'int', highlight: true });
  addMetric('hc_variance', 'HC Variance', (q,m) => q.hc - (q.erlang_fte || 0), { fmt: v => (v >= 0 ? '+' : '') + v, derived: true, colorFn: (v) => v >= 0 ? 'var(--green)' : 'var(--red)' });
  addMetric('xc', 'X-Skill Capacity', (q,m) => q.xc, { fmt: v => v > 0 ? '+' + v : '—', colorOverride: 'var(--green)', adjType: 'int' });

  // ── HEADCOUNT ──
  addSection('Headcount');
  addMetric('hc', 'Assigned HC', (q,m) => q.hc, { fmt: v => WFM.fmtN(v), adjType: 'int', highlight: true });
  addMetric('hc_pct', 'HC % of Total', (q,m) => q.hc / 2000 * 100, { fmt: fmtPct, derived: true });
  addMetric('vol_share', 'Volume Share %', (q,m) => q.vol / m.vol * 100, { fmt: fmtPct, derived: true });

  // ── DERIVED METRICS ──
  addSection('Derived Metrics');
  addMetric('calls_per_agent', 'Calls per Agent/Day', (q,m) => (q.vol / m.working_days) / q.hc, { fmt: v => v.toFixed(1), derived: true });
  addMetric('hc_util', 'HC Utilization %', (q,m) => q.pn / q.ps * 100, { fmt: fmtPct, derived: true });
  addMetric('eff_fte', 'Effective FTE', (q,m) => q.erlang_fte || 0, { fmt: v => v, derived: true });

  // Render table
  const tbody = document.getElementById('cp-tbody');
  tbody.innerHTML = '';

  metrics.forEach(metric => {
    const tr = document.createElement('tr');

    if (metric.section) {
      tr.className = 'cp-section-hdr';
      tr.innerHTML = `<td colspan="${months.length + 1}">${metric.section}</td>`;
      tbody.appendChild(tr);
      return;
    }

    if (metric.highlight) tr.className = 'cp-row-highlight';

    // Check if any adjustment exists for this metric in this row
    let rowHasAdj = false;
    months.forEach(({mo}) => {
      if (getCPAdj(qid, year, mo, metric.key) !== 0) rowHasAdj = true;
    });
    if (rowHasAdj && view === 'actuals') tr.classList.add('cp-has-adj');

    let html = `<td>${metric.label}</td>`;

    months.forEach(({mo, q, m}, i) => {
      const fc = q.fc;
      const baseVal = metric.fn(q, m);
      const adj = getCPAdj(qid, year, mo, metric.key);

      if (view === 'actuals') {
        // Show base + adjustment
        const totalVal = metric.derived ? baseVal : (typeof baseVal === 'number' ? baseVal + adj : baseVal);
        const display = metric.fmt(totalVal);
        let style = '';
        if (metric.colorFn) style = `color:${metric.colorFn(totalVal)};font-weight:600;`;
        else if (metric.colorOverride) style = `color:${metric.colorOverride};font-weight:600;`;
        if (adj !== 0 && !metric.derived) style += 'font-style:italic;';
        html += `<td class="${fc ? 'cp-fc' : 'cp-act'}" style="${style}">${display}${adj !== 0 && !metric.derived ? '<span class="cp-dirty-dot" title="Has adjustment"></span>' : ''}</td>`;

      } else if (view === 'unadjusted') {
        // Show original base data only
        const display = metric.fmt(baseVal);
        let style = '';
        if (metric.colorFn) style = `color:${metric.colorFn(baseVal)};font-weight:600;`;
        else if (metric.colorOverride) style = `color:${metric.colorOverride};font-weight:600;`;
        html += `<td class="${fc ? 'cp-fc' : 'cp-act'}" style="${style}">${display}</td>`;

      } else if (view === 'adjustment') {
        // Editable cells for non-derived metrics
        if (metric.derived) {
          html += `<td class="${fc ? 'cp-fc' : 'cp-act'}" style="color:var(--text3);">—</td>`;
        } else {
          const inputVal = adj !== 0 ? adj : '';
          const placeholder = '0';
          html += `<td class="cp-editable"><input type="number" value="${inputVal}" placeholder="${placeholder}" step="${metric.adjType === 'float' ? '0.1' : '1'}" onchange="onCPAdjChange('${qid}',${year},${mo},'${metric.key}',this.value,'${metric.adjType}')" /></td>`;
        }

      } else if (view === 'working') {
        // Working view: actuals are read-only (with adjustments applied), forecast cells are editable
        if (fc) {
          // Forecast month — editable for non-derived metrics
          if (metric.derived) {
            const display = metric.fmt(baseVal);
            let style = 'color:var(--text3);';
            if (metric.colorFn) style = `color:${metric.colorFn(baseVal)};font-weight:600;`;
            html += `<td class="cp-fc" style="${style}">${display}</td>`;
          } else {
            const totalVal = typeof baseVal === 'number' ? baseVal + adj : baseVal;
            const inputVal = adj !== 0 ? adj : '';
            html += `<td class="cp-editable" style="background:var(--blue-pale);"><input type="number" value="${inputVal}" placeholder="${metric.fmt(baseVal)}" step="${metric.adjType === 'float' ? '0.1' : '1'}" onchange="onCPAdjChange('${qid}',${year},${mo},'${metric.key}',this.value,'${metric.adjType}')" style="background:var(--blue-pale);" /></td>`;
          }
        } else {
          // Actual month — read-only, show base + adjustment (same as Actuals view)
          const totalVal = metric.derived ? baseVal : (typeof baseVal === 'number' ? baseVal + adj : baseVal);
          const display = metric.fmt(totalVal);
          let style = '';
          if (metric.colorFn) style = `color:${metric.colorFn(totalVal)};font-weight:600;`;
          else if (metric.colorOverride) style = `color:${metric.colorOverride};font-weight:600;`;
          if (adj !== 0 && !metric.derived) style += 'font-style:italic;';
          html += `<td class="cp-act" style="${style}">${display}${adj !== 0 && !metric.derived ? '<span class="cp-dirty-dot" title="Has adjustment"></span>' : ''}</td>`;
        }
      }
    });

    tr.innerHTML = html;
    tbody.appendChild(tr);
  });
}

function onCPAdjChange(qid, year, month, metric, rawValue, adjType) {
  let val = adjType === 'float' ? parseFloat(rawValue) : parseInt(rawValue);
  if (isNaN(val)) val = 0;
  setCPAdj(qid, year, month, metric, val);
  // Update the adjustment count display without full re-render (for responsiveness)
  const adjCount = countCPAdj(qid);
  const adjCountEl = document.getElementById('cp-adj-count');
  const clearBtn = document.getElementById('cp-clear-adj-btn');
  if (adjCount > 0) {
    adjCountEl.style.display = '';
    adjCountEl.innerHTML = `${adjCount} adjustment${adjCount > 1 ? 's' : ''}<span class="cp-dirty-dot"></span>`;
    clearBtn.style.display = '';
  } else {
    adjCountEl.style.display = 'none';
    clearBtn.style.display = 'none';
  }
}

// ── INIT — RENDER PANEL 3 ON LOAD (it's the default active) ───────
function initLTModule() {
  initHierarchy();
  buildActiveQueues();
  ltSelectedQueues = new Set(ACTIVE_QIDS);
  buildLTQFList();
  updateHierLabels();
  ltStep(1);
}

// ── FORECAST DETAIL ────────────────────────────────────────────
let fdChartInst = null;

// Queue filter state — all selected by default
const ALL_QIDS = ['csrb','csrb_esc','csaa','cscostco','csbc','csthd','csbby','cssears','csspa','cscan'];
let fdSelectedQueues = new Set(ALL_QIDS);

function openFD() {
  fdSelectedQueues = new Set(ALL_QIDS);
  buildQFList();
  updateQFLabel();
  document.getElementById('fd-overlay').classList.add('open');
  renderFDTab1();
  buildFdChart();
}

// Open FD overlay scoped to a specific plan
let fdCurrentPlanQid = null;
// ── FORECAST VINTAGE HELPERS ──────────────────────────────────
function getVintageKey(qid) {
  const qIdx = ACTIVE_QIDS.indexOf(qid) + 1;
  return `${hierState.business}|${hierState.func}|${qIdx}`;
}

function getVintageData(qid, vintage) {
  // vintage: 'aug25' | 'dec25' | 'feb26' | 'mar26'
  const key = getVintageKey(qid);
  return FORECAST_VINTAGES[key]?.[vintage] || [];
}

function getVintageAgg(vintage, qids, year, month) {
  // Aggregate vintage data for multiple qids for a specific month
  let totalVol = 0, totalAhtW = 0, totalShr = 0, totalOcc = 0, totalAvail = 0, totalFte = 0, count = 0;
  qids.forEach(qid => {
    const data = getVintageData(qid, vintage);
    const rec = data.find(r => r.yr === year && r.mo === month);
    if (rec) {
      totalVol += rec.vol;
      totalAhtW += rec.aht * rec.vol;
      totalShr += rec.shr;
      totalOcc += rec.occ;
      totalAvail += rec.avail;
      totalFte += rec.erlang_fte;
      count++;
    }
  });
  if (count === 0) return null;
  return { vol: totalVol, aht: Math.round(totalAhtW / (totalVol || 1)), shr: totalShr / count, occ: totalOcc / count, avail: totalAvail / count, erlang_fte: totalFte };
}

function getInitiativesForPlan(qid) {
  const qIdx = ACTIVE_QIDS.indexOf(qid) + 1;
  return STRATEGIC_INITIATIVES.filter(i => i.biz === hierState.business && i.func === hierState.func && i.plans.includes(qIdx));
}

function openFDForPlan(qid) {
  fdCurrentPlanQid = qid;
  const meta = ACTIVE_QUEUE_META[qid];
  // Select only this plan in the FD queue filter
  fdSelectedQueues = new Set([qid]);
  buildQFList();
  updateQFLabel();
  // Update the FD bar subtitle with the plan name
  const fdCtx = document.getElementById('fd-bar-ctx');
  if (fdCtx) fdCtx.textContent = `${hierState.business} · ${hierState.func.toUpperCase()} · ${(meta?.name || qid).toUpperCase()} · LT FORECAST`;
  document.getElementById('fd-overlay').classList.add('open');
  renderFDTab1();
  buildFdChart();
}
function closeFD() {
  document.getElementById('fd-overlay').classList.remove('open');
  closeQF();
}

function fdTab(n) {
  [1,2,3,4,5].forEach(i => {
    document.getElementById('fdt-' + i).classList.remove('active');
    document.getElementById('fdp-' + i).classList.remove('active');
  });
  document.getElementById('fdt-' + n).classList.add('active');
  document.getElementById('fdp-' + n).classList.add('active');
  if (n === 1) { renderFDTab1(); buildFdChart(); }
  if (n === 3) { renderFDTab3(); }
  if (n === 4) { initModelMethodology(); }
  if (n === 5) { renderModelHealth(); }
}

// ── QUEUE FILTER DROPDOWN ──
function buildQFList() {
  const list = document.getElementById('qf-list');
  if (!list) return;
  list.innerHTML = '';
  ALL_QIDS.forEach(qid => {
    const cs = WFM.crossSkill[qid];
    const checked = fdSelectedQueues.has(qid);
    const div = document.createElement('div');
    div.className = 'qf-item' + (checked ? ' checked' : '');
    div.dataset.qid = qid;
    div.onclick = () => toggleQFItem(qid);
    div.innerHTML = `
      <div class="qf-check"></div>
      <div class="qf-dot" style="background:${qColor(qid)};"></div>
      <span class="qf-name">${cs?.name || qid}</span>
      ${cs?.specialist ? '<span class="qf-spec">specialist</span>' : ''}`;
    list.appendChild(div);
  });
}

function toggleQF() {
  const dd = document.getElementById('qf-dropdown');
  const btn = document.getElementById('qf-btn');
  const isOpen = dd.classList.contains('open');
  dd.classList.toggle('open', !isOpen);
  btn.classList.toggle('open', !isOpen);
  if (!isOpen) {
    // Close on outside click
    setTimeout(() => document.addEventListener('click', closeQFOutside), 0);
  }
}
function closeQF() {
  document.getElementById('qf-dropdown')?.classList.remove('open');
  document.getElementById('qf-btn')?.classList.remove('open');
  document.removeEventListener('click', closeQFOutside);
}
function closeQFOutside(e) {
  const wrap = document.getElementById('qf-wrap');
  if (wrap && !wrap.contains(e.target)) closeQF();
}

function toggleQFItem(qid) {
  if (fdSelectedQueues.has(qid)) {
    fdSelectedQueues.delete(qid);
  } else {
    fdSelectedQueues.add(qid);
  }
  // Update checkbox visual
  const items = document.querySelectorAll('#qf-list .qf-item');
  items.forEach(el => {
    el.classList.toggle('checked', fdSelectedQueues.has(el.dataset.qid));
  });
  updateQFLabel();
  onQFChange();
}

function qfSelectAll() {
  ALL_QIDS.forEach(qid => fdSelectedQueues.add(qid));
  document.querySelectorAll('#qf-list .qf-item').forEach(el => el.classList.add('checked'));
  updateQFLabel();
  onQFChange();
}
function qfSelectNone() {
  fdSelectedQueues.clear();
  document.querySelectorAll('#qf-list .qf-item').forEach(el => el.classList.remove('checked'));
  updateQFLabel();
  onQFChange();
}

function updateQFLabel() {
  const lbl = document.getElementById('qf-label');
  if (!lbl) return;
  const n = fdSelectedQueues.size;
  if (n === ALL_QIDS.length) {
    lbl.textContent = 'All (' + n + ')';
  } else if (n === 0) {
    lbl.textContent = 'None';
  } else if (n === 1) {
    const qid = [...fdSelectedQueues][0];
    lbl.textContent = WFM.crossSkill[qid]?.name || qid;
  } else {
    lbl.textContent = n + ' of ' + ALL_QIDS.length;
  }
}

function onQFChange() {
  const activeTab = [1,2,3,4,5].find(n => document.getElementById('fdt-'+n)?.classList.contains('active')) || 1;
  if (activeTab === 1) { renderFDTab1(); buildFdChart(); }
}

// ── FD TAB 1 — Dynamic rendering based on queue filter ──
// ── INITIATIVES REPOSITORY ─────────────────────────────────────
function openInitRepo() {
  const body = document.getElementById('init-repo-body');
  if (!body) return;

  const colorMap = {
    red: { bg: 'var(--red-lt)', fg: 'var(--red)', border: '#F5C6C2' },
    amber: { bg: 'var(--amber-lt)', fg: 'var(--amber)', border: '#F5D9A8' },
    green: { bg: 'var(--green-lt)', fg: 'var(--green)', border: '#B8DECA' }
  };

  body.innerHTML = STRATEGIC_INITIATIVES.map(init => {
    const c = colorMap[init.typeColor] || colorMap.amber;
    const fteColor = init.fteDelta > 0 ? 'var(--red)' : 'var(--green)';
    const fteSign = init.fteDelta > 0 ? '+' : '';
    const planNames = init.plans.map(p => 'Plan ' + p).join(', ');
    const confColor = init.confidence === 'High' ? 'var(--green)' : init.confidence === 'Medium' ? 'var(--amber)' : 'var(--red)';

    return '<div style="border:1px solid ' + c.border + ';border-radius:8px;padding:14px 16px;margin-bottom:12px;background:var(--card);">' +
      '<div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:10px;">' +
        '<div style="padding:3px 10px;border-radius:4px;font-size:10px;font-weight:700;background:' + c.bg + ';color:' + c.fg + ';white-space:nowrap;">' + init.type + '</div>' +
        '<div style="flex:1;">' +
          '<div style="font-size:13px;font-weight:700;color:var(--text);">' + init.name + '</div>' +
          '<div style="font-size:11px;color:var(--text3);margin-top:2px;">' + init.desc + '</div>' +
        '</div>' +
        '<div style="font-size:16px;font-weight:700;color:' + fteColor + ';white-space:nowrap;font-family:var(--mono);">' + fteSign + init.fteDelta + ' FTE</div>' +
      '</div>' +
      '<div style="display:flex;gap:16px;flex-wrap:wrap;">' +
        '<div style="font-size:10px;color:var(--text3);"><strong style="color:var(--text2);">Business:</strong> ' + init.biz + '</div>' +
        '<div style="font-size:10px;color:var(--text3);"><strong style="color:var(--text2);">Function:</strong> ' + init.func + '</div>' +
        '<div style="font-size:10px;color:var(--text3);"><strong style="color:var(--text2);">Plans:</strong> ' + planNames + '</div>' +
        '<div style="font-size:10px;color:var(--text3);"><strong style="color:var(--text2);">Confidence:</strong> <span style="color:' + confColor + ';font-weight:600;">' + init.confidence + '</span></div>' +
      '</div>' +
    '</div>';
  }).join('');

  document.getElementById('init-repo-overlay').style.display = '';
}

function closeInitRepo() {
  document.getElementById('init-repo-overlay').style.display = 'none';
}

function renderFDTab3() {
  const listEl = document.getElementById('fd-adj-list');
  if (!listEl) return;

  const selQids = [...fdSelectedQueues];
  // Get initiatives for all selected plans
  const seen = new Set();
  const initiatives = [];
  selQids.forEach(qid => {
    getInitiativesForPlan(qid).forEach(init => {
      if (!seen.has(init.id)) {
        seen.add(init.id);
        initiatives.push(init);
      }
    });
  });

  if (initiatives.length === 0) {
    listEl.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text3);font-size:12px;">No active adjustments for this plan.</div>';
    return;
  }

  const colorMap = { red: { bg: 'var(--red-lt)', fg: 'var(--red)' }, amber: { bg: 'var(--amber-lt)', fg: 'var(--amber)' }, green: { bg: 'var(--green-lt)', fg: 'var(--green)' } };

  listEl.innerHTML = initiatives.map(init => {
    const c = colorMap[init.typeColor] || colorMap.amber;
    const fteColor = init.fteDelta > 0 ? 'var(--red)' : 'var(--green)';
    const fteSign = init.fteDelta > 0 ? '+' : '';
    // Show which plans are affected
    const planNames = init.plans.map(p => 'Plan ' + p).join(', ');
    return `<div class="adj-item">
      <div class="adj-tag" style="background:${c.bg};color:${c.fg};">${init.type}</div>
      <div style="flex:1;">
        <div class="adj-name">${init.name}</div>
        <div class="adj-sub">${init.desc}</div>
        <div style="font-size:9px;color:var(--text3);margin-top:2px;">Affects: ${planNames}</div>
      </div>
      <div class="adj-val" style="color:${fteColor};">${fteSign}${init.fteDelta} FTE</div>
      <div class="adj-del" onclick="this.closest('.adj-item').style.display='none'">✕</div>
    </div>`;
  }).join('');
}

function renderFDTab1() {
  const mcards = document.querySelector('#fdp-1 .fd-mcards');
  if (!mcards) return;

  const selQids = [...fdSelectedQueues];
  const fcOrder = [[2026,3],[2026,4],[2026,5],[2026,6],[2026,7],[2026,8],[2026,9],[2026,10],[2026,11],[2026,12],[2027,1],[2027,2]];

  // Helper: aggregate a vintage across months for selected plans
  function aggVintage(vintage) {
    let tVol=0, tAht=0, tShr=0, tAvail=0, mc=0, peakFte=0;
    fcOrder.forEach(([y,m]) => {
      const agg = getVintageAgg(vintage, selQids, y, m);
      if (!agg) return;
      tVol += agg.vol; tAht += agg.aht; tShr += agg.shr; tAvail += agg.avail; mc++;
      if (agg.erlang_fte > peakFte) peakFte = agg.erlang_fte;
    });
    return {
      avgVol: mc > 0 ? Math.round(tVol/mc) : 0,
      avgAht: mc > 0 ? Math.round(tAht/mc) : 0,
      avgShr: mc > 0 ? (tShr/mc).toFixed(1) : '0.0',
      avgAvail: mc > 0 ? (tAvail/mc).toFixed(1) : '0.0',
      peakFte
    };
  }

  const plan = aggVintage('aug25');  // Plan = Aug 2025 vintage
  const fyf = aggVintage('feb26');   // Last FYF = Feb 2026 vintage
  const cur = aggVintage('mar26');   // Current = Mar 2026 vintage

  // Get initiatives affecting selected plans
  const seen = new Set();
  const inits = [];
  selQids.forEach(qid => {
    getInitiativesForPlan(qid).forEach(init => {
      if (!seen.has(init.id)) { seen.add(init.id); inits.push(init); }
    });
  });
  const volInits = inits.filter(i => i.type === 'Volume' || i.type === 'Deflection');
  const ahtInits = inits.filter(i => i.type === 'AHT');

  const volDelta = fyf.avgVol > 0 ? ((cur.avgVol - fyf.avgVol) / fyf.avgVol * 100).toFixed(1) : '0.0';
  const ahtDelta = fyf.avgAht > 0 ? ((cur.avgAht - fyf.avgAht) / fyf.avgAht * 100).toFixed(1) : '0.0';
  const shrDelta = (parseFloat(cur.avgShr) - parseFloat(fyf.avgShr)).toFixed(1);
  const availDelta = (parseFloat(cur.avgAvail) - parseFloat(fyf.avgAvail)).toFixed(1);
  const fteDelta = cur.peakFte - fyf.peakFte;

  // Plan deltas
  const volPlanDelta = plan.avgVol > 0 ? ((cur.avgVol - plan.avgVol) / plan.avgVol * 100).toFixed(1) : '0.0';
  const ahtPlanDelta = plan.avgAht > 0 ? ((cur.avgAht - plan.avgAht) / plan.avgAht * 100).toFixed(1) : '0.0';
  const shrPlanDelta = (parseFloat(cur.avgShr) - parseFloat(plan.avgShr)).toFixed(1);
  const availPlanDelta = (parseFloat(cur.avgAvail) - parseFloat(plan.avgAvail)).toFixed(1);
  const ftePlanDelta = cur.peakFte - plan.peakFte;

  // Build insight text for each variable
  function buildInsight(varName, fyfPct, planPct, relevantInits) {
    const lines = [];
    const absFyf = Math.abs(parseFloat(fyfPct));
    const absPlan = Math.abs(parseFloat(planPct));
    const fyfDir = parseFloat(fyfPct) > 0 ? 'higher' : parseFloat(fyfPct) < 0 ? 'lower' : 'unchanged';
    const planDir = parseFloat(planPct) > 0 ? 'higher' : parseFloat(planPct) < 0 ? 'lower' : 'unchanged';
    const unit = (varName === 'Shrinkage' || varName === 'Availability') ? 'pp' : '%';

    // FYF comparison
    if (absFyf < 1) {
      lines.push('<span style="color:var(--green);">●</span> <strong>vs Last FYF:</strong> Minimal change — forecast largely stable since Feb 2026 cycle');
    } else {
      const fyfColor = fyfDir === 'higher' ? 'var(--red)' : 'var(--green)';
      lines.push('<span style="color:' + fyfColor + ';">●</span> <strong>vs Last FYF:</strong> ' + absFyf + unit + ' ' + fyfDir + ' than Feb 2026 forecast');
    }

    // Plan comparison
    if (absPlan < 1) {
      lines.push('<span style="color:var(--green);">●</span> <strong>vs Plan:</strong> Tracking close to Aug 2025 plan — no material deviation');
    } else {
      let reason = '';
      if (relevantInits.length > 0) {
        reason = ' — driven by: ' + relevantInits.map(i => i.name).join('; ');
      } else {
        reason = varName === 'Shrinkage' ? ' — seasonal workforce patterns' : varName === 'Availability' ? ' — operational adjustments' : ' — organic trend shift';
      }
      const isGood = (varName === 'Availability') ? (planDir === 'higher') : (planDir === 'lower');
      const planColor = isGood ? 'var(--green)' : 'var(--red)';
      lines.push('<span style="color:' + planColor + ';">●</span> <strong>vs Plan:</strong> ' + absPlan + unit + ' ' + planDir + ' than Aug 2025 plan' + reason);
    }

    return lines.join('<br>');
  }

  const volInsight = buildInsight('Volume', volDelta, volPlanDelta, volInits);
  const ahtInsight = buildInsight('AHT', ahtDelta, ahtPlanDelta, ahtInits);
  const shrInsight = buildInsight('Shrinkage', shrDelta, shrPlanDelta, []);
  const availInsight = buildInsight('Availability', availDelta, availPlanDelta, []);

  // FTE insight is composite
  const fteLines = [];
  if (Math.abs(fteDelta) <= 1) {
    fteLines.push(`<span style="color:var(--green);">●</span> <strong>vs Last FYF:</strong> FTE demand stable — no significant change since Feb 2026`);
  } else {
    fteLines.push(`<span style="color:${fteDelta>0?'var(--red)':'var(--green)'};">●</span> <strong>vs Last FYF:</strong> ${fteDelta>0?'+':''}${fteDelta} FTE — ${Math.abs(parseFloat(volDelta))>1?'volume change':'AHT/operational shifts'} driving the difference`);
  }
  if (Math.abs(ftePlanDelta) <= 1) {
    fteLines.push(`<span style="color:var(--green);">●</span> <strong>vs Plan:</strong> On track with Aug 2025 plan`);
  } else {
    const drivers = [...volInits, ...ahtInits];
    const reason = drivers.length > 0 ? ' — initiatives: ' + drivers.map(i=>i.name).join('; ') : ' — cumulative forecast adjustments';
    fteLines.push(`<span style="color:${ftePlanDelta>0?'var(--red)':'var(--green)'};">●</span> <strong>vs Plan:</strong> ${ftePlanDelta>0?'+':''}${ftePlanDelta} FTE from Aug 2025 plan${reason}`);
  }
  const fteInsight = fteLines.join('<br>');

  const insightStyle = 'font-size:11px;color:var(--text2);line-height:1.7;padding:8px 10px;background:var(--bg);border-radius:4px;border-left:3px solid var(--border);margin-top:6px;';

  mcards.innerHTML = `
    <div class="fd-mc ${parseFloat(volDelta)>0?'worse':'better'}"><div class="fd-mc-name">Call volume (monthly avg)</div><div class="fd-mc-row"><div class="fd-mc-col"><div class="fd-mc-lbl">Last FYF</div><div class="fd-mc-val old">${WFM.fmtN(fyf.avgVol)}</div></div><div class="fd-mc-col"><div class="fd-mc-lbl">Current</div><div class="fd-mc-val" style="color:${parseFloat(volDelta)>0?'var(--red)':'var(--green)'}">${WFM.fmtN(cur.avgVol)}</div></div><div class="fd-mc-delta ${parseFloat(volDelta)>0?'up':'dn'}">${parseFloat(volDelta)>0?'+':''}${volDelta}%</div></div><div style="${insightStyle}">${volInsight}</div></div>
    <div class="fd-mc ${parseFloat(ahtDelta)>0?'worse':'better'}"><div class="fd-mc-name">AHT — avg handle time</div><div class="fd-mc-row"><div class="fd-mc-col"><div class="fd-mc-lbl">Last FYF</div><div class="fd-mc-val old">${fyf.avgAht}s</div></div><div class="fd-mc-col"><div class="fd-mc-lbl">Current</div><div class="fd-mc-val" style="color:${parseFloat(ahtDelta)>0?'var(--red)':'var(--green)'}">${cur.avgAht}s</div></div><div class="fd-mc-delta ${parseFloat(ahtDelta)>0?'up':'dn'}">${parseFloat(ahtDelta)>0?'+':''}${ahtDelta}%</div></div><div style="${insightStyle}">${ahtInsight}</div></div>
    <div class="fd-mc ${parseFloat(shrDelta)<0?'better':'worse'}"><div class="fd-mc-name">Shrinkage %</div><div class="fd-mc-row"><div class="fd-mc-col"><div class="fd-mc-lbl">Last FYF</div><div class="fd-mc-val old">${fyf.avgShr}%</div></div><div class="fd-mc-col"><div class="fd-mc-lbl">Current</div><div class="fd-mc-val" style="color:${parseFloat(shrDelta)<0?'var(--green)':'var(--red)'}">${cur.avgShr}%</div></div><div class="fd-mc-delta ${parseFloat(shrDelta)<0?'dn':'up'}">${parseFloat(shrDelta)>0?'+':''}${shrDelta}pp</div></div><div style="${insightStyle}">${shrInsight}</div></div>
    <div class="fd-mc ${parseFloat(availDelta)>0?'better':'worse'}"><div class="fd-mc-name">Availability %</div><div class="fd-mc-row"><div class="fd-mc-col"><div class="fd-mc-lbl">Last FYF</div><div class="fd-mc-val old">${fyf.avgAvail}%</div></div><div class="fd-mc-col"><div class="fd-mc-lbl">Current</div><div class="fd-mc-val" style="color:${parseFloat(availDelta)>0?'var(--green)':'var(--red)'}">${cur.avgAvail}%</div></div><div class="fd-mc-delta ${parseFloat(availDelta)>0?'dn':'up'}">${parseFloat(availDelta)>0?'+':''}${availDelta}pp</div></div><div style="${insightStyle}">${availInsight}</div></div>
    <div class="fd-mc ${fteDelta>0?'worse':'better'}"><div class="fd-mc-name">FTE demand (highest month)</div><div class="fd-mc-row"><div class="fd-mc-col"><div class="fd-mc-lbl">Last FYF</div><div class="fd-mc-val old">${WFM.fmtN(fyf.peakFte)}</div></div><div class="fd-mc-col"><div class="fd-mc-lbl">Current</div><div class="fd-mc-val" style="color:${fteDelta>0?'var(--red)':'var(--green)'}">${WFM.fmtN(cur.peakFte)}</div></div><div class="fd-mc-delta ${fteDelta>0?'up':'dn'}">${fteDelta>0?'+':''}${fteDelta} FTE</div></div><div style="${insightStyle}">${fteInsight}</div></div>`;
}

function buildFdChart() {
  const ctx = document.getElementById('fd-fte-chart');
  if (!ctx) return;
  if (fdChartInst) { fdChartInst.destroy(); fdChartInst = null; }

  const selQids = [...fdSelectedQueues];
  const months = ['Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb'];
  const fcOrder = [[2026,3],[2026,4],[2026,5],[2026,6],[2026,7],[2026,8],[2026,9],[2026,10],[2026,11],[2026,12],[2027,1],[2027,2]];

  // Last FYF (Feb 2026 vintage) FTE per month
  const fyf = fcOrder.map(([y,m]) => {
    const agg = getVintageAgg('feb26', selQids, y, m);
    return agg ? agg.erlang_fte : 0;
  });

  // Current (Mar 2026 vintage) FTE per month
  const curr = fcOrder.map(([y,m]) => {
    const agg = getVintageAgg('mar26', selQids, y, m);
    return agg ? agg.erlang_fte : 0;
  });

  const allVals = [...fyf, ...curr].filter(v => v > 0);
  const minVal = allVals.length > 0 ? Math.max(0, Math.floor(Math.min(...allVals) * 0.85)) : 0;

  fdChartInst = new Chart(ctx, {
    data: {
      labels: months,
      datasets: [
        { type:'bar',  label:'Last FYF', data:fyf,  backgroundColor:'rgba(0,59,112,.08)', borderColor:'rgba(0,59,112,.2)', borderWidth:1, borderRadius:2 },
        { type:'line', label:'Current',  data:curr, borderColor:'var(--blue3)', backgroundColor:'transparent', borderWidth:2, pointRadius:3, pointBackgroundColor:'var(--blue3)', tension:.35 },
      ]
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false}, tooltip:{ backgroundColor:'#002952', bodyColor:'#fff', padding:8, callbacks:{ label:c=>` ${c.dataset.label}: ${c.raw?.toLocaleString()}` } } },
      scales:{
        x:{ ticks:{color:'#8898AA',font:{size:10}}, grid:{color:'rgba(0,0,0,.04)'} },
        y:{ min:minVal, ticks:{color:'#8898AA',font:{size:10}}, grid:{color:'rgba(0,0,0,.04)'} }
      }
    }
  });
}

// ── MODEL HEALTH & APPROVAL — per-queue (Tab 4) ──────────────────
// Per-queue approval state: 'pending' or 'approved'
const queueApprovalState = {};
ALL_QIDS.forEach(qid => { queueApprovalState[qid] = 'pending'; });

// AHT model health per queue (synthetic but consistent with methodology)
const AHT_MODEL_HEALTH = {
  csrb:     { mape: 93.8, bias: +0.8, drift: -0.6 },
  csrb_esc: { mape: 91.5, bias: +1.2, drift: -0.8 },
  csaa:     { mape: 94.2, bias: -0.5, drift: -0.3 },
  cscostco: { mape: 93.0, bias: +0.6, drift: -0.9 },
  csbc:     { mape: 90.8, bias: -1.8, drift: -1.2 },
  csthd:    { mape: 95.1, bias: +0.2, drift: -0.2 },
  csbby:    { mape: 94.5, bias: +0.4, drift: -0.4 },
  cssears:  { mape: 92.3, bias: +1.0, drift: +0.3 },
  csspa:    { mape: 94.8, bias: -0.3, drift: -0.2 },
  cscan:    { mape: 95.6, bias: +0.1, drift: -0.1 },
};

let mhCurrentQid = null;

function renderModelHealth() {
  // Render summary chips + progress
  const approvedCount = ALL_QIDS.filter(qid => queueApprovalState[qid] === 'approved').length;
  const pct = Math.round(approvedCount / ALL_QIDS.length * 100);

  document.getElementById('qa-progress-label').textContent = `${approvedCount} / ${ALL_QIDS.length} approved`;
  document.getElementById('qa-progress-fill').style.width = pct + '%';

  // If no queue selected yet, default to first
  if (!mhCurrentQid) mhCurrentQid = ALL_QIDS[0];

  const summaryEl = document.getElementById('qa-summary');
  summaryEl.innerHTML = ALL_QIDS.map(qid => {
    const cs = WFM.crossSkill[qid];
    const state = queueApprovalState[qid];
    const isActive = qid === mhCurrentQid;
    return `<div class="qa-chip ${state} ${isActive ? 'active' : ''}" onclick="mhSelectQueue('${qid}')">
      <div class="qa-chip-dot"></div>
      <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${qColor(qid)};"></span>
      ${cs?.name}
      <span style="font-size:8px;">${state === 'approved' ? '✓' : '⏳'}</span>
    </div>`;
  }).join('');

  renderMHContent();
}

function mhSelectQueue(qid) {
  mhCurrentQid = qid;
  renderModelHealth();
}

function renderMHContent() {
  const qid = mhCurrentQid;
  const mm = MODEL_METHODOLOGY[qid];
  const ahtH = AHT_MODEL_HEALTH[qid];
  const cs = WFM.crossSkill[qid];
  const state = queueApprovalState[qid];
  if (!mm || !cs) return;

  const acc = mm.accuracy;
  const accColor = (v) => v >= 92 ? 'var(--green)' : v >= 90 ? 'var(--amber)' : 'var(--red)';
  const biasColor = (v) => Math.abs(v) <= 1.5 ? 'var(--green)' : Math.abs(v) <= 3 ? 'var(--amber)' : 'var(--red)';
  const volStatus = acc.mape_3m >= 92 ? 'green' : acc.mape_3m >= 90 ? 'amber' : 'red';
  const volLabel = acc.mape_3m >= 92 ? 'Healthy' : acc.mape_3m >= 90 ? 'Needs review' : 'Below threshold';
  const ahtStatus = ahtH.mape >= 92 ? 'green' : ahtH.mape >= 90 ? 'amber' : 'red';
  const ahtLabel = ahtH.mape >= 92 ? 'Healthy' : ahtH.mape >= 90 ? 'Needs review' : 'Below threshold';
  const hasFlag = acc.mape_3m < 90 || Math.abs(acc.bias) > 2.5;

  // Plan-level forecast KPIs
  const octQs = WFM.getQueueMonth(qid, 2026, 10);
  const peakNeed = octQs ? octQs.pn : 0;
  const scheduled = octQs ? octQs.ps : 0;

  const content = document.getElementById('mh-content');
  content.innerHTML = `
    <div class="dp-sec">Model health — ${cs.name}</div>
    <div class="model-card">
      <div class="model-hdr"><div class="model-name">Volume forecast model — ${mm.model_type}</div><div class="dp-status ${volStatus}"><div class="dp-status-dot"></div>${volLabel}</div></div>
      <div class="mh-row"><div class="mh-label">3-month MAPE</div><div class="mh-bar"><div class="mh-fill" style="width:${acc.mape_3m}%;background:${accColor(acc.mape_3m)};"></div></div><div class="mh-val" style="color:${accColor(acc.mape_3m)};">${acc.mape_3m}%</div></div>
      <div class="mh-row"><div class="mh-label">6-month MAPE</div><div class="mh-bar"><div class="mh-fill" style="width:${acc.mape_6m}%;background:${accColor(acc.mape_6m)};"></div></div><div class="mh-val" style="color:${accColor(acc.mape_6m)};">${acc.mape_6m}%</div></div>
      <div class="mh-row"><div class="mh-label">Systematic bias</div><div class="mh-bar"><div class="mh-fill" style="width:${Math.min(Math.abs(acc.bias)*10,100)}%;background:${biasColor(acc.bias)};"></div></div><div class="mh-val" style="color:${biasColor(acc.bias)};">${acc.bias > 0 ? '+' : ''}${acc.bias}%</div></div>
      <div class="mh-row"><div class="mh-label">Drift vs last refresh</div><div class="mh-bar"><div class="mh-fill" style="width:${Math.min(Math.abs(acc.drift)*15,100)}%;background:${biasColor(acc.drift)};"></div></div><div class="mh-val" style="color:${biasColor(acc.drift)};">${acc.drift > 0 ? '+' : ''}${acc.drift}pp</div></div>
      ${hasFlag ? `<div class="model-flag"><div style="color:var(--red);font-size:14px;flex-shrink:0;margin-top:1px;">⚠</div><div class="model-flag-text"><strong>Model recalibration recommended.</strong> ${mm.notes}<div><span class="model-flag-action" onclick="alert('Recalibration request sent to data science team for ${cs.name}')">→ Request model recalibration</span></div></div></div>` : ''}
    </div>
    <div class="model-card">
      <div class="model-hdr"><div class="model-name">AHT forecast model — ${mm.aht_model}</div><div class="dp-status ${ahtStatus}"><div class="dp-status-dot"></div>${ahtLabel}</div></div>
      <div class="mh-row"><div class="mh-label">3-month MAPE</div><div class="mh-bar"><div class="mh-fill" style="width:${ahtH.mape}%;background:${accColor(ahtH.mape)};"></div></div><div class="mh-val" style="color:${accColor(ahtH.mape)};">${ahtH.mape}%</div></div>
      <div class="mh-row"><div class="mh-label">Bias</div><div class="mh-bar"><div class="mh-fill" style="width:${Math.min(Math.abs(ahtH.bias)*10,100)}%;background:${biasColor(ahtH.bias)};"></div></div><div class="mh-val" style="color:${biasColor(ahtH.bias)};">${ahtH.bias > 0 ? '+' : ''}${ahtH.bias}%</div></div>
      <div class="mh-row"><div class="mh-label">Drift</div><div class="mh-bar"><div class="mh-fill" style="width:${Math.min(Math.abs(ahtH.drift)*15,100)}%;background:${biasColor(ahtH.drift)};"></div></div><div class="mh-val" style="color:${biasColor(ahtH.drift)};">${ahtH.drift > 0 ? '+' : ''}${ahtH.drift}pp</div></div>
    </div>

    <div style="margin:12px 0 6px;"><button class="lt-btn ghost" style="font-size:11px;" onclick="viewMethodologyForQueue('${qid}')">→ View full model methodology for ${cs.name}</button></div>

    <div class="dp-sec" style="margin-top:16px;">Approve forecast — ${cs.name}</div>
    <div class="approval">
      <div class="approval-title">Approve ${cs.name} demand forecast — FY2025–26</div>
      <div class="approval-sub">Once approved, the ${cs.name} forecast will be locked. Approve each plan individually based on model health and your confidence in the numbers.</div>
      <div class="approval-kpis">
        <div class="approval-kpi"><div class="approval-kpi-val">${peakNeed}</div><div class="approval-kpi-lbl">Peak need (Oct)</div></div>
        <div class="approval-kpi"><div class="approval-kpi-val">${scheduled}</div><div class="approval-kpi-lbl">Scheduled</div></div>
        <div class="approval-kpi"><div class="approval-kpi-val" style="color:${accColor(acc.mape_3m)};">${acc.mape_3m}%</div><div class="approval-kpi-lbl">Vol MAPE</div></div>
        <div class="approval-kpi"><div class="approval-kpi-val" style="color:${accColor(ahtH.mape)};">${ahtH.mape}%</div><div class="approval-kpi-lbl">AHT MAPE</div></div>
      </div>
      <div class="checklist">
        <div class="check">✅ February actuals confirmed and loaded</div>
        <div class="check">✅ HC reconciliation complete for ${cs.name}</div>
        ${hasFlag ? `<div class="check warn">⚠️ Volume model below 90% threshold — review recommended</div>` : `<div class="check">✅ Volume model healthy — above 90% threshold</div>`}
        ${ahtH.mape >= 90 ? `<div class="check">✅ AHT model healthy — no action required</div>` : `<div class="check warn">⚠️ AHT model needs attention</div>`}
      </div>
      <div class="approval-btns">
        ${state === 'approved'
          ? `<button class="btn-draft" onclick="unapproveQueue('${qid}')" style="background:var(--green-lt);color:var(--green);border-color:#B8DECA;">✓ Approved — click to revoke</button>`
          : `<button class="btn-approve" onclick="approveQueue('${qid}')">✓ Approve ${cs.name} forecast</button>`}
        <button class="btn-revise" onclick="fdTab(3)">⟵ Revise adjustments</button>
        <button class="btn-draft" onclick="alert('Draft saved for ${cs.name}')">Save draft</button>
      </div>
    </div>

    ${state === 'approved' ? `<div style="margin-top:12px;padding:10px 14px;background:var(--green-lt);border:1px solid #B8DECA;border-radius:6px;display:flex;align-items:center;gap:8px;"><span style="font-size:16px;">✅</span><span style="font-size:12px;color:var(--green);font-weight:600;">${cs.name} forecast approved and locked</span></div>` : ''}`;
}

function approveQueue(qid) {
  queueApprovalState[qid] = 'approved';
  renderModelHealth();
  checkAllApproved();
}

function unapproveQueue(qid) {
  queueApprovalState[qid] = 'pending';
  renderModelHealth();
}

function checkAllApproved() {
  const allApproved = ALL_QIDS.every(qid => queueApprovalState[qid] === 'approved');
  if (allApproved) {
    setTimeout(() => {
      if (confirm('All 10 plans are now approved. Would you like to lock the full forecast and proceed to Staffing Optimization?')) {
        approveForecast();
      }
    }, 300);
  }
}

function viewMethodologyForQueue(qid) {
  // Switch to Tab 5 and select the queue
  fdTab(5);
  document.getElementById('mm-q-sel').value = qid;
  renderModelMethodology();
}

function viewHealthForQueue(qid) {
  // Switch to Tab 4 and select the queue
  mhCurrentQid = qid;
  fdTab(4);
}

// ── MODEL METHODOLOGY — WatsonX forecast model details per queue ──
const MODEL_METHODOLOGY = {
  csrb: {
    model_type: 'Gradient Boosted Trees (XGBoost)',
    engine: 'IBM WatsonX.ai · AutoAI pipeline',
    target_variable: 'Monthly inbound call volume',
    training_window: 'Mar 2021 – Feb 2026 (60 months)',
    refresh_cadence: 'Monthly — auto-retrain on latest actuals',
    horizon: '12 months forward (Mar 2026 – Feb 2027)',
    granularity: 'Monthly, plan-level',
    features: [
      { name: 'Lagged volume (t-1, t-2, t-3, t-12)', category: 'Autoregressive' },
      { name: 'Month-of-year seasonality index', category: 'Seasonal' },
      { name: 'Active account count (from CRM)', category: 'Business driver' },
      { name: 'Marketing campaign flag', category: 'Business driver' },
      { name: 'Working days in month', category: 'Calendar' },
      { name: 'Holiday indicator (US federal)', category: 'Calendar' },
      { name: 'YoY volume growth rate', category: 'Trend' },
      { name: 'Digital channel deflection rate', category: 'Channel mix' },
    ],
    aht_model: 'Linear regression with ARIMA residuals',
    aht_features: ['Historical AHT trend', 'Agent tenure mix', 'Product complexity index', 'Regulatory change flag'],
    accuracy: { mape_3m: 88.6, mape_6m: 91.4, bias: -3.2, drift: -2.8 },
    notes: 'Volume model flagged for recalibration — 3-month MAPE dropped below 90% threshold. Systematic under-forecasting bias of 3.2% detected. Recommend retraining with Q4 2025 actuals before next cycle lock.'
  },
  csrb_esc: {
    model_type: 'SARIMAX (1,1,1)(1,1,1,12)',
    engine: 'IBM WatsonX.ai · Time Series pipeline',
    target_variable: 'Monthly escalation call volume',
    training_window: 'Mar 2021 – Feb 2026 (60 months)',
    refresh_cadence: 'Monthly — auto-retrain on latest actuals',
    horizon: '12 months forward',
    granularity: 'Monthly, plan-level',
    features: [
      { name: 'Parent plan (Plan 1) volume ratio', category: 'Dependency' },
      { name: 'Escalation rate (trailing 3-month avg)', category: 'Autoregressive' },
      { name: 'CSAT score trend', category: 'Quality' },
      { name: 'Agent experience level mix', category: 'Workforce' },
      { name: 'Seasonal decomposition (STL)', category: 'Seasonal' },
    ],
    aht_model: 'Weighted moving average with trend adjustment',
    aht_features: ['Case complexity index', 'Regulatory change flag', 'Avg hold time trend'],
    accuracy: { mape_3m: 91.2, mape_6m: 93.1, bias: +1.4, drift: -0.9 },
    notes: 'Specialist plan — escalation rate tightly coupled with Plan 1 volume. Model performance stable.'
  },
  csaa: {
    model_type: 'Prophet with external regressors',
    engine: 'IBM WatsonX.ai · AutoAI pipeline',
    target_variable: 'Monthly inbound call volume',
    training_window: 'Mar 2021 – Feb 2026 (60 months)',
    refresh_cadence: 'Monthly — auto-retrain on latest actuals',
    horizon: '12 months forward',
    granularity: 'Monthly, plan-level',
    features: [
      { name: 'Lagged volume (t-1, t-3, t-12)', category: 'Autoregressive' },
      { name: 'Credit card active accounts', category: 'Business driver' },
      { name: 'New card issuance rate', category: 'Business driver' },
      { name: 'Statement cycle concentration', category: 'Calendar' },
      { name: 'Month-of-year + week-of-month effects', category: 'Seasonal' },
      { name: 'IVR containment rate', category: 'Channel mix' },
    ],
    aht_model: 'Bayesian structural time series',
    aht_features: ['Product mix complexity', 'First-call resolution rate', 'Training cohort ramp curve'],
    accuracy: { mape_3m: 92.3, mape_6m: 94.0, bias: -1.1, drift: -0.5 },
    notes: 'Model healthy. Cards AA volume closely tracks new card issuance — ensure CRM feed is refreshed before each cycle.'
  },
  cscostco: {
    model_type: 'LightGBM ensemble',
    engine: 'IBM WatsonX.ai · AutoAI pipeline',
    target_variable: 'Monthly inbound call volume',
    training_window: 'Mar 2021 – Feb 2026 (60 months)',
    refresh_cadence: 'Monthly — auto-retrain on latest actuals',
    horizon: '12 months forward',
    granularity: 'Monthly, plan-level',
    features: [
      { name: 'Lagged volume (t-1, t-2, t-12)', category: 'Autoregressive' },
      { name: 'Costco membership renewal cycle', category: 'Business driver' },
      { name: 'Promotional event calendar', category: 'Business driver' },
      { name: 'Holiday shopping season index', category: 'Seasonal' },
      { name: 'Working days in month', category: 'Calendar' },
      { name: 'Costco store count (quarterly)', category: 'External' },
    ],
    aht_model: 'Linear regression with seasonal dummies',
    aht_features: ['Rewards enquiry mix', 'Agent tenure', 'System latency index'],
    accuracy: { mape_3m: 90.8, mape_6m: 92.5, bias: -0.6, drift: -1.2 },
    notes: 'Strong seasonal spike in Nov–Dec tied to holiday shopping. Model captures Costco-specific promotional calendar well.'
  },
  csbc: {
    model_type: 'Gradient Boosted Trees (XGBoost)',
    engine: 'IBM WatsonX.ai · AutoAI pipeline',
    target_variable: 'Monthly inbound call volume',
    training_window: 'Mar 2021 – Feb 2026 (60 months)',
    refresh_cadence: 'Monthly — auto-retrain on latest actuals',
    horizon: '12 months forward',
    granularity: 'Monthly, plan-level',
    features: [
      { name: 'Lagged volume (t-1, t-2, t-6, t-12)', category: 'Autoregressive' },
      { name: 'Branded card portfolio size', category: 'Business driver' },
      { name: 'Partner retailer promotional calendar', category: 'Business driver' },
      { name: 'Seasonal index (multiplicative)', category: 'Seasonal' },
      { name: 'Mobile app adoption rate', category: 'Channel mix' },
    ],
    aht_model: 'ARIMA(2,1,1) with exogenous variables',
    aht_features: ['Dispute complexity trend', 'Agent skill tier distribution', 'Hold time ratio'],
    accuracy: { mape_3m: 89.4, mape_6m: 91.8, bias: -2.5, drift: -1.8 },
    notes: 'AHT trending upward due to increased dispute complexity from regulatory changes. Volume model accuracy slightly below target.'
  },
  csthd: {
    model_type: 'Prophet with changepoint detection',
    engine: 'IBM WatsonX.ai · Time Series pipeline',
    target_variable: 'Monthly inbound call volume',
    training_window: 'Mar 2021 – Feb 2026 (60 months)',
    refresh_cadence: 'Monthly — auto-retrain on latest actuals',
    horizon: '12 months forward',
    granularity: 'Monthly, plan-level',
    features: [
      { name: 'Lagged volume (t-1, t-12)', category: 'Autoregressive' },
      { name: 'THD retail sales index', category: 'Business driver' },
      { name: 'Home improvement seasonal cycle', category: 'Seasonal' },
      { name: 'Working days in month', category: 'Calendar' },
      { name: 'Digital self-service adoption', category: 'Channel mix' },
    ],
    aht_model: 'Exponential smoothing (ETS)',
    aht_features: ['Product return rate', 'Financing enquiry mix', 'System performance index'],
    accuracy: { mape_3m: 93.1, mape_6m: 94.7, bias: +0.4, drift: -0.3 },
    notes: 'Strong seasonal pattern — spring/summer peak aligned with home improvement season. Model performing well.'
  },
  csbby: {
    model_type: 'SARIMAX with Fourier terms',
    engine: 'IBM WatsonX.ai · Time Series pipeline',
    target_variable: 'Monthly inbound call volume',
    training_window: 'Mar 2021 – Feb 2026 (60 months)',
    refresh_cadence: 'Monthly — auto-retrain on latest actuals',
    horizon: '12 months forward',
    granularity: 'Monthly, plan-level',
    features: [
      { name: 'Lagged volume (t-1, t-2, t-12)', category: 'Autoregressive' },
      { name: 'BBY product launch calendar', category: 'Business driver' },
      { name: 'Consumer electronics seasonal index', category: 'Seasonal' },
      { name: 'Black Friday / holiday intensity', category: 'Seasonal' },
      { name: 'Extended warranty claim rate', category: 'Business driver' },
    ],
    aht_model: 'Random forest regression',
    aht_features: ['Technical complexity score', 'Product category mix', 'Agent certification level'],
    accuracy: { mape_3m: 91.7, mape_6m: 93.4, bias: +0.9, drift: -0.6 },
    notes: 'Volume strongly driven by product launch cycles and holiday electronics season. Nov–Dec spike captured well by Fourier seasonal terms.'
  },
  cssears: {
    model_type: 'Exponential Smoothing (ETS AAA)',
    engine: 'IBM WatsonX.ai · Time Series pipeline',
    target_variable: 'Monthly inbound call volume',
    training_window: 'Mar 2022 – Feb 2026 (48 months)',
    refresh_cadence: 'Monthly — auto-retrain on latest actuals',
    horizon: '12 months forward',
    granularity: 'Monthly, plan-level',
    features: [
      { name: 'Triple exponential smoothing components', category: 'Autoregressive' },
      { name: 'Seasonal multiplicative factor', category: 'Seasonal' },
      { name: 'Portfolio runoff rate', category: 'Business driver' },
      { name: 'Working days in month', category: 'Calendar' },
    ],
    aht_model: 'Simple moving average (6-month window)',
    aht_features: ['Legacy system lookup time', 'Agent familiarity score'],
    accuracy: { mape_3m: 90.2, mape_6m: 92.0, bias: +1.8, drift: +0.4 },
    notes: 'Declining portfolio — volume trending down. Shorter training window used (48 months) to better capture recent decline trajectory.'
  },
  csspa: {
    model_type: 'Bilingual Prophet + language mix model',
    engine: 'IBM WatsonX.ai · AutoAI pipeline',
    target_variable: 'Monthly Spanish-language call volume',
    training_window: 'Mar 2021 – Feb 2026 (60 months)',
    refresh_cadence: 'Monthly — auto-retrain on latest actuals',
    horizon: '12 months forward',
    granularity: 'Monthly, plan-level',
    features: [
      { name: 'Lagged volume (t-1, t-3, t-12)', category: 'Autoregressive' },
      { name: 'Spanish-preference customer base size', category: 'Business driver' },
      { name: 'IVR language selection ratio', category: 'Channel mix' },
      { name: 'Regional demographic growth index', category: 'External' },
      { name: 'Seasonal pattern (remittance cycles)', category: 'Seasonal' },
    ],
    aht_model: 'Linear regression with language complexity adjustment',
    aht_features: ['Bilingual agent availability', 'Translation overhead factor', 'Call type mix'],
    accuracy: { mape_3m: 92.6, mape_6m: 94.2, bias: -0.7, drift: -0.4 },
    notes: 'Specialist plan — no cross-skill overflow. Volume driven by growing Spanish-preference customer base. Model stable and accurate.'
  },
  cscan: {
    model_type: 'Random Forest + ARIMA hybrid',
    engine: 'IBM WatsonX.ai · AutoAI pipeline',
    target_variable: 'Monthly Canadian customer call volume',
    training_window: 'Mar 2021 – Feb 2026 (60 months)',
    refresh_cadence: 'Monthly — auto-retrain on latest actuals',
    horizon: '12 months forward',
    granularity: 'Monthly, plan-level',
    features: [
      { name: 'Lagged volume (t-1, t-2, t-12)', category: 'Autoregressive' },
      { name: 'Canadian card portfolio size', category: 'Business driver' },
      { name: 'CAD/USD exchange rate (monthly avg)', category: 'External' },
      { name: 'Canadian statutory holidays', category: 'Calendar' },
      { name: 'Seasonal index (Canadian retail cycle)', category: 'Seasonal' },
      { name: 'Cross-border transaction volume', category: 'Business driver' },
    ],
    aht_model: 'Bayesian ridge regression',
    aht_features: ['Regulatory compliance requirements (PIPEDA)', 'Bilingual call handling ratio (EN/FR)', 'Currency dispute rate'],
    accuracy: { mape_3m: 93.8, mape_6m: 95.1, bias: +0.3, drift: -0.2 },
    notes: 'Specialist plan — Canadian regulatory and currency factors well captured. Highest accuracy across all plan models.'
  }
};

let mmInitialized = false;

// ── FORECAST CHANGE RATIONALE PER VARIABLE ────────────────────
function getPlanAlerts(qid) {
  const SEASONAL = [0, 1.12, 0.95, 1.02, 0.98, 0.94, 0.88, 0.86, 0.90, 0.96, 1.10, 1.08, 1.05];
  const ACC_THRESHOLD = 90;
  const VOL_DEV_THRESHOLD = 15;
  const AHT_DEV_THRESHOLD = 10;
  const DRIVER_CHG_THRESHOLD = 10;

  const qIdx = ACTIVE_QIDS.indexOf(qid) + 1;
  const key = hierState.business + '|' + hierState.func + '|' + qIdx;
  const records = SYNTH_QUEUES[key];
  if (!records) return { variables: [], types: [] };

  const feb26 = records.find(r => r.yr === 2026 && r.mo === 2);
  const jan26 = records.find(r => r.yr === 2026 && r.mo === 1);
  const nov25 = records.find(r => r.yr === 2025 && r.mo === 11);

  const alertVars = new Set();
  const alertTypes = new Set();

  // Type 1: Actuals deviation
  if (feb26 && jan26) {
    const volChg = jan26.vol > 0 ? Math.abs(feb26.vol - jan26.vol) / jan26.vol * 100 : 0;
    if (volChg > VOL_DEV_THRESHOLD) { alertVars.add('Volume'); alertTypes.add('actuals_vol'); }
    const ahtChg = jan26.aht > 0 ? Math.abs(feb26.aht - jan26.aht) / jan26.aht * 100 : 0;
    if (ahtChg > AHT_DEV_THRESHOLD) { alertVars.add('AHT'); alertTypes.add('actuals_aht'); }
  }

  // Type 2: Driver forecast change
  const vintageKey = key;
  const curV = FORECAST_VINTAGES[vintageKey]?.mar26;
  const planV = FORECAST_VINTAGES[vintageKey]?.aug25;
  if (curV && planV && curV.length > 0 && planV.length > 0) {
    const curAvg = curV.reduce(function(s,r){ return s+r.vol; }, 0) / curV.length;
    const planAvg = planV.reduce(function(s,r){ return s+r.vol; }, 0) / planV.length;
    const drvChg = planAvg > 0 ? Math.abs(curAvg - planAvg) / planAvg * 100 : 0;
    if (drvChg > DRIVER_CHG_THRESHOLD) { alertVars.add('Volume'); alertTypes.add('driver'); }
  }

  // Type 3: Low T-3 accuracy
  if (feb26 && nov25) {
    var checks = [
      { name: 'Volume', actual: feb26.vol, forecast: Math.round(nov25.vol * SEASONAL[2] / (SEASONAL[11] || 1)) },
      { name: 'AHT', actual: feb26.aht, forecast: nov25.aht },
      { name: 'Availability', actual: feb26.avail, forecast: nov25.avail },
      { name: 'Occupancy', actual: feb26.occ, forecast: nov25.occ },
    ];
    checks.forEach(function(v) {
      var mape = v.actual > 0 ? Math.abs(v.actual - v.forecast) / v.actual * 100 : 0;
      if ((100 - mape) < ACC_THRESHOLD) { alertVars.add(v.name); alertTypes.add('accuracy_' + v.name.toLowerCase()); }
    });
  }

  return { variables: [...alertVars], types: [...alertTypes] };
}

// Pre-defined rationale explanations per variable per initiative context
const RATIONALE_TEMPLATES = {
  'Volume': {
    'Deflection': 'Volume forecast decreased for {period} due to "{init}" initiative. Deflection impact confirmed through 2+ months of actuals showing sustained volume reduction. Driver forecast remains stable — volume change is initiative-driven.',
    'Volume_up': 'Volume forecast increased for {period} due to "{init}" initiative. Driver forecast for {driver} has also increased, compounding the uplift. Recommend monitoring for 1 more month to confirm trend.',
    'accuracy': 'Volume forecast refreshed because T-3 accuracy dropped below 90%. Recent actuals show volume trending {dir} compared to prior forecast. Driver ({driver}) forecast has {driverChange} — model retrained with latest 3 months of actuals.',
    'default': 'Volume forecast adjusted based on latest actuals trend. No specific initiative driving the change — organic shift observed over last 2 months.'
  },
  'AHT': {
    'AHT': 'AHT forecast increased from {period} due to "{init}". Handle time has been consistently elevated since the initiative rollout. Wrap time component accounts for most of the increase. Model recalibrated.',
    'accuracy': 'AHT forecast refreshed because T-3 accuracy fell below threshold. Actuals show AHT trending {dir} — likely driven by changing call mix complexity. Model retrained with updated features.',
    'default': 'AHT forecast marginally adjusted based on recent trend. No significant driver change identified.'
  },
  'Availability': {
    'accuracy': 'Availability forecast decreased through Dec 2026 because it has been trending down for last 3 months. Seasonal workforce patterns and increased unplanned leave driving the reduction. HR confirmed no policy changes.',
    'default': 'Availability forecast remains stable. Minor seasonal adjustments applied — no structural change.'
  },
  'Occupancy': {
    'accuracy': 'Occupancy forecast adjusted based on observed trend. Higher-than-expected occupancy in recent months suggests tighter staffing. Monitoring for agent burnout risk.',
    'default': 'Occupancy forecast unchanged — tracking within normal range.'
  }
};

function buildForecastRationale(qid) {
  const alertInfo = getPlanAlerts(qid);
  const alertVars = alertInfo.variables;
  const alertTypes = alertInfo.types;
  const inits = getInitiativesForPlan(qid);
  const driverInfo = getCurrentDriver();
  const hasAlerts = alertVars.length > 0;

  const variables = ['Volume', 'AHT', 'Availability', 'Occupancy'];

  const cards = variables.map(function(varName) {
    var rationale = '';
    var borderColor = 'var(--green)';
    var icon = '✅';

    if (!hasAlerts) {
      rationale = 'Forecast not changed because no major deviations were observed and accuracy remains good.';
      return buildRationaleCard(varName, icon, borderColor, rationale);
    }

    var varHasAlert = alertVars.includes(varName);
    var relevantInits = inits.filter(function(i) {
      if (varName === 'Volume') return i.type === 'Volume' || i.type === 'Deflection';
      if (varName === 'AHT') return i.type === 'AHT';
      return false;
    });

    // Check which specific trigger types apply to this variable
    var hasActualsDev = (varName === 'Volume' && alertTypes.includes('actuals_vol')) || (varName === 'AHT' && alertTypes.includes('actuals_aht'));
    var hasDriverChg = varName === 'Volume' && alertTypes.includes('driver');
    var hasLowAcc = alertTypes.includes('accuracy_' + varName.toLowerCase());

    if (!varHasAlert && relevantInits.length === 0) {
      rationale = 'Forecast not changed for this variable — no deviations observed, accuracy within range, and no initiative impact.';
      return buildRationaleCard(varName, '✅', 'var(--green)', rationale);
    }

    var parts = [];

    // Initiative-driven
    if (relevantInits.length > 0) {
      var init = relevantInits[0];
      if (init.type === 'Deflection') {
        parts.push('🔄 <strong>Initiative impact:</strong> Forecast adjusted due to "' + init.name + '". Deflection impact confirmed through 2+ months of actuals showing sustained reduction.');
      } else if (init.type === 'Volume') {
        parts.push('🔄 <strong>Initiative impact:</strong> Forecast increased due to "' + init.name + '". Volume uplift observed in recent actuals, aligning with initiative projections.');
      } else if (init.type === 'AHT') {
        parts.push('🔄 <strong>Initiative impact:</strong> Forecast adjusted due to "' + init.name + '". Handle time consistently elevated since initiative rollout — wrap time component accounts for most of the increase.');
      }
      icon = '🔄'; borderColor = 'var(--amber)';
    }

    // Actuals deviation
    if (hasActualsDev) {
      if (varName === 'Volume') {
        parts.push('📊 <strong>Actuals deviation:</strong> Feb 2026 volume deviated significantly from Jan 2026. If this trend persists for 1–2 more months, a model retrain is recommended. Currently monitoring.');
      } else if (varName === 'AHT') {
        parts.push('📊 <strong>Actuals deviation:</strong> Feb 2026 AHT showed a sharp shift from Jan. Could be a seasonal effect or process change — monitoring next month before adjusting forecast.');
      }
      icon = '⚠️'; borderColor = 'var(--amber)';
    }

    // Driver forecast change
    if (hasDriverChg) {
      parts.push('🔀 <strong>Driver forecast change:</strong> ' + driverInfo.name + ' forecast has shifted significantly from the Aug 2025 plan. Since volume = drivers × contact rate, this implies a volume forecast adjustment is needed.');
      icon = '🔀'; borderColor = 'var(--amber)';
    }

    // Low T-3 accuracy
    if (hasLowAcc) {
      if (varName === 'Volume') {
        parts.push('📉 <strong>Low T-3 accuracy:</strong> Volume forecast accuracy fell below 90%. Model retrained with latest 3 months of actuals. ' + driverInfo.name + ' trend incorporated into updated forecast.');
      } else if (varName === 'AHT') {
        parts.push('📉 <strong>Low T-3 accuracy:</strong> AHT forecast accuracy below threshold. Likely driven by changing call mix complexity. Model recalibrated with recent data.');
      } else if (varName === 'Availability') {
        parts.push('📉 <strong>Low T-3 accuracy:</strong> Availability trending below forecast for 3 consecutive months. Adjusted downward through Dec 2026 to reflect persistent pattern. HR confirmed no policy changes.');
      } else if (varName === 'Occupancy') {
        parts.push('📉 <strong>Low T-3 accuracy:</strong> Occupancy tracking higher than forecasted. Tighter staffing in recent months driving the deviation. Adjusted upward — monitoring for agent burnout risk.');
      }
      icon = '📉'; borderColor = 'var(--amber)';
    }

    if (parts.length === 0) {
      rationale = 'Forecast not changed for this variable — no specific trigger detected.';
      return buildRationaleCard(varName, '✅', 'var(--green)', rationale);
    }

    rationale = parts.join('<br><br>');
    return buildRationaleCard(varName, icon, borderColor, rationale);
  }).join('');

  return '<div class="mm-card full" style="border-top-color:' + (hasAlerts ? 'var(--amber)' : 'var(--green)') + ';">' +
    '<div class="mm-card-title">Forecast change rationale — this cycle</div>' +
    '<div class="mm-card-sub">WHY THE FORECAST CHANGED (OR DIDN\'T)</div>' +
    '<div style="margin-top:8px;">' + cards + '</div>' +
  '</div>';
}

function buildRationaleCard(varName, icon, borderColor, rationale) {
  return '<div style="padding:10px 12px;background:var(--bg);border-radius:4px;border-left:3px solid ' + borderColor + ';margin-bottom:8px;">' +
    '<div style="font-size:11px;font-weight:700;color:var(--text);margin-bottom:4px;">' + icon + ' ' + varName + '</div>' +
    '<div style="font-size:11px;color:var(--text2);line-height:1.6;">' + rationale + '</div>' +
  '</div>';
}

function initModelMethodology() {
  // Set the hidden dropdown to the current plan and update label
  const sel = document.getElementById('mm-q-sel');
  const label = document.getElementById('mm-plan-label');
  if (fdCurrentPlanQid) {
    sel.innerHTML = '';
    const opt = document.createElement('option');
    opt.value = fdCurrentPlanQid;
    sel.appendChild(opt);
    sel.value = fdCurrentPlanQid;
    const meta = ACTIVE_QUEUE_META[fdCurrentPlanQid];
    if (label) label.textContent = meta?.name || fdCurrentPlanQid;
  }
  renderModelMethodology();
}

function renderModelMethodology() {
  const qid = document.getElementById('mm-q-sel').value;
  
  // Map the new-style qid to an old MODEL_METHODOLOGY key using plan index
  const qIdx = ACTIVE_QIDS.indexOf(qid);
  const oldQids = ['csrb','csrb_esc','csaa','cscostco','csbc','csthd','csbby','cssears','csspa','cscan'];
  const mappedQid = oldQids[qIdx % oldQids.length] || oldQids[0];
  
  const mm = MODEL_METHODOLOGY[mappedQid];
  const meta = ACTIVE_QUEUE_META[qid];
  if (!mm) return;

  const planName = meta?.name || qid;
  document.getElementById('mm-q-sub').textContent =
    `${hierState.business} · ${hierState.func} · ${hierState.qtype}`;

  const accColor = (v) => v >= 92 ? 'var(--green)' : v >= 90 ? 'var(--amber)' : 'var(--red)';
  const biasColor = (v) => Math.abs(v) <= 1.5 ? 'var(--green)' : Math.abs(v) <= 3 ? 'var(--amber)' : 'var(--red)';
  const catColor = (c) => {
    if (c === 'Autoregressive') return 'blue';
    if (c === 'Seasonal') return 'amber';
    if (c === 'Business driver') return 'green';
    if (c === 'Calendar') return 'grey';
    if (c === 'Channel mix') return 'red';
    if (c === 'External') return 'grey';
    if (c === 'Dependency') return 'blue';
    if (c === 'Quality') return 'amber';
    if (c === 'Workforce') return 'green';
    if (c === 'Trend') return 'blue';
    return 'grey';
  };

  const content = document.getElementById('mm-content');
  content.innerHTML = `
    <!-- Forecast Change Rationale (top priority) -->
    ${buildForecastRationale(qid)}

    <!-- Model overview -->
    <div class="mm-card accent-blue">
      <div class="mm-card-title">Volume forecast model</div>
      <div class="mm-card-sub">PRIMARY MODEL · ${planName}</div>
      <div class="mm-field"><div class="mm-label">Model type</div><div class="mm-value">${mm.model_type}</div></div>
      <div class="mm-field"><div class="mm-label">Engine</div><div class="mm-value">${mm.engine}</div></div>
      <div class="mm-field"><div class="mm-label">Target variable</div><div class="mm-value">${mm.target_variable}</div></div>
      <div class="mm-field"><div class="mm-label">Forecast horizon</div><div class="mm-value">${mm.horizon}</div></div>
      <div class="mm-field"><div class="mm-label">Granularity</div><div class="mm-value">${mm.granularity}</div></div>
    </div>

    <!-- Training config -->
    <div class="mm-card accent-green">
      <div class="mm-card-title">Training configuration</div>
      <div class="mm-card-sub">DATA PIPELINE · REFRESH SCHEDULE</div>
      <div class="mm-field"><div class="mm-label">Training window</div><div class="mm-value">${mm.training_window}</div></div>
      <div class="mm-field"><div class="mm-label">Refresh cadence</div><div class="mm-value">${mm.refresh_cadence}</div></div>
      <div class="mm-field"><div class="mm-label">Last retrained</div><div class="mm-value">Mar 2026 cycle (on Feb 2026 actuals)</div></div>
      <div class="mm-field"><div class="mm-label">Next scheduled</div><div class="mm-value">Apr 2026 cycle</div></div>
    </div>

    <!-- Input features — volume -->
    <div class="mm-card accent-blue full">
      <div class="mm-card-title">Input features — volume model</div>
      <div class="mm-card-sub">${mm.features.length} FEATURES</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;">
        ${mm.features.map(f => `<div style="flex:1;min-width:220px;display:flex;align-items:flex-start;gap:8px;padding:6px 0;border-bottom:1px solid var(--border-lt);">
          <span class="mm-tag ${catColor(f.category)}">${f.category}</span>
          <span style="font-size:11px;color:var(--text2);line-height:1.5;">${f.name}</span>
        </div>`).join('')}
      </div>
    </div>

    <!-- AHT model -->
    <div class="mm-card accent-amber">
      <div class="mm-card-title">AHT forecast model</div>
      <div class="mm-card-sub">SECONDARY MODEL</div>
      <div class="mm-field"><div class="mm-label">Model type</div><div class="mm-value">${mm.aht_model}</div></div>
      <div class="mm-field"><div class="mm-label">Input features</div><div class="mm-value">${mm.aht_features.map(f => `<span class="mm-tag grey">${f}</span>`).join(' ')}</div></div>
    </div>

    <!-- Accuracy -->
    <div class="mm-card accent-green">
      <div class="mm-card-title">Model performance</div>
      <div class="mm-card-sub">ACCURACY METRICS · LAST EVALUATION</div>
      <div class="mm-perf-row">
        <div class="mm-perf-label">3-month MAPE</div>
        <div class="mm-perf-bar"><div class="mm-perf-fill" style="width:${mm.accuracy.mape_3m}%;background:${accColor(mm.accuracy.mape_3m)};"></div></div>
        <div class="mm-perf-val" style="color:${accColor(mm.accuracy.mape_3m)};">${mm.accuracy.mape_3m}%</div>
      </div>
      <div class="mm-perf-row">
        <div class="mm-perf-label">6-month MAPE</div>
        <div class="mm-perf-bar"><div class="mm-perf-fill" style="width:${mm.accuracy.mape_6m}%;background:${accColor(mm.accuracy.mape_6m)};"></div></div>
        <div class="mm-perf-val" style="color:${accColor(mm.accuracy.mape_6m)};">${mm.accuracy.mape_6m}%</div>
      </div>
      <div class="mm-perf-row">
        <div class="mm-perf-label">Systematic bias</div>
        <div class="mm-perf-bar"><div class="mm-perf-fill" style="width:${Math.min(Math.abs(mm.accuracy.bias)*10,100)}%;background:${biasColor(mm.accuracy.bias)};"></div></div>
        <div class="mm-perf-val" style="color:${biasColor(mm.accuracy.bias)};">${mm.accuracy.bias > 0 ? '+' : ''}${mm.accuracy.bias}%</div>
      </div>
      <div class="mm-perf-row">
        <div class="mm-perf-label">Drift vs last refresh</div>
        <div class="mm-perf-bar"><div class="mm-perf-fill" style="width:${Math.min(Math.abs(mm.accuracy.drift)*15,100)}%;background:${biasColor(mm.accuracy.drift)};"></div></div>
        <div class="mm-perf-val" style="color:${biasColor(mm.accuracy.drift)};">${mm.accuracy.drift > 0 ? '+' : ''}${mm.accuracy.drift}pp</div>
      </div>
    </div>

    <!-- Notes -->
    <div class="mm-card full" style="border-top-color:${mm.notes.includes('flag') || mm.notes.includes('below') ? 'var(--amber)' : 'var(--green)'};">
      <div class="mm-card-title">Analyst notes &amp; flags</div>
      <div class="mm-card-sub">REVIEW COMMENTARY</div>
      <div style="font-size:12px;color:var(--text2);line-height:1.7;padding:8px 12px;background:var(--bg);border-radius:4px;border-left:3px solid ${mm.notes.includes('flag') || mm.notes.includes('below') ? 'var(--amber)' : 'var(--green)'};">${mm.notes}</div>
    </div>

    <!-- Cross-link to Health & Approval -->
    <div class="mm-card full accent-blue" style="border-top-width:2px;">
      <div style="display:flex;align-items:center;justify-content:space-between;">
        <div>
          <div class="mm-card-title">Review health &amp; approve this plan</div>
          <div style="font-size:11px;color:var(--text3);">Check model accuracy metrics and approve the ${planName} forecast for this cycle</div>
        </div>
        <button class="lt-btn primary" style="font-size:11px;white-space:nowrap;" onclick="viewHealthForQueue('${qid}')">→ Go to Health &amp; Approval</button>
      </div>
    </div>`;
}

function addAdj() {
  const name = document.getElementById('aj-name').value.trim();
  const type = document.getElementById('aj-type').value;
  const period = document.getElementById('aj-period').value;
  const impact = document.getElementById('aj-impact').value.trim();
  const conf = document.getElementById('aj-conf').value;
  if (!name || !impact) { alert('Please enter a name and impact.'); return; }
  const pos = type.includes('uplift') || type.includes('increase');
  const col = pos ? 'var(--red)' : 'var(--green)';
  const bg  = pos ? 'rgba(248,113,113,.12)' : 'rgba(74,222,128,.12)';
  const el = document.createElement('div');
  el.className = 'adj-item';
  el.innerHTML = `<div class="adj-tag" style="background:${bg};color:${col};">${type.split(' ')[0]}</div><div><div class="adj-name">${name}</div><div class="adj-sub">${period} · ${impact} · ${conf}</div></div><div class="adj-val" style="color:${col};">${impact}</div><div class="adj-del" onclick="this.closest('.adj-item').remove()">✕</div>`;
  document.querySelector('.adj-form').before(el);
  document.getElementById('aj-name').value = '';
  document.getElementById('aj-impact').value = '';
}

function approveForecast() {
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:999;display:flex;align-items:center;justify-content:center;';
  ov.innerHTML = `<div style="background:#fff;border:2px solid #0A7C4E;border-radius:10px;box-shadow:0 20px 60px rgba(0,0,0,.15);padding:32px 40px;text-align:center;max-width:400px;"><div style="font-size:36px;margin-bottom:12px;">✅</div><div style="font-size:16px;font-weight:700;color:var(--green);margin-bottom:8px;">Forecast approved and locked</div><div style="font-size:12px;color:#4A5568;line-height:1.7;margin-bottom:20px;">The FY2025–26 demand forecast has been locked in PAW. Staffing optimisation is now unlocked. The Relationship Manager has been notified.</div><button onclick="this.closest('div[style]').remove();closeFD();ltStep(4);" style="background:#003B70;color:#fff;border:none;padding:9px 22px;border-radius:6px;font-size:13px;font-weight:700;cursor:pointer;font-family:var(--sans);">Continue to staffing plan →</button></div>`;
  document.body.appendChild(ov);
}

// ══════════════════════════════════════════════════════════════════
// CHAT ENGINE — Claude API wired to LT Planning context
// ══════════════════════════════════════════════════════════════════

let chatOpen     = false;
let chatHistory  = [];
let chatBusy     = false;

const CHAT_SUGGESTIONS = {
  1: ['What are the key signals from Feb 2026 actuals?',
      'Which plan had the highest AHT last month?',
      'Which plans have the lowest HC variance?',
      'How does Feb 2026 compare to the previous year?'],
  2: ['How healthy is our cross-skill coverage?',
      'Which cluster has the most HC risk?',
      'What was our attrition rate last month?',
      'How is the Cards cluster structured?'],
  3: ['Why is October the highest demand month?',
      'Which plan drives the most FTE demand?',
      'What happens to staffing if AHT rises 10%?',
      'How does cross-skill support help in Oct 2026?'],
  4: ['How much hiring do we need in Q3 2026?',
      'Which plans have the tightest HC variance?',
      'What is our total cross-skill capacity?',
      'When should we start Q3 recruitment?'],
};

function buildSystemPrompt() {
  const stepNames = {1:'Data Actualization',2:'HC Reconciliation',3:'Forecasting',4:'Staffing Optimization'};
  const activeStep = [1,2,3,4].find(n => document.getElementById('nav-'+n)?.classList.contains('active')) || 3;
  const feb26    = WFM.getMonth(2026,2) || {};
  const feb26_qs = WFM.getQueuesForMonth(2026,2);
  const oct26_qs = WFM.getQueuesForMonth(2026,10);
  const fcMonths = WFM.monthly.filter(r=>r.is_forecast);

  const qRows = feb26_qs.map(q => {
    const qFTE = q.erlang_fte || 0;
    return `  ${q.qn}: HC=${q.hc}, vol=${WFM.fmtVol(q.vol)}, AHT=${q.aht}s, shr=${q.shr}%, erlang_fte=${qFTE}, hc_variance=${q.hc - qFTE}`;
  }).join('\n');

  const fcRows = fcMonths.map(m => {
    const qs = WFM.getQueuesForMonth(m.year, m.month);
    const fte = m.erlang_fte || 0;
    const xc   = qs.reduce((s,r)=>s+r.xc,0);
    return `  ${m.month_label}: vol=${WFM.fmtVol(m.vol)}, AHT=${m.aht}s, erlang_fte=${fte}, x-skill_cap=+${xc}`;
  }).join('\n');

  const xsRows = Object.entries(WFM.crossSkill).map(([qid,info]) => {
    if (info.specialist) return `  ${info.name}: SPECIALIST — no overflow`;
    const ts = info.can_support.map(([t,e])=>`${WFM.crossSkill[t]?.name||t} at ${Math.round(e*100)}%`).join(', ');
    return `  ${info.name} → ${ts||'none'}`;
  }).join('\n');

  const oct26fte = WFM.getMonth(2026,10)?.erlang_fte || 0;
  const oct26variance = 2000 - oct26fte;

  return `You are a WFM AI assistant inside Citi's Long Term Planning module.
Current step: Step ${activeStep} — ${stepNames[activeStep]}.
Planning cycle: March 2026 | Actuals through: Feb 2026 | Forecast: Mar 2026–Feb 2027 | Total HC: 2,000

FEB 2026 ACTUALS:
  Call volume: ${WFM.fmtN(feb26.vol||0)} | AHT: ${feb26.aht||0}s | Shrinkage: ${feb26.shrinkage_pct||0}% | Occupancy: ${feb26.occupancy_pct||0}% | Availability: ${feb26.availability_pct||0}%

PLAN BREAKDOWN — FEB 2026:
${qRows}

CROSS-SKILL MATRIX (85% efficiency, 15% of HC available):
${xsRows}

12-MONTH FORECAST (Mar 2026–Feb 2027):
${fcRows}

OCT 2026 (HIGHEST DEMAND): FTE Req=${oct26fte} | HC variance: ${oct26variance>=0?'+':''}${oct26variance}

Rules: Be concise (under 120 words unless breakdown needed). Use exact numbers. Explain WFM terms simply. Reference months by name. If asked something outside this data, say so.`;
}

async function chatSend() {
  if (chatBusy) return;
  const inp  = document.getElementById('chat-input');
  const text = (inp?.value || '').trim();
  if (!text) return;

  if (window.location.protocol === 'file:') {
    if (!chatOpen) chatToggle();
    inp.value = '';
    addUserMsg(text);
    addErrMsg('The AI chat requires the full Netlify deployment package.\n\nPlease follow the instructions in deploy-instructions.txt included in the zip file.');
    return;
  }

  if (!chatOpen) chatToggle();
  inp.value = '';
  addUserMsg(text);
  chatHistory.push({ role:'user', content: text });

  const typingId = addTyping();
  chatBusy = true;
  const sendBtn = document.getElementById('chat-send-btn');
  if (sendBtn) sendBtn.disabled = true;

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 1000,
        system: buildSystemPrompt(),
        messages: chatHistory,
      })
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error?.message || 'HTTP ' + res.status);
    }

    const data = await res.json();
    removeTyping(typingId);
    if (data.error) throw new Error(data.error.message);
    const reply = data.content?.find(b => b.type === 'text')?.text || '(no response)';
    addAIMsg(reply);
    chatHistory.push({ role:'assistant', content: reply });

  } catch(err) {
    removeTyping(typingId);
    console.error('Chat API error:', err);
    const isNetwork = err.message?.includes('fetch') || err.message?.includes('Network') || err.message?.includes('CORS');
    if (isNetwork) {
      addErrMsg('Network error. Make sure you deployed the full package (not just the HTML) and set your ANTHROPIC_API_KEY in Netlify environment variables.');
    } else {
      addErrMsg('API error: ' + err.message + '\n\nTry again or reload the page.');
    }
  } finally {
    chatBusy = false;
    if (sendBtn) sendBtn.disabled = false;
    document.getElementById('chat-input')?.focus();
  }
}

function chatToggle() {
  const drawer = document.getElementById('chat-drawer');
  const suggs  = document.getElementById('chat-suggestions');
  const btn    = document.getElementById('chat-toggle-btn');
  chatOpen = !chatOpen;
  drawer.classList.toggle('open', chatOpen);
  suggs.style.display  = chatOpen ? 'none' : 'flex';
  btn.textContent = chatOpen ? 'Close' : 'Ask AI';
  if (chatOpen && chatHistory.length === 0) {
    if (window.location.protocol === 'file:') {
      addAIMsg('Hi! I\'m your WFM planning assistant.\n\nThe AI chat requires the full Netlify deployment package — not just this HTML file. Please follow the deploy instructions in the zip file you downloaded.');
    } else {
      addAIMsg('Hi! I have full context on your Feb 2026 actuals and the Mar 2026\u2013Feb 2027 forecast across all 10 plans. What would you like to know?');
    }
  }
  if (chatOpen) {
    scrollChat();
    setTimeout(() => document.getElementById('chat-input')?.focus(), 300);
  }
}


/* ── DOM helpers ── */
function addUserMsg(text) {
  appendMsg('user', `<div class="chat-avatar usr">You</div><div class="chat-bubble usr">${esc(text)}</div>`);
}
function addAIMsg(text) {
  const fmt = esc(text)
    .replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>')
    .replace(/^•\s(.+)$/gm,'<span style="display:block;padding-left:12px;position:relative;"><span style="position:absolute;left:0;">•</span>$1</span>')
    .replace(/\n/g,'<br>');
  appendMsg('ai', `<div class="chat-avatar ai">AI</div><div class="chat-bubble ai">${fmt}</div>`);
}
function addErrMsg(text) {
  appendMsg('ai', `<div class="chat-avatar ai">AI</div><div class="chat-bubble err">${esc(text)}</div>`);
}
function addTyping() {
  const id = 'ty'+Date.now();
  const el = appendMsg('ai', `<div class="chat-avatar ai">AI</div><div class="chat-bubble typing" id="${id}">Thinking...</div>`, id);
  let d=0;
  el._t = setInterval(()=>{ d=(d+1)%4; const b=document.getElementById(id); if(b) b.textContent='Thinking'+'.'.repeat(d); },400);
  return id;
}
function removeTyping(id) {
  const el = document.getElementById(id+'_wrap');
  if (el) { clearInterval(el._t); el.remove(); }
}
function appendMsg(type, html, id) {
  const msgs = document.getElementById('chat-messages');
  if (!msgs) return null;
  const div = document.createElement('div');
  div.className = 'chat-msg' + (type==='user'?' user':'');
  if (id) div.id = id+'_wrap';
  div.innerHTML = html;
  msgs.appendChild(div);
  scrollChat();
  return div;
}
function scrollChat() {
  const msgs = document.getElementById('chat-messages');
  if (msgs) setTimeout(()=>{ msgs.scrollTop = msgs.scrollHeight; }, 60);
}
function esc(t) {
  return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function updateSuggestions() {
  const activeStep = [1,2,3,4].find(n => document.getElementById('nav-'+n)?.classList.contains('active')) || 3;
  const suggs = CHAT_SUGGESTIONS[activeStep] || CHAT_SUGGESTIONS[3];
  const bar = document.getElementById('chat-suggestions');
  if (bar) bar.innerHTML = suggs.map(s=>`<span class="chat-sugg" onclick="chatSugg(this)">${s}</span>`).join('');
}

/* Patch ltStep to update suggestions + reset chat on step change */
(function() {
  const _orig = ltStep;
  window.ltStep = function(n) {
    _orig(n);
    updateSuggestions();
    if (chatHistory.length > 0) {
      chatHistory = [];
      const msgs = document.getElementById('chat-messages');
      if (msgs) msgs.innerHTML = '';
      if (chatOpen) {
        addAIMsg('Switched to ' + ['','Data Actualization','HC Reconciliation','Forecasting','Staffing Optimization'][n] + '. What would you like to know?');
      }
    }
  };
})();


