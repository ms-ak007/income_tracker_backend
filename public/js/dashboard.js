/* ═══════════════════════════════════════════════
   dashboard.js — Main App Logic
   ═══════════════════════════════════════════════ */

// ─── Auth Guard ───────────────────────────────────────────────
const token = localStorage.getItem('ft_token');
if (!token) { window.location.href = '/'; }

let currentUser  = JSON.parse(localStorage.getItem('ft_user') || '{}');
let allTxData    = [];
let trendChart   = null;
let catChart     = null;
let netChart     = null;
let allTimeChart = null;
let selectedType = 'income';

// ─── Categories ───────────────────────────────────────────────
const CATEGORIES = {
  income:  ['Salary', 'Freelance', 'Business', 'Investment Returns', 'Rental Income', 'Gift', 'Bonus', 'Other Income'],
  expense: ['Food & Dining', 'Rent / EMI', 'Transportation', 'Shopping', 'Utilities', 'Healthcare', 'Entertainment', 'Education', 'Insurance', 'Travel', 'Subscriptions', 'Other Expense'],
};

// ─── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  setupGreeting();
  setupUserUI();
  await loadDashboard();
  setDefaultDate();
});

function setupGreeting() {
  const h = new Date().getHours();
  const greetEl = document.getElementById('greeting-time');
  if (greetEl) greetEl.textContent = h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
}

function setupUserUI() {
  const nameEl   = document.getElementById('topbar-name');
  const sidebarN = document.getElementById('user-name-sidebar');
  const sidebarE = document.getElementById('user-email-sidebar');
  const avatarEl = document.getElementById('user-avatar');

  if (currentUser.name) {
    if (nameEl)   nameEl.textContent = currentUser.name.split(' ')[0];
    if (sidebarN) sidebarN.textContent = currentUser.name;
    if (sidebarE) sidebarE.textContent = currentUser.email || '';
    if (avatarEl) avatarEl.textContent = currentUser.name.charAt(0).toUpperCase();
  }
}

const API_BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? ''
  : 'https://income-tracker-backend-1411.onrender.com';

// ─── API Helper ───────────────────────────────────────────────
async function api(path, opts = {}) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...opts,
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${token}`,
      ...(opts.headers || {}),
    },
  });
  if (res.status === 401) {
    localStorage.clear();
    window.location.href = '/';
    return null;
  }
  return res.json();
}

// ─── Load Dashboard ───────────────────────────────────────────
async function loadDashboard() {
  const curMonth = currentMonthStr();
  document.getElementById('current-month-label').textContent = formatMonthLabel(curMonth);

  // Fetch this month's transactions + trend data in parallel
  const [txData, trendData, catData] = await Promise.all([
    api(`/api/transactions?month=${curMonth}`),
    api('/api/reports/trend'),
    api(`/api/reports/categories?month=${curMonth}`),
  ]);

  if (txData)    updateSummaryCards(txData.transactions);
  if (trendData) renderTrendChart(trendData.trend);
  if (catData)   renderCategoryChart(catData.categories);

  // Recent transactions (last 8)
  if (txData) renderRecentTable(txData.transactions.slice(0, 8));

  // Income source balances
  populateSourcesMonthFilter();
  await loadIncomeSourceBalances();
}

function updateSummaryCards(txs) {
  const income  = txs.filter(t => t.type === 'income' ).reduce((s, t) => s + t.amount, 0);
  const expense = txs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const net     = income - expense;
  const iCount  = txs.filter(t => t.type === 'income').length;
  const eCount  = txs.filter(t => t.type === 'expense').length;

  animateCounter('card-income',  income,  true);
  animateCounter('card-expense', expense, true);
  animateCounter('card-net',     net,     true);

  setText('card-income-count',  `${iCount} transaction${iCount !== 1 ? 's' : ''}`);
  setText('card-expense-count', `${eCount} transaction${eCount !== 1 ? 's' : ''}`);

  const netEl = document.getElementById('card-net');
  if (netEl) {
    netEl.style.color = net >= 0 ? 'var(--income-light)' : 'var(--expense-light)';
  }
  setText('card-net-label', net >= 0 ? '🟢 Positive balance' : '🔴 Negative balance');

  // Progress bars (relative to max of income/expense)
  const max = Math.max(income, expense, 1);
  const barI = document.getElementById('bar-income');
  const barE = document.getElementById('bar-expense');
  if (barI) setTimeout(() => { barI.style.width = (income / max * 100) + '%'; }, 100);
  if (barE) setTimeout(() => { barE.style.width = (expense / max * 100) + '%'; }, 100);
}

// ─── Trend Chart ──────────────────────────────────────────────
function renderTrendChart(trend) {
  const ctx = document.getElementById('trendChart');
  if (!ctx) return;

  const labels  = trend.map(t => formatMonthLabel(t.month));
  const incomes = trend.map(t => t.income);
  const expens  = trend.map(t => t.expense);

  if (trendChart) trendChart.destroy();

  trendChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Income',
          data: incomes,
          backgroundColor: 'rgba(16,185,129,0.7)',
          borderColor: '#10b981',
          borderWidth: 2,
          borderRadius: 6,
          borderSkipped: false,
        },
        {
          label: 'Expense',
          data: expens,
          backgroundColor: 'rgba(244,63,94,0.7)',
          borderColor: '#f43f5e',
          borderWidth: 2,
          borderRadius: 6,
          borderSkipped: false,
        },
      ],
    },
    options: chartOptions({
      plugins: { legend: { display: true, labels: { color: '#94a3b8', font: { family: 'Inter', size: 12 } } } },
      scales: {
        x: { ticks: { color: '#475569' }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y: { ticks: { color: '#475569', callback: v => '₹' + formatNum(v) }, grid: { color: 'rgba(255,255,255,0.06)' } },
      },
    }),
  });
}

// ─── Category Donut Chart ─────────────────────────────────────
function renderCategoryChart(categories) {
  const ctx = document.getElementById('categoryChart');
  if (!ctx) return;
  if (catChart) catChart.destroy();

  if (!categories || categories.length === 0) {
    catChart = null; return;
  }

  const palette = ['#7c3aed','#f43f5e','#10b981','#f59e0b','#3b82f6','#ec4899','#14b8a6','#f97316'];

  catChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: categories.map(c => c.category),
      datasets: [{
        data:            categories.map(c => c.total),
        backgroundColor: palette.slice(0, categories.length),
        borderColor:     'rgba(10,15,30,0.8)',
        borderWidth:     3,
        hoverOffset:     8,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { color: '#94a3b8', font: { family: 'Inter', size: 11 }, padding: 12 } },
        tooltip: { callbacks: { label: ctx => ` ₹${formatNum(ctx.raw)}` } },
      },
      cutout: '68%',
    },
  });
}

// ─── Recent Table ─────────────────────────────────────────────
function renderRecentTable(txs) {
  const tbody = document.getElementById('recent-tbody');
  if (!tbody) return;
  if (!txs || txs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state"><div class="empty-state-icon">📭</div><p>No transactions this month — add one!</p></div></td></tr>`;
    return;
  }
  tbody.innerHTML = txs.map(t => `
    <tr>
      <td>${formatDate(t.date)}</td>
      <td>${escHtml(t.description) || '<span class="text-muted">—</span>'}</td>
      <td><span class="badge badge-${t.type}">${escHtml(t.category)}</span>${t.paid_from ? `<span class="paid-from-badge">from ${escHtml(t.paid_from)}</span>` : ''}</td>
      <td><span class="badge badge-${t.type}">${t.type}</span></td>
      <td class="td-amount ${t.type}">${t.type === 'income' ? '+' : '−'}₹${formatNum(t.amount)}</td>
    </tr>`).join('');
}

// ─── Navigation ───────────────────────────────────────────────
function navigate(page) {
  document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => {
    n.classList.remove('active');
    n.removeAttribute('aria-current');
  });

  const section = document.getElementById(`section-${page}`);
  const navBtn  = document.getElementById(`nav-${page}`);
  if (section) section.classList.add('active');
  if (navBtn) { navBtn.classList.add('active'); navBtn.setAttribute('aria-current', 'page'); }

  // Lazy-load page content
  if (page === 'transactions') loadTransactionsPage();
  if (page === 'reports')      loadReportsPage();
  if (page === 'yearly')       loadYearlyPage();
  if (page === 'analytics')    loadAnalyticsPage();
  if (page === 'automations')  loadAutomations();
  if (page === 'cashflow')     loadCashFlowPage();
  if (page === 'tax')          loadTaxPage();
  if (page === 'policy')       loadPolicyPage();
  if (page === 'bank')         loadBankPage();
  if (page === 'sources') {
    // Reset period state and active tab visually, then load after paint
    _srcPeriod = 'all';
    ['all', 'month', 'custom'].forEach(p => {
      document.getElementById(`src-tab-${p}`)?.classList.toggle('active', p === 'all');
    });
    const picker = document.getElementById('src-custom-month');
    if (picker) picker.classList.add('hidden');
    // Use requestAnimationFrame so the section is visible before fetching
    requestAnimationFrame(() => loadSourcesPage());
  }

  // Close sidebar on mobile
  if (window.innerWidth <= 660) toggleSidebar(false);
}

// ─── Transactions Page ────────────────────────────────────────
async function loadTransactionsPage() {
  const data = await api('/api/transactions');
  if (!data) return;
  allTxData = data.transactions;
  populateMonthFilter(allTxData);
  renderTxTable(allTxData);
}

function populateMonthFilter(txs) {
  const sel = document.getElementById('tx-month-filter');
  if (!sel) return;
  const months = [...new Set(txs.map(t => t.date.slice(0,7)))].sort().reverse();
  sel.innerHTML = '<option value="">All months</option>' +
    months.map(m => `<option value="${m}">${formatMonthLabel(m)}</option>`).join('');
}

function filterTransactions() {
  const month = document.getElementById('tx-month-filter').value;
  const type  = document.getElementById('tx-type-filter').value;
  let filtered = allTxData;
  if (month) filtered = filtered.filter(t => t.date.startsWith(month));
  if (type)  filtered = filtered.filter(t => t.type === type);
  renderTxTable(filtered);
}

function renderTxTable(txs) {
  const tbody = document.getElementById('tx-tbody');
  if (!tbody) return;

  if (!txs || txs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><div class="empty-state-icon">📭</div><p>No transactions found</p></div></td></tr>`;
    document.getElementById('tx-summary').innerHTML = '';
    return;
  }

  tbody.innerHTML = txs.map(t => `
    <tr>
      <td>${formatDate(t.date)}</td>
      <td>${escHtml(t.description) || '<span class="text-muted">—</span>'}</td>
      <td><span class="badge badge-${t.type}">${escHtml(t.category)}</span>${t.paid_from ? `<span class="paid-from-badge">from ${escHtml(t.paid_from)}</span>` : ''}</td>
      <td><span class="badge badge-${t.type}">${t.type}</span></td>
      <td class="td-amount ${t.type}">${t.type === 'income' ? '+' : '−'}₹${formatNum(t.amount)}</td>
      <td><button class="td-delete" onclick="deleteTransaction(${t.id})" title="Delete" aria-label="Delete transaction">🗑</button></td>
    </tr>`).join('');

  // Summary row
  const totalIncome  = txs.filter(t => t.type === 'income' ).reduce((s,t) => s+t.amount, 0);
  const totalExpense = txs.filter(t => t.type === 'expense').reduce((s,t) => s+t.amount, 0);
  const net          = totalIncome - totalExpense;
  document.getElementById('tx-summary').innerHTML = `
    <span class="text-income">Income: ₹${formatNum(totalIncome)}</span>
    <span class="text-expense">Expense: ₹${formatNum(totalExpense)}</span>
    <span style="color:${net>=0?'var(--income)':'var(--expense)'}">Net: ₹${formatNum(net)}</span>
    <span class="text-muted">${txs.length} transaction${txs.length!==1?'s':''}</span>`;
}

async function deleteTransaction(id) {
  if (!confirm('Delete this transaction?')) return;
  const data = await api(`/api/transactions/${id}`, { method: 'DELETE' });
  if (data && data.success) {
    showToast('Transaction deleted', 'success');
    loadTransactionsPage();
    loadDashboard();
  }
}

// ─── Reports Page ─────────────────────────────────────────────
async function loadReportsPage() {
  const data = await api('/api/reports/monthly');
  if (!data) return;
  renderMonthCards(data.months);
}

function renderMonthCards(months) {
  const grid = document.getElementById('month-cards-grid');
  if (!grid) return;

  if (!months || months.length === 0) {
    grid.innerHTML = `<div class="glass" style="padding:48px;text-align:center;grid-column:1/-1">
      <div class="empty-state-icon">📅</div><p>No data yet. Add some transactions!</p></div>`;
    return;
  }

  grid.innerHTML = months.map(m => {
    const net    = m.net;
    const netColor = net >= 0 ? 'var(--income-light)' : 'var(--expense-light)';
    return `<div class="glass month-card" onclick="openMonthDetail('${m.month}')" tabindex="0" role="button" aria-label="View details for ${formatMonthLabel(m.month)}">
      <div class="month-card-title">${formatMonthLabel(m.month)}</div>
      <div class="month-card-stats">
        <div class="month-stat-row"><span class="label">Income</span><span class="text-income">₹${formatNum(m.total_income)}</span></div>
        <div class="month-stat-row"><span class="label">Expenses</span><span class="text-expense">₹${formatNum(m.total_expense)}</span></div>
        <div class="month-stat-row"><span class="label">Transactions</span><span>${m.transaction_count}</span></div>
        <div class="month-net-row">
          <span>Net Balance</span>
          <span style="color:${netColor}">${net>=0?'+':''}₹${formatNum(net)}</span>
        </div>
      </div>
    </div>`;
  }).join('');
}

async function openMonthDetail(month) {
  const [y, m] = month.split('-');
  const data = await api(`/api/reports/monthly/${y}/${m}`);
  if (!data) return;

  const { summary, transactions } = data;

  setText('detail-month-title', formatMonthLabel(month) + ' — Detail');
  setText('detail-income',  '₹' + formatNum(summary.total_income  || 0));
  setText('detail-expense', '₹' + formatNum(summary.total_expense || 0));

  const net    = summary.net || 0;
  const netEl  = document.getElementById('detail-net');
  if (netEl) {
    netEl.textContent = (net>=0?'+':'') + '₹' + formatNum(net);
    netEl.style.color = net >= 0 ? 'var(--income-light)' : 'var(--expense-light)';
  }

  const tbody = document.getElementById('detail-tbody');
  if (tbody) {
    tbody.innerHTML = transactions.length ? transactions.map(t => `
      <tr>
        <td>${formatDate(t.date)}</td>
        <td>${escHtml(t.description)||'<span class="text-muted">—</span>'}</td>
        <td><span class="badge badge-${t.type}">${escHtml(t.category)}</span></td>
        <td><span class="badge badge-${t.type}">${t.type}</span></td>
        <td class="td-amount ${t.type}">${t.type==='income'?'+':'−'}₹${formatNum(t.amount)}</td>
      </tr>`).join('') :
      `<tr><td colspan="5"><div class="empty-state"><p>No transactions this month</p></div></td></tr>`;
  }

  document.getElementById('month-detail').classList.remove('hidden');
  document.getElementById('month-detail').scrollIntoView({ behavior: 'smooth' });
  _activeDownloadMonth = month; // track for download

  // Highlight selected card
  document.querySelectorAll('.month-card').forEach(c => c.classList.remove('selected'));
  document.querySelectorAll('.month-card').forEach(c => {
    if (c.textContent.includes(formatMonthLabel(month))) c.classList.add('selected');
  });
}

// Track active month for CSV download
let _activeDownloadMonth = null;

function closeMonthDetail() {
  document.getElementById('month-detail').classList.add('hidden');
  document.querySelectorAll('.month-card').forEach(c => c.classList.remove('selected'));
  _activeDownloadMonth = null;
}

// ─── Analytics Page ───────────────────────────────────────────
async function loadAnalyticsPage() {
  const [trendData, allCatData] = await Promise.all([
    api('/api/reports/trend'),
    api('/api/reports/categories?month=all'),
  ]);

  if (trendData) renderNetTrendChart(trendData.trend);
  if (trendData) renderAllTimeChart(trendData.trend);

  // All-time categories
  const allData = await api('/api/reports/monthly');
  if (allData && allData.months.length) {
    // Get all transactions and aggregate categories
    const allTx = await api('/api/transactions');
    if (allTx) renderCategoryBars(allTx.transactions);
  }
}

function renderNetTrendChart(trend) {
  const ctx = document.getElementById('netTrendChart');
  if (!ctx) return;
  if (netChart) netChart.destroy();

  const labels = trend.map(t => formatMonthLabel(t.month));
  const nets   = trend.map(t => t.income - t.expense);

  netChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Net Balance',
        data: nets,
        borderColor: '#7c3aed',
        backgroundColor: 'rgba(124,58,237,0.1)',
        borderWidth: 2.5,
        pointBackgroundColor: '#9f5cf7',
        pointRadius: 5,
        pointHoverRadius: 8,
        fill: true,
        tension: 0.4,
      }],
    },
    options: chartOptions({
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#475569' }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y: { ticks: { color: '#475569', callback: v => '₹' + formatNum(v) }, grid: { color: 'rgba(255,255,255,0.06)' } },
      },
    }),
  });
}

function renderAllTimeChart(trend) {
  const ctx = document.getElementById('allTimeChart');
  if (!ctx) return;
  if (allTimeChart) allTimeChart.destroy();

  const totalIncome  = trend.reduce((s,t) => s + t.income, 0);
  const totalExpense = trend.reduce((s,t) => s + t.expense, 0);

  allTimeChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Total Income', 'Total Expenses'],
      datasets: [{
        data: [totalIncome, totalExpense],
        backgroundColor: ['rgba(16,185,129,0.8)', 'rgba(244,63,94,0.8)'],
        borderColor: ['#10b981', '#f43f5e'],
        borderWidth: 2,
        hoverOffset: 8,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { color: '#94a3b8', font: { family: 'Inter' }, padding: 16 } },
        tooltip: { callbacks: { label: ctx => ` ₹${formatNum(ctx.raw)}` } },
      },
      cutout: '60%',
    },
  });
}

function renderCategoryBars(txs) {
  const expenses = txs.filter(t => t.type === 'expense');
  const catMap = {};
  expenses.forEach(t => { catMap[t.category] = (catMap[t.category] || 0) + t.amount; });
  const sorted = Object.entries(catMap).sort((a,b) => b[1]-a[1]);
  const max = sorted[0]?.[1] || 1;

  const container = document.getElementById('category-bars');
  if (!container) return;

  const palette = ['#7c3aed','#f43f5e','#10b981','#f59e0b','#3b82f6','#ec4899','#14b8a6','#f97316','#8b5cf6','#06b6d4'];

  container.innerHTML = sorted.map(([cat, total], i) => `
    <div style="margin-bottom:16px">
      <div class="flex-between" style="margin-bottom:6px">
        <span style="font-size:0.85rem;font-weight:500">${escHtml(cat)}</span>
        <span style="font-size:0.85rem;font-weight:700;color:${palette[i%palette.length]}">₹${formatNum(total)}</span>
      </div>
      <div class="progress-bar-wrap">
        <div class="progress-bar-fill" style="width:${(total/max*100).toFixed(1)}%;background:${palette[i%palette.length]};transition:width 1s ease ${i*0.06}s"></div>
      </div>
    </div>`).join('');
}

// ─── Modal (Add Transaction) ──────────────────────────────────
function openModal() {
  document.getElementById('modal-overlay').classList.add('open');
  document.getElementById('modal-error').classList.remove('show');
  document.getElementById('tx-form').reset();
  setType(selectedType);
  setDefaultDate();
  document.getElementById('tx-amount').focus();
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
}

function closeModalOnOverlay(e) {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
}

function setType(type) {
  selectedType = type;
  const incBtn = document.getElementById('type-income-btn');
  const expBtn = document.getElementById('type-expense-btn');

  incBtn.className = 'type-btn' + (type === 'income' ? ' active-income' : '');
  expBtn.className = 'type-btn' + (type === 'expense' ? ' active-expense' : '');

  // Update category options
  const sel = document.getElementById('tx-category');
  sel.innerHTML = '<option value="">Select category…</option>' +
    CATEGORIES[type].map(c => `<option value="${c}">${c}</option>`).join('');

  // Update submit button color
  const btn = document.getElementById('tx-submit-btn');
  btn.className = `btn btn-${type === 'income' ? 'income' : 'expense'} btn-full`;

  // Show/hide "Pay from" field — only relevant for expenses
  const paidFromGroup = document.getElementById('paid-from-group');
  const paidFromSel   = document.getElementById('tx-paid-from');
  if (paidFromGroup) {
    paidFromGroup.style.display = type === 'expense' ? '' : 'none';
    if (paidFromSel) {
      paidFromSel.innerHTML = '<option value="">— Not specified —</option>' +
        CATEGORIES.income.map(c => `<option value="${c}">${c}</option>`).join('');
    }
  }
}

function setDefaultDate() {
  const dateInput = document.getElementById('tx-date');
  if (dateInput && !dateInput.value) {
    dateInput.value = new Date().toISOString().split('T')[0];
  }
}

async function handleAddTransaction(e) {
  e.preventDefault();
  const amount      = parseFloat(document.getElementById('tx-amount').value);
  const category    = document.getElementById('tx-category').value;
  const description = document.getElementById('tx-description').value.trim();
  const date        = document.getElementById('tx-date').value;
  const errEl       = document.getElementById('modal-error');
  const btn         = document.getElementById('tx-submit-btn');
  const btnText     = document.getElementById('tx-btn-text');
  const spinner     = document.getElementById('tx-btn-spinner');

  errEl.classList.remove('show');

  if (!amount || isNaN(amount) || amount <= 0) { showModalError(errEl, 'Enter a valid positive amount.'); return; }
  if (!category) { showModalError(errEl, 'Please select a category.'); return; }
  if (!date)     { showModalError(errEl, 'Please select a date.');     return; }

  btn.disabled = true;
  btnText.classList.add('hidden');
  spinner.classList.remove('hidden');

  try {
    const paid_from = document.getElementById('tx-paid-from')?.value || '';
    const data = await api('/api/transactions', {
      method: 'POST',
      body: JSON.stringify({ type: selectedType, category, amount, description, date, paid_from }),
    });

    if (data && data.transaction) {
      showToast(`${selectedType === 'income' ? '💚 Income' : '🔴 Expense'} added — ₹${formatNum(amount)}`, 'success');
      closeModal();
      // Refresh current page data
      await loadDashboard();
      if (document.getElementById('section-transactions').classList.contains('active')) loadTransactionsPage();
      if (document.getElementById('section-reports').classList.contains('active'))      loadReportsPage();
      if (document.getElementById('section-yearly').classList.contains('active'))       loadYearlyPage();
    } else {
      showModalError(errEl, (data && data.error) || 'Failed to add transaction.');
    }
  } catch (err) {
    showModalError(errEl, 'Network error.');
  } finally {
    btn.disabled = false;
    btnText.classList.remove('hidden');
    spinner.classList.add('hidden');
  }
}

function showModalError(el, msg) {
  el.textContent = msg;
  el.classList.add('show');
}

// ─── Sidebar toggle (mobile) ──────────────────────────────────
function toggleSidebar(forceState) {
  const sidebar = document.getElementById('sidebar');
  if (typeof forceState === 'boolean') {
    sidebar.classList.toggle('open', forceState);
  } else {
    sidebar.classList.toggle('open');
  }
}

// ─── Logout ───────────────────────────────────────────────────
function handleLogout() {
  if (!confirm('Sign out of FinFlow?')) return;
  localStorage.clear();
  window.location.href = '/';
}

// ─── Income Source Balances ───────────────────────────────────

async function populateSourcesMonthFilter() {
  const data = await api('/api/transactions');
  if (!data) return;
  const sel = document.getElementById('sources-month-filter');
  if (!sel) return;
  const months = [...new Set(data.transactions.map(t => t.date.slice(0, 7)))].sort().reverse();
  sel.innerHTML = '<option value="">All time</option>' +
    months.map(m => `<option value="${m}">${formatMonthLabel(m)}</option>`).join('');
}

async function loadIncomeSourceBalances() {
  const sel   = document.getElementById('sources-month-filter');
  const month = sel ? sel.value : '';
  const url   = month ? `/api/reports/income-sources?month=${month}` : '/api/reports/income-sources';
  const data  = await api(url);
  if (!data) return;
  renderIncomeSourceCards(data.sources);
}

function renderIncomeSourceCards(sources) {
  const panel = document.getElementById('income-sources-panel');
  const grid  = document.getElementById('income-sources-grid');
  if (!panel || !grid) return;

  if (!sources || sources.length === 0) {
    panel.style.display = 'none';
    return;
  }

  panel.style.display = '';

  const palette = [
    { accent: '#7c3aed', bg: 'rgba(124,58,237,0.08)' },
    { accent: '#10b981', bg: 'rgba(16,185,129,0.08)' },
    { accent: '#f59e0b', bg: 'rgba(245,158,11,0.08)' },
    { accent: '#3b82f6', bg: 'rgba(59,130,246,0.08)' },
    { accent: '#ec4899', bg: 'rgba(236,72,153,0.08)' },
    { accent: '#14b8a6', bg: 'rgba(20,184,166,0.08)' },
    { accent: '#f97316', bg: 'rgba(249,115,22,0.08)' },
    { accent: '#8b5cf6', bg: 'rgba(139,92,246,0.08)' },
  ];

  grid.innerHTML = sources.map((s, i) => {
    const color       = palette[i % palette.length];
    const pct         = s.total_earned > 0 ? Math.min((s.total_spent / s.total_earned) * 100, 100) : 0;
    const isNeg       = s.remaining < 0;
    const remColor    = isNeg ? 'var(--expense-light)' : 'var(--income-light)';
    const remSign     = isNeg ? '−' : '+';
    const savedPct    = s.total_earned > 0 ? ((s.remaining / s.total_earned) * 100).toFixed(0) : 0;

    return `
      <div class="income-source-card" style="--source-accent:${color.accent};--source-bg:${color.bg}">
        <div class="source-card-top">
          <div class="source-icon" style="background:${color.bg};color:${color.accent}">${sourceEmoji(s.source)}</div>
          <div class="source-name">${escHtml(s.source)}</div>
        </div>
        <div class="source-stats">
          <div class="source-stat-row">
            <span class="source-label">Earned</span>
            <span class="text-income" style="font-weight:700">₹${formatNum(s.total_earned)}</span>
          </div>
          <div class="source-stat-row">
            <span class="source-label">Expenses paid</span>
            <span class="text-expense" style="font-weight:700">₹${formatNum(s.total_spent)}</span>
          </div>
        </div>
        <div class="source-progress-wrap">
          <div class="source-progress-fill" style="width:${pct.toFixed(1)}%;background:${color.accent}"></div>
        </div>
        <div class="source-remaining">
          <span style="font-size:0.78rem;color:var(--text-muted)">Remaining</span>
          <span style="font-size:1.25rem;font-weight:800;color:${remColor}">${remSign}₹${formatNum(Math.abs(s.remaining))}</span>
        </div>
        ${s.total_earned > 0 ? `<div class="source-saved-pct" style="color:${color.accent}">${savedPct}% held in account</div>` : ''}
      </div>`;
  }).join('');
}

function sourceEmoji(name) {
  const map = {
    'Salary':             '💼',
    'Business':           '🏢',
    'Freelance':          '💻',
    'Investment Returns': '📈',
    'Rental Income':      '🏠',
    'Gift':               '🎁',
    'Bonus':              '⭐',
    'Other Income':       '💰',
  };
  return map[name] || '💰';
}

// =============================================================
//  INCOME SOURCE BALANCES PAGE
// =============================================================

let _srcPeriod        = 'all';   // 'all' | 'month' | 'custom'
let _srcCustomMonth   = '';      // 'YYYY-MM' when custom
let _sourceCharts     = {};      // { [sourceName]: Chart instance }

function setSrcPeriod(period) {
  _srcPeriod = period;
  // Toggle tab active states
  ['all', 'month', 'custom'].forEach(p => {
    document.getElementById(`src-tab-${p}`)?.classList.toggle('active', p === period);
  });
  // Show/hide custom month picker
  const picker = document.getElementById('src-custom-month');
  if (picker) picker.classList.toggle('hidden', period !== 'custom');
  loadSourcesPage();
}

async function loadSourcesPage() {
  // Determine the month filter to apply
  let month = '';
  if (_srcPeriod === 'month') {
    month = currentMonthStr();
  } else if (_srcPeriod === 'custom') {
    month = document.getElementById('src-custom-month')?.value || '';
  }

  // Populate the custom month picker with available months (once)
  _populateSrcCustomPicker();

  // Fetch income-sources data + all transactions for the period
  const [srcData, txData] = await Promise.all([
    api(month ? `/api/reports/income-sources?month=${month}` : '/api/reports/income-sources'),
    api(month ? `/api/transactions?month=${month}` : '/api/transactions'),
  ]);

  if (!srcData || !txData) return;

  const sources = srcData.sources || [];
  const allTxs  = txData.transactions || [];

  // Compute totals for the summary strip
  const totalIncome      = sources.reduce((s, x) => s + x.total_earned, 0);
  const totalTracked     = sources.reduce((s, x) => s + x.total_spent,  0);
  const totalAllExpense  = allTxs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const totalUntracked   = Math.max(0, totalAllExpense - totalTracked);
  const netAvail         = totalIncome - totalAllExpense;

  // Update summary strip
  setText('src-total-income',     '₹' + formatNum(totalIncome));
  setText('src-tracked-expense',  '₹' + formatNum(totalTracked));
  setText('src-untracked-expense','₹' + formatNum(totalUntracked));
  const netEl = document.getElementById('src-net-available');
  if (netEl) {
    netEl.textContent = (netAvail >= 0 ? '+' : '−') + '₹' + formatNum(Math.abs(netAvail));
    netEl.style.color = netAvail >= 0 ? 'var(--income-light)' : 'var(--expense-light)';
  }

  // Show/hide empty state
  const emptyEl = document.getElementById('sources-empty');
  if (emptyEl) emptyEl.style.display = sources.length === 0 ? '' : 'none';

  // Render wallet cards
  renderSourceWallets(sources, allTxs);
}

async function _populateSrcCustomPicker() {
  const picker = document.getElementById('src-custom-month');
  if (!picker || picker.dataset.populated) return;
  picker.dataset.populated = '1';
  const data = await api('/api/transactions');
  if (!data) return;
  const months = [...new Set(data.transactions.map(t => t.date.slice(0, 7)))].sort().reverse();
  picker.innerHTML = '<option value="">Pick month…</option>' +
    months.map(m => `<option value="${m}">${formatMonthLabel(m)}</option>`).join('');
}

const SOURCE_PALETTE = [
  { accent: '#7c3aed', glow: 'rgba(124,58,237,0.3)',  bg: 'rgba(124,58,237,0.07)' },
  { accent: '#10b981', glow: 'rgba(16,185,129,0.3)',  bg: 'rgba(16,185,129,0.07)' },
  { accent: '#f59e0b', glow: 'rgba(245,158,11,0.3)',  bg: 'rgba(245,158,11,0.07)' },
  { accent: '#3b82f6', glow: 'rgba(59,130,246,0.3)',  bg: 'rgba(59,130,246,0.07)'  },
  { accent: '#ec4899', glow: 'rgba(236,72,153,0.3)',  bg: 'rgba(236,72,153,0.07)' },
  { accent: '#14b8a6', glow: 'rgba(20,184,166,0.3)',  bg: 'rgba(20,184,166,0.07)' },
  { accent: '#f97316', glow: 'rgba(249,115,22,0.3)',  bg: 'rgba(249,115,22,0.07)' },
  { accent: '#8b5cf6', glow: 'rgba(139,92,246,0.3)',  bg: 'rgba(139,92,246,0.07)' },
];

function renderSourceWallets(sources, allTxs) {
  // Destroy old charts
  Object.values(_sourceCharts).forEach(c => c?.destroy());
  _sourceCharts = {};

  const grid = document.getElementById('source-wallets-grid');
  if (!grid) return;

  if (!sources.length) { grid.innerHTML = ''; return; }

  grid.innerHTML = sources.map((s, i) => {
    const col      = SOURCE_PALETTE[i % SOURCE_PALETTE.length];
    const isNeg    = s.remaining < 0;
    const remColor = isNeg ? 'var(--expense-light)' : 'var(--income-light)';
    const pct      = s.total_earned > 0 ? Math.min((s.total_spent / s.total_earned) * 100, 100) : 0;
    const heldPct  = s.total_earned > 0 ? Math.max(0, (s.remaining / s.total_earned) * 100).toFixed(0) : 0;

    // Income transactions for this source
    const incTxs  = allTxs.filter(t => t.type === 'income' && t.category === s.source);
    // Expense transactions tagged to this source
    const expTxs  = allTxs.filter(t => t.type === 'expense' && t.paid_from === s.source);
    const srcId   = s.source.replace(/\s+/g, '-').toLowerCase();

    const txRows = (arr, type) => arr.length
      ? arr.map(t => `
        <tr>
          <td>${formatDate(t.date)}</td>
          <td>${escHtml(t.description) || '<span class="text-muted">—</span>'}</td>
          <td><span class="badge badge-${t.type}">${escHtml(t.category)}</span></td>
          <td class="td-amount ${t.type}">${type === 'income' ? '+' : '−'}₹${formatNum(t.amount)}</td>
        </tr>`).join('')
      : `<tr><td colspan="4"><div class="empty-state" style="padding:24px"><p style="font-size:0.82rem">No ${type} transactions yet</p></div></td></tr>`;

    return `
    <div class="source-wallet-card" id="wallet-${srcId}" style="--w-accent:${col.accent};--w-glow:${col.glow};--w-bg:${col.bg}">

      <!-- Wallet header -->
      <div class="wallet-header">
        <div class="wallet-icon-wrap" style="background:${col.bg};color:${col.accent}">${sourceEmoji(s.source)}</div>
        <div class="wallet-title-group">
          <h3 class="wallet-title">${escHtml(s.source)}</h3>
          <span class="wallet-subtitle">${incTxs.length} income · ${expTxs.length} expense${expTxs.length !== 1 ? 's' : ''} tagged</span>
        </div>
        <div class="wallet-badge-wrap">
          <span class="wallet-status-badge" style="background:${col.bg};color:${col.accent};border-color:${col.accent}">
            ${isNeg ? '⚠️ Overdraft' : '✅ Healthy'}
          </span>
        </div>
      </div>

      <!-- Big balance row -->
      <div class="wallet-balance-row">
        <div class="wallet-balance-main">
          <div class="wallet-balance-label">Available Balance</div>
          <div class="wallet-balance-amount" style="color:${remColor}">
            ${isNeg ? '−' : '+'}₹${formatNum(Math.abs(s.remaining))}
          </div>
          ${s.total_earned > 0 ? `<div class="wallet-held-pct" style="color:${col.accent}">${heldPct}% held</div>` : ''}
        </div>
        <div class="wallet-donut-wrap">
          <canvas id="donut-${srcId}" width="110" height="110"></canvas>
        </div>
      </div>

      <!-- Progress bar -->
      <div class="wallet-progress-track">
        <div class="wallet-progress-fill" style="width:${pct.toFixed(1)}%;background:${col.accent}"></div>
      </div>
      <div class="wallet-progress-labels">
        <span style="color:var(--text-muted);font-size:0.72rem">Expenses ${pct.toFixed(0)}% of income</span>
        <span style="color:var(--text-muted);font-size:0.72rem">${(100 - pct).toFixed(0)}% remaining</span>
      </div>

      <!-- Stat chips -->
      <div class="wallet-chips">
        <div class="wallet-chip">
          <div class="chip-label">Earned</div>
          <div class="chip-value text-income">₹${formatNum(s.total_earned)}</div>
        </div>
        <div class="wallet-chip">
          <div class="chip-label">Spent</div>
          <div class="chip-value text-expense">₹${formatNum(s.total_spent)}</div>
        </div>
        <div class="wallet-chip">
          <div class="chip-label">Balance</div>
          <div class="chip-value" style="color:${remColor}">₹${formatNum(Math.abs(s.remaining))}</div>
        </div>
      </div>

      <!-- Income transactions for this source -->
      <div class="wallet-tx-section">
        <div class="wallet-tx-header">
          <span class="wallet-tx-title">💚 Income Transactions</span>
          <span class="wallet-tx-total text-income">₹${formatNum(s.total_earned)}</span>
        </div>
        <div class="table-wrapper" style="margin-top:8px">
          <table>
            <thead><tr><th>Date</th><th>Description</th><th>Category</th><th>Amount</th></tr></thead>
            <tbody>${txRows(incTxs, 'income')}</tbody>
          </table>
        </div>
      </div>

      <!-- Expense transactions tagged to this source -->
      <div class="wallet-tx-section">
        <div class="wallet-tx-header">
          <span class="wallet-tx-title">🔴 Expenses Paid from ${escHtml(s.source)}</span>
          <span class="wallet-tx-total text-expense">₹${formatNum(s.total_spent)}</span>
        </div>
        <div class="table-wrapper" style="margin-top:8px">
          <table>
            <thead><tr><th>Date</th><th>Description</th><th>Category</th><th>Amount</th></tr></thead>
            <tbody>${txRows(expTxs, 'expense')}</tbody>
          </table>
        </div>
      </div>

    </div>`;
  }).join('');

  // Render mini donut charts after DOM is updated
  requestAnimationFrame(() => {
    sources.forEach((s, i) => {
      const col   = SOURCE_PALETTE[i % SOURCE_PALETTE.length];
      const srcId = s.source.replace(/\s+/g, '-').toLowerCase();
      const ctx   = document.getElementById(`donut-${srcId}`);
      if (!ctx) return;
      _sourceCharts[s.source] = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: ['Remaining', 'Spent'],
          datasets: [{
            data: [Math.max(0, s.remaining), s.total_spent],
            backgroundColor: [col.accent, 'rgba(244,63,94,0.6)'],
            borderColor: ['rgba(0,0,0,0.3)', 'rgba(0,0,0,0.3)'],
            borderWidth: 2,
            hoverOffset: 4,
          }],
        },
        options: {
          responsive: false,
          cutout: '70%',
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: c => ' ₹' + formatNum(c.raw) } },
          },
          animation: { duration: 800, easing: 'easeInOutQuart' },
        },
      });
    });
  });
}

// ─── Chart base options ───────────────────────────────────────
function chartOptions(overrides = {}) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 900, easing: 'easeInOutQuart' },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: 'rgba(15,22,41,0.95)',
        titleColor: '#f1f5f9',
        bodyColor:  '#94a3b8',
        borderColor: 'rgba(255,255,255,0.1)',
        borderWidth: 1,
        padding: 12,
        callbacks: { label: ctx => ` ₹${formatNum(ctx.raw)}` },
      },
      ...((overrides.plugins) || {}),
    },
    ...overrides,
    plugins: { ...((overrides.plugins) || {}) },
  };
}

// ─── Utility helpers ──────────────────────────────────────────
function currentMonthStr() {
  return new Date().toISOString().slice(0, 7); // "YYYY-MM"
}

function formatMonthLabel(ym) {
  if (!ym) return '';
  const [y, m] = ym.split('-');
  return new Date(+y, +m - 1, 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' });
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatNum(n) {
  if (n === undefined || n === null) return '0';
  const num = Math.abs(Number(n));
  if (num >= 10000000) return (num / 10000000).toFixed(2) + ' Cr';
  if (num >= 100000)   return (num / 100000).toFixed(2)   + ' L';
  return num.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function animateCounter(id, target, currency = false) {
  const el = document.getElementById(id);
  if (!el) return;
  const duration = 900;
  const start    = performance.now();
  const isNeg    = target < 0;
  const absTarget = Math.abs(target);

  function update(now) {
    const progress = Math.min((now - start) / duration, 1);
    const ease     = 1 - Math.pow(1 - progress, 3);
    const val      = absTarget * ease;
    el.textContent = (currency ? (isNeg ? '−₹' : '₹') : '') + formatNum(val);
    if (progress < 1) requestAnimationFrame(update);
  }
  requestAnimationFrame(update);
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3700);
}

// Keyboard shortcut: Escape closes modal
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
});

// =============================================================
//  YEARLY REPORT PAGE
// =============================================================

let _activeDownloadYear = null;
let yearDetailChartInst = null;

async function loadYearlyPage() {
  const data = await api('/api/reports/yearly');
  if (!data) return;
  renderYearCards(data.years);
}

function renderYearCards(years) {
  const grid = document.getElementById('year-cards-grid');
  if (!grid) return;

  if (!years || years.length === 0) {
    grid.innerHTML = `<div class="glass" style="padding:48px;text-align:center;grid-column:1/-1">
      <div class="empty-state-icon">🗓️</div><p>No yearly data yet. Add some transactions!</p></div>`;
    return;
  }

  grid.innerHTML = years.map(y => {
    const net = y.net;
    const netColor = net >= 0 ? 'var(--income-light)' : 'var(--expense-light)';
    const savings  = y.total_income > 0 ? ((net / y.total_income) * 100).toFixed(1) : '0.0';
    return `<div class="glass month-card" onclick="openYearDetail('${y.year}')" tabindex="0" role="button" aria-label="View ${y.year} annual report">
      <div class="month-card-title">📅 ${y.year}</div>
      <div class="month-card-stats">
        <div class="month-stat-row"><span class="label">Total Income</span><span class="text-income">₹${formatNum(y.total_income)}</span></div>
        <div class="month-stat-row"><span class="label">Total Expenses</span><span class="text-expense">₹${formatNum(y.total_expense)}</span></div>
        <div class="month-stat-row"><span class="label">Transactions</span><span>${y.transaction_count}</span></div>
        <div class="month-stat-row"><span class="label">Savings Rate</span><span style="color:var(--primary-light)">${savings}%</span></div>
        <div class="month-net-row">
          <span>Net Balance</span>
          <span style="color:${netColor}">${net >= 0 ? '+' : ''}₹${formatNum(net)}</span>
        </div>
      </div>
    </div>`;
  }).join('');
}

async function openYearDetail(year) {
  const data = await api(`/api/reports/yearly/${year}`);
  if (!data) return;

  const { summary, byMonth, byCategory, transactions } = data;
  _activeDownloadYear = year;

  setText('detail-year-title', `${year} — Annual Report`);
  setText('detail-year-income',  '₹' + formatNum(summary.total_income  || 0));
  setText('detail-year-expense', '₹' + formatNum(summary.total_expense || 0));

  const net   = summary.net || 0;
  const netEl = document.getElementById('detail-year-net');
  if (netEl) {
    netEl.textContent = (net >= 0 ? '+' : '') + '₹' + formatNum(net);
    netEl.style.color = net >= 0 ? 'var(--income-light)' : 'var(--expense-light)';
  }

  // Render month-by-month bar chart
  const ctx = document.getElementById('yearDetailChart');
  if (ctx) {
    if (yearDetailChartInst) yearDetailChartInst.destroy();
    yearDetailChartInst = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: byMonth.map(m => formatMonthLabel(m.month)),
        datasets: [
          { label: 'Income',  data: byMonth.map(m => m.total_income),  backgroundColor: 'rgba(16,185,129,0.75)', borderColor: '#10b981', borderWidth: 2, borderRadius: 6, borderSkipped: false },
          { label: 'Expense', data: byMonth.map(m => m.total_expense), backgroundColor: 'rgba(244,63,94,0.75)',  borderColor: '#f43f5e', borderWidth: 2, borderRadius: 6, borderSkipped: false },
        ],
      },
      options: chartOptions({
        plugins: { legend: { display: true, labels: { color: '#94a3b8', font: { family: 'Inter', size: 12 } } } },
        scales: {
          x: { ticks: { color: '#475569', maxRotation: 45 }, grid: { color: 'rgba(255,255,255,0.05)' } },
          y: { ticks: { color: '#475569', callback: v => '₹' + formatNum(v) }, grid: { color: 'rgba(255,255,255,0.06)' } },
        },
      }),
    });
  }

  // Monthly summary table with per-month CSV download buttons
  const tbody = document.getElementById('year-month-tbody');
  if (tbody) {
    tbody.innerHTML = byMonth.map(m => {
      const [y2, mo] = m.month.split('-');
      const netColor = m.net >= 0 ? 'var(--income-light)' : 'var(--expense-light)';
      return `<tr>
        <td><strong>${formatMonthLabel(m.month)}</strong></td>
        <td class="text-income">₹${formatNum(m.total_income)}</td>
        <td class="text-expense">₹${formatNum(m.total_expense)}</td>
        <td style="color:${netColor};font-weight:700">${m.net >= 0 ? '+' : ''}₹${formatNum(m.net)}</td>
        <td>${m.transaction_count}</td>
        <td><a href="/api/download/monthly/${y2}/${mo}?_token=${token}" onclick="downloadWithAuth(event,'/api/download/monthly/${y2}/${mo}','finflow_${m.month}.csv')" class="btn btn-ghost btn-sm">⬇ CSV</a></td>
      </tr>`;
    }).join('');
  }

  // Category bars for the year
  const expenses = byCategory.filter(c => c.type === 'expense');
  const catContainer = document.getElementById('year-cat-bars');
  const palette = ['#7c3aed','#f43f5e','#10b981','#f59e0b','#3b82f6','#ec4899','#14b8a6','#f97316'];
  if (catContainer) {
    if (!expenses.length) {
      catContainer.innerHTML = '<p class="text-muted" style="font-size:0.85rem">No expense categories for this year.</p>';
    } else {
      const maxVal = expenses[0].total || 1;
      catContainer.innerHTML = expenses.map((c, i) => `
        <div style="margin-bottom:16px">
          <div class="flex-between" style="margin-bottom:6px">
            <span style="font-size:0.85rem;font-weight:500">${escHtml(c.category)}</span>
            <span style="font-size:0.85rem;font-weight:700;color:${palette[i % palette.length]}">₹${formatNum(c.total)}</span>
          </div>
          <div class="progress-bar-wrap">
            <div class="progress-bar-fill" style="width:${(c.total / maxVal * 100).toFixed(1)}%;background:${palette[i % palette.length]};transition:width 1s ease ${i * 0.06}s"></div>
          </div>
        </div>`).join('');
    }
  }

  // Highlight selected year card
  document.querySelectorAll('.month-card').forEach(c => c.classList.remove('selected'));
  document.querySelectorAll('#year-cards-grid .month-card').forEach(c => {
    if (c.textContent.includes(year)) c.classList.add('selected');
  });

  document.getElementById('year-detail').classList.remove('hidden');
  document.getElementById('year-detail').scrollIntoView({ behavior: 'smooth' });
}

function closeYearDetail() {
  document.getElementById('year-detail').classList.add('hidden');
  document.querySelectorAll('#year-cards-grid .month-card').forEach(c => c.classList.remove('selected'));
  _activeDownloadYear = null;
  if (yearDetailChartInst) { yearDetailChartInst.destroy(); yearDetailChartInst = null; }
}

// =============================================================
//  DOWNLOAD HELPERS
// =============================================================

// Download monthly CSV for the currently open month detail
function downloadMonthlyCSV() {
  if (!_activeDownloadMonth) return;
  const [y, m] = _activeDownloadMonth.split('-');
  downloadWithAuth(null, `/api/download/monthly/${y}/${m}`, `finflow_${_activeDownloadMonth}.csv`);
}

// Download yearly CSV for the currently open year detail
function downloadYearlyCSV() {
  if (!_activeDownloadYear) return;
  downloadWithAuth(null, `/api/download/yearly/${_activeDownloadYear}`, `finflow_${_activeDownloadYear}_annual.csv`);
}

// Authenticated file download via hidden anchor
function downloadWithAuth(event, url, filename) {
  if (event) event.preventDefault();
  fetch(`${API_BASE_URL}${url}`, { headers: { 'Authorization': `Bearer ${token}` } })
    .then(r => r.blob())
    .then(blob => {
      const a   = document.createElement('a');
      a.href    = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
      showToast('Report downloaded!', 'success');
    })
    .catch(() => showToast('Download failed. Please try again.', 'error'));
}

// Print / Save as PDF — opens a print-friendly view of a section
function printReport(sectionId) {
  const section = document.getElementById(sectionId);
  if (!section) return;

  const printWin = window.open('', '_blank', 'width=900,height=700');
  printWin.document.write(`<!DOCTYPE html><html><head>
    <meta charset="UTF-8">
    <title>FinFlow Report</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 32px; color: #111; background: #fff; }
      h3   { margin-bottom: 8px; }
      table { width: 100%; border-collapse: collapse; margin-top: 16px; }
      th, td { padding: 10px 12px; border: 1px solid #ddd; text-align: left; font-size: 13px; }
      th { background: #f5f5f5; font-weight: 700; }
      .text-income  { color: #059669; font-weight: 700; }
      .text-expense { color: #dc2626; font-weight: 700; }
      .badge { padding: 3px 10px; border-radius: 12px; font-size: 12px; font-weight: 600; }
      .badge-income  { background: #d1fae5; color: #065f46; }
      .badge-expense { background: #fee2e2; color: #991b1b; }
      .summary-grid { display: flex; gap: 24px; margin: 16px 0; }
      .summary-box  { flex: 1; border: 2px solid #e5e7eb; border-radius: 10px; padding: 16px; }
      .summary-label { font-size: 11px; color: #6b7280; text-transform: uppercase; margin-bottom: 6px; }
      .summary-val   { font-size: 1.6rem; font-weight: 800; }
      @media print { body { padding: 16px; } }
    </style>
  </head><body>
    <p style="color:#6b7280;margin-bottom:4px">FinFlow Financial Report</p>
    <p style="color:#6b7280;font-size:12px">Generated: ${new Date().toLocaleString('en-IN')}</p>
    <hr style="margin:16px 0">
      ${section.innerHTML}
    <script>window.onload=()=>window.print();<\/script>
  </body></html>`);
  printWin.document.close();
}

// ═══════════════════════════════════════════════════════════════
//  AUTOMATIONS PAGE
// ═══════════════════════════════════════════════════════════════

async function loadAutomations() {
  const data = await api('/api/settings/notifications');
  if (!data || !data.settings) return;
  const s = data.settings;

  // Email toggles
  const notifEl = document.getElementById('notif-email');
  if (notifEl) notifEl.value = s.notify_email || '';
  setToggle('tog-monthly', s.monthly_report !== 0);
  setToggle('tog-daily',   s.daily_digest   === 1);
  setToggle('tog-budget',  s.budget_alert   !== 0);

  // Global budget
  const gbEl = document.getElementById('global-budget');
  if (gbEl) gbEl.value = s.global_budget || '';

  // Bank parser
  setToggle('tog-bank', s.bank_parser === 1);
  const imapUserEl = document.getElementById('imap-user');
  if (imapUserEl) imapUserEl.value = s.imap_user || '';

  // Status
  const statusEl = document.getElementById('bank-status');
  if (statusEl && s.bank_last_polled) {
    statusEl.textContent = `Last polled: ${new Date(s.bank_last_polled).toLocaleString('en-IN')} · ${s.bank_last_count || 0} transactions imported`;
  }

  // Populate category dropdowns
  populateAutoCategorySelects();

  await loadBudgetCaps();
  await loadRecurring();
  updateRecCategoryOptions();
}

function setToggle(id, val) {
  const el = document.getElementById(id);
  if (el) el.checked = !!val;
}

function populateAutoCategorySelects() {
  const expCats = CATEGORIES.expense;
  const allCats = [...CATEGORIES.income, ...CATEGORIES.expense];

  const budgetCatSel = document.getElementById('budget-cat');
  if (budgetCatSel) {
    budgetCatSel.innerHTML = expCats.map(c => `<option value="${c}">${c}</option>`).join('');
  }

  updateRecCategoryOptions();
}

function updateRecCategoryOptions() {
  const type = document.getElementById('rec-type')?.value || 'income';
  const sel  = document.getElementById('rec-cat');
  if (!sel) return;
  sel.innerHTML = CATEGORIES[type].map(c => `<option value="${c}">${c}</option>`).join('');
}

// ── Save notification toggles ────────────────────────────────────
async function saveNotifSettings() {
  const notifyEmail   = document.getElementById('notif-email')?.value.trim() || null;
  const monthly_report = document.getElementById('tog-monthly')?.checked ? 1 : 0;
  const daily_digest   = document.getElementById('tog-daily')?.checked   ? 1 : 0;
  const budget_alert   = document.getElementById('tog-budget')?.checked  ? 1 : 0;

  await api('/api/settings/notifications', {
    method: 'PUT',
    body: JSON.stringify({ notify_email: notifyEmail, monthly_report, daily_digest, budget_alert }),
  });
  showToast('Notification settings saved', 'success');
}

// ── Save global budget ────────────────────────────────────────────
async function saveGlobalBudget() {
  const val = parseFloat(document.getElementById('global-budget')?.value);
  if (isNaN(val) || val <= 0) {
    showToast('Enter a valid amount', 'error'); return;
  }
  await api('/api/settings/notifications', {
    method: 'PUT',
    body: JSON.stringify({ global_budget: val }),
  });
  showToast(`Global budget set to ₹${formatNum(val)}`, 'success');
}

// ── Save bank IMAP settings ───────────────────────────────────────
async function saveBankSettings() {
  const bank_parser = document.getElementById('tog-bank')?.checked ? 1 : 0;
  const imap_user   = document.getElementById('imap-user')?.value.trim() || null;
  const imap_pass   = document.getElementById('imap-pass')?.value || null;

  await api('/api/settings/notifications', {
    method: 'PUT',
    body: JSON.stringify({ bank_parser, imap_user, imap_pass }),
  });
  showToast('Bank settings saved', 'success');
}

// ── Test email ────────────────────────────────────────────────────
async function sendTestEmail() {
  const btn = document.getElementById('btn-test-email');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
  // Save current email first
  const notifyEmail = document.getElementById('notif-email')?.value.trim() || null;
  await api('/api/settings/notifications', {
    method: 'PUT',
    body: JSON.stringify({ notify_email: notifyEmail }),
  });
  const data = await api('/api/settings/test-email', { method: 'POST', body: JSON.stringify({}) });
  if (btn) { btn.disabled = false; btn.textContent = '📨 Test'; }
  if (data?.success) showToast('✅ ' + data.message, 'success');
  else               showToast('❌ ' + (data?.error || 'Failed'), 'error');
}

// ── Budget caps ───────────────────────────────────────────────────
async function loadBudgetCaps() {
  const data = await api('/api/budgets');
  if (!data) return;
  const list = document.getElementById('budget-caps-list');
  if (!list) return;
  if (!data.budgets || data.budgets.length === 0) {
    list.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:0.85rem">No budget caps set. Add one above.</div>`;
    return;
  }
  list.innerHTML = data.budgets.map(b => `
    <div class="budget-cap-row">
      <div>
        <div class="cap-name">${escHtml(b.category)}</div>
      </div>
      <div style="display:flex;align-items:center;gap:12px">
        <div class="cap-amt">₹${formatNum(b.amount)}/mo</div>
        <button class="td-delete" onclick="deleteBudgetCap(${b.id})" title="Remove">🗑</button>
      </div>
    </div>`).join('');
}

function showAddBudgetForm() {
  document.getElementById('add-budget-form').style.display = '';
  document.getElementById('budget-cat').focus();
}

async function addBudgetCap() {
  const category = document.getElementById('budget-cat')?.value;
  const amount   = parseFloat(document.getElementById('budget-amt')?.value);
  if (!category || isNaN(amount) || amount <= 0) {
    showToast('Select a category and enter a valid amount', 'error'); return;
  }
  const data = await api('/api/budgets', { method: 'POST', body: JSON.stringify({ category, amount }) });
  if (data?.budget) {
    document.getElementById('add-budget-form').style.display = 'none';
    document.getElementById('budget-amt').value = '';
    showToast(`Budget cap set: ${category} → ₹${formatNum(amount)}/mo`, 'success');
    await loadBudgetCaps();
  }
}

async function deleteBudgetCap(id) {
  if (!confirm('Remove this budget cap?')) return;
  await api(`/api/budgets/${id}`, { method: 'DELETE' });
  showToast('Budget cap removed', 'success');
  await loadBudgetCaps();
}

// ── Recurring Transactions ────────────────────────────────────────
async function loadRecurring() {
  const data = await api('/api/recurring');
  if (!data) return;
  const list = document.getElementById('recurring-list');
  if (!list) return;
  if (!data.recurring || data.recurring.length === 0) {
    list.innerHTML = `<div style="text-align:center;padding:24px;color:var(--text-muted);font-size:0.85rem">No recurring transactions set up yet.</div>`;
    return;
  }
  list.innerHTML = data.recurring.map(r => {
    const badge = r.type === 'income'
      ? `<span class="rec-badge-income">Income</span>`
      : `<span class="rec-badge-expense">Expense</span>`;
    const inactive = r.active ? '' : 'rec-inactive';
    const lastRun  = r.last_run ? `Last run: ${formatDate(r.last_run.slice(0,10))}` : 'Never run';
    return `
      <div class="recurring-row ${inactive}">
        <div style="flex:1">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
            ${badge}
            <span class="rec-desc">${escHtml(r.description || r.category)}</span>
          </div>
          <div class="rec-meta">${escHtml(r.category)} · ₹${formatNum(r.amount)} · Day ${r.day_of_month} of month · ${lastRun}</div>
        </div>
        <div style="display:flex;gap:8px;flex-shrink:0">
          <button class="btn btn-ghost btn-sm" onclick="toggleRecurring(${r.id}, ${r.active ? 0 : 1})">${r.active ? '⏸ Pause' : '▶ Resume'}</button>
          <button class="td-delete" onclick="deleteRecurring(${r.id})" title="Delete">🗑</button>
        </div>
      </div>`;
  }).join('');
}

function showAddRecurringForm() {
  document.getElementById('add-recurring-form').style.display = '';
  updateRecCategoryOptions();
}

async function addRecurring() {
  const type        = document.getElementById('rec-type')?.value;
  const category    = document.getElementById('rec-cat')?.value;
  const amount      = parseFloat(document.getElementById('rec-amt')?.value);
  const description = document.getElementById('rec-desc')?.value.trim();
  const day_of_month = parseInt(document.getElementById('rec-day')?.value) || 1;

  if (!type || !category || isNaN(amount) || amount <= 0) {
    showToast('Fill in all required fields', 'error'); return;
  }

  const data = await api('/api/recurring', {
    method: 'POST',
    body: JSON.stringify({ type, category, amount, description, day_of_month }),
  });

  if (data?.recurring) {
    document.getElementById('add-recurring-form').style.display = 'none';
    showToast(`Recurring transaction saved: ${description || category}`, 'success');
    await loadRecurring();
  }
}

async function toggleRecurring(id, active) {
  await api(`/api/recurring/${id}`, { method: 'PUT', body: JSON.stringify({ active }) });
  showToast(active ? 'Recurring resumed' : 'Recurring paused', 'success');
  await loadRecurring();
}

async function deleteRecurring(id) {
  if (!confirm('Delete this recurring transaction?')) return;
  await api(`/api/recurring/${id}`, { method: 'DELETE' });
  showToast('Recurring transaction deleted', 'success');
  await loadRecurring();
}

// ── Manual job triggers ───────────────────────────────────────────
async function triggerMonthlyReport() {
  const btn = document.getElementById('btn-trigger-monthly');
  if (btn) { btn.disabled = true; btn.textContent = 'Running…'; }
  const data = await api('/api/debug/run-monthly-report', { method: 'POST', body: JSON.stringify({}) });
  if (btn) { btn.disabled = false; btn.textContent = '▶ Run Monthly Report Now'; }
  if (data?.success) showToast('Monthly report job completed', 'success');
  else               showToast('Report job failed: ' + (data?.error || 'unknown'), 'error');
}

async function triggerDailyDigest() {
  const btn = document.getElementById('btn-trigger-daily');
  if (btn) { btn.disabled = true; btn.textContent = 'Running…'; }
  const data = await api('/api/debug/run-daily-digest', { method: 'POST', body: JSON.stringify({}) });
  if (btn) { btn.disabled = false; btn.textContent = '▶ Run Daily Digest Now'; }
  if (data?.success) showToast('Daily digest sent', 'success');
  else               showToast('Digest failed: ' + (data?.error || 'unknown'), 'error');
}

async function triggerBankPoller() {
  const btn = document.getElementById('btn-poll-now');
  if (btn) { btn.disabled = true; btn.textContent = 'Polling…'; }
  const data = await api('/api/debug/run-bank-poller', { method: 'POST', body: JSON.stringify({}) });
  if (btn) { btn.disabled = false; btn.textContent = '▶ Poll Now'; }
  if (data?.success) {
    showToast('Bank email poll complete', 'success');
    await loadAutomations(); // refresh status
  } else {
    showToast('Poll failed: ' + (data?.error || 'unknown'), 'error');
  }
}

// ═══════════════════════════════════════════════════════════════
//  BANK LINKING PAGE FUNCTIONS
// ═══════════════════════════════════════════════════════════════

async function loadBankPage() {
  const data = await api('/api/settings/notifications');
  if (!data || !data.settings) return;
  const s = data.settings;

  // Active status toggle
  const togActive = document.getElementById('bank-tog-active');
  if (togActive) togActive.checked = s.bank_parser === 1;

  // Gmail Address
  const userEl = document.getElementById('bank-imap-user');
  if (userEl) userEl.value = s.imap_user || '';

  // Password placeholder
  const passEl = document.getElementById('bank-imap-pass');
  if (passEl) passEl.value = '';

  // Status
  const statusEl = document.getElementById('bank-page-status');
  if (statusEl) {
    if (s.bank_last_polled) {
      statusEl.textContent = `Last synced: ${new Date(s.bank_last_polled).toLocaleString('en-IN')} · ${s.bank_last_count || 0} transactions imported`;
    } else {
      statusEl.textContent = 'Never synced';
    }
  }

  // Update bank connection visual cards based on status
  const hasCreds = !!(s.imap_user && s.imap_configured);
  const active = s.bank_parser === 1 && hasCreds;
  
  const banks = ['hdfc', 'sbi', 'icici', 'axis', 'kotak', 'paytm'];
  banks.forEach(b => {
    const card = document.getElementById(`bank-card-${b}`);
    const status = document.getElementById(`bank-status-${b}`);
    if (card && status) {
      if (active) {
        card.style.borderColor = 'rgba(16,185,129,0.3)';
        card.style.background = 'rgba(16,185,129,0.03)';
        status.textContent = 'Linked & Active';
        status.style.color = 'var(--income-light)';
      } else if (hasCreds) {
        card.style.borderColor = 'rgba(245,158,11,0.2)';
        card.style.background = 'rgba(245,158,11,0.02)';
        status.textContent = 'Paused';
        status.style.color = '#f59e0b';
      } else {
        card.style.borderColor = 'rgba(255,255,255,0.05)';
        card.style.background = 'rgba(255,255,255,0.02)';
        status.textContent = 'Not Linked';
        status.style.color = 'var(--text-muted)';
      }
    }
  });
}

// Bank page save settings
async function saveBankPageSettings(showToastMsg = false) {
  const bank_parser = document.getElementById('bank-tog-active')?.checked ? 1 : 0;
  const imap_user   = document.getElementById('bank-imap-user')?.value.trim() || null;
  const imap_pass   = document.getElementById('bank-imap-pass')?.value || null;

  const bodyObj = { bank_parser, imap_user };
  if (imap_pass) bodyObj.imap_pass = imap_pass;

  await api('/api/settings/notifications', {
    method: 'PUT',
    body: JSON.stringify(bodyObj),
  });
  
  if (showToastMsg) {
    showToast('Bank settings updated successfully', 'success');
  }
  await loadBankPage();
}

// Bank page manually trigger poller
async function triggerBankPagePoller() {
  const btn = document.getElementById('btn-bank-poll-now');
  if (btn) { btn.disabled = true; btn.textContent = 'Syncing…'; }
  const data = await api('/api/debug/run-bank-poller', { method: 'POST', body: JSON.stringify({}) });
  if (btn) { btn.disabled = false; btn.textContent = '▶ Sync Now'; }
  if (data?.success) {
    showToast('Bank email synchronization complete', 'success');
    await loadBankPage();
  } else {
    showToast('Synchronization failed: ' + (data?.error || 'unknown'), 'error');
  }
}

// Drag & drop bank statement parsing
let _importedTransactions = [];

function handleStatementDrop(e) {
  e.preventDefault();
  const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (file) processStatementFile(file);
}

function handleStatementFile(e) {
  const file = e.target && e.target.files && e.target.files[0];
  if (file) processStatementFile(file);
}

function resetStatementUpload() {
  _importedTransactions = [];
  document.getElementById('statement-import-results').classList.add('hidden');
  document.getElementById('bank-statement-dropzone').classList.remove('hidden');
  document.getElementById('statement-file-input').value = '';
}

async function processStatementFile(file) {
  if (!file.name.endsWith('.csv')) {
    showToast('Please upload a CSV file bank statement', 'error');
    return;
  }

  const dropzone = document.getElementById('bank-statement-dropzone');
  const loader = document.getElementById('statement-importing');
  const results = document.getElementById('statement-import-results');

  if (dropzone) dropzone.classList.add('hidden');
  if (loader) loader.classList.remove('hidden');
  if (results) results.classList.add('hidden');

  try {
    const formData = new FormData();
    formData.append('statement', file);

    const r = await fetch(API_BASE_URL + '/api/bank/import-statement', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token },
      body: formData,
    });
    
    const data = await r.json();
    if (loader) loader.classList.add('hidden');

    if (!data || data.error || !data.transactions) {
      showToast('Import failed: ' + (data && data.error ? data.error : 'unknown'), 'error');
      if (dropzone) dropzone.classList.remove('hidden');
      return;
    }

    _importedTransactions = data.transactions;
    
    // Render preview table
    const tbody = document.getElementById('statement-tbody');
    const successCount = document.getElementById('statement-success-count');
    if (successCount) successCount.textContent = `${_importedTransactions.length} transaction(s) ready`;

    if (tbody) {
      tbody.innerHTML = _importedTransactions.map(t => {
        const netColor = t.type === 'income' ? 'var(--income-light)' : 'var(--expense-light)';
        return `<tr style="border-bottom: 1px solid var(--border); font-size: 0.75rem;">
          <td style="padding: 6px 8px;">${t.date}</td>
          <td style="padding: 6px 8px; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escHtml(t.description)}</td>
          <td style="padding: 6px 8px;"><span class="badge badge-${t.type}">${t.type}</span></td>
          <td style="padding: 6px 8px;"><span class="badge badge-${t.type}">${escHtml(t.category)}</span></td>
          <td style="padding: 6px 8px; text-align: right; color: ${netColor}; font-weight: bold;">₹${formatNum(t.amount)}</td>
        </tr>`;
      }).join('');
    }

    if (results) results.classList.remove('hidden');

  } catch (err) {
    if (loader) loader.classList.add('hidden');
    if (dropzone) dropzone.classList.remove('hidden');
    showToast('Failed to upload statement: ' + err.message, 'error');
  }
}

async function confirmImportedStatement() {
  if (!_importedTransactions || _importedTransactions.length === 0) return;
  
  const saveBtn = document.querySelector('#statement-import-results button');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }

  try {
    const data = await api('/api/bank/confirm-statement', {
      method: 'POST',
      body: JSON.stringify({ transactions: _importedTransactions }),
    });

    if (data && data.success) {
      showToast(`Imported ${data.count} transactions!`, 'success');
      resetStatementUpload();
      await loadDashboard();
    } else {
      showToast('Save failed: ' + (data && data.error ? data.error : 'unknown'), 'error');
    }
  } catch (err) {
    showToast('Network error saving transactions', 'error');
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '✅ Save All Transactions'; }
  }
}

// ═══════════════════════════════════════════════════════════════
//  AI QUICK-LOG
// ═══════════════════════════════════════════════════════════════

let _aiResult = null;

async function sendAiQuickLog() {
  const input = document.getElementById('ai-quicklog-input');
  const text  = input?.value.trim();
  if (!text || text.length < 3) { showToast('Please type something first', 'error'); return; }

  const sendBtn = document.getElementById('ai-send-btn');
  if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = '⏳'; }

  try {
    const data = await api('/api/ai/log-from-text', {
      method: 'POST',
      body: JSON.stringify({ text }),
    });

    if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = '↵'; }

    if (!data || data.error) {
      showToast('AI could not parse: ' + (data?.error || 'unknown'), 'error');
      return;
    }

    _aiResult = data.result;
    showAiPreview(data.result);
    if (input) input.value = '';

  } catch (err) {
    if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = '↵'; }
    showToast('Network error', 'error');
  }
}

function handleAiInputKey(e) {
  if (e.key === 'Enter') sendAiQuickLog();
}

function showAiPreview(result) {
  const card = document.getElementById('ai-preview-card');
  if (!card) return;

  const conf = result.confidence || 'medium';
  const confColor = conf === 'high' ? 'var(--income-light)' : conf === 'medium' ? '#f59e0b' : 'var(--expense-light)';

  const badge = document.getElementById('ai-preview-confidence');
  if (badge) {
    badge.textContent = conf.toUpperCase() + ' confidence';
    badge.style.color = confColor;
    badge.style.border = '1px solid ' + confColor;
  }

  const fields = document.getElementById('ai-preview-fields');
  if (fields) {
    let warningHtml = '';
    if (result.source === 'fallback') {
      warningHtml = '<div class="ai-fallback-warning" style="background:rgba(245,158,11,0.1);color:#f59e0b;padding:8px 12px;border-radius:6px;font-size:0.8rem;margin-bottom:12px;border:1px solid rgba(245,158,11,0.25)">' +
        '⚠️ Running in offline fallback mode (invalid/missing API key).' +
        '</div>';
    }
    fields.innerHTML = warningHtml +
      '<div class="ai-field"><span class="ai-field-label">Type</span><span class="ai-field-value">' + escHtml(result.type || '—') + '</span></div>' +
      '<div class="ai-field"><span class="ai-field-label">Amount</span><span class="ai-field-value ' + result.type + '">₹' + formatNum(result.amount || 0) + '</span></div>' +
      '<div class="ai-field"><span class="ai-field-label">Category</span><span class="ai-field-value">' + escHtml(result.category || '—') + '</span></div>' +
      '<div class="ai-field"><span class="ai-field-label">Description</span><span class="ai-field-value">' + escHtml(result.description || '—') + '</span></div>' +
      '<div class="ai-field"><span class="ai-field-label">Date</span><span class="ai-field-value">' + escHtml(result.date || new Date().toISOString().split('T')[0]) + '</span></div>';
  }

  card.classList.remove('hidden');
}

function closeAiPreview() {
  const card = document.getElementById('ai-preview-card');
  if (card) card.classList.add('hidden');
  _aiResult = null;
}

async function confirmAiLog() {
  if (!_aiResult) return;
  const data = await api('/api/ai/confirm-log', {
    method: 'POST',
    body: JSON.stringify(_aiResult),
  });
  if (data && data.transaction) {
    showToast('AI transaction added!', 'success');
    closeAiPreview();
    await loadDashboard();
    if (document.getElementById('section-transactions') && document.getElementById('section-transactions').classList.contains('active')) loadTransactionsPage();
  } else {
    showToast('Failed to add: ' + (data && data.error ? data.error : 'unknown'), 'error');
  }
}

function editAiLog() {
  if (!_aiResult) return;
  openModal();
  selectedType = _aiResult.type || 'expense';
  setType(selectedType);
  var amtEl  = document.getElementById('tx-amount');
  var catEl  = document.getElementById('tx-category');
  var descEl = document.getElementById('tx-description');
  var dateEl = document.getElementById('tx-date');
  if (amtEl)  amtEl.value  = _aiResult.amount  || '';
  if (catEl)  catEl.value  = _aiResult.category || '';
  if (descEl) descEl.value = _aiResult.description || '';
  if (dateEl) dateEl.value = _aiResult.date || new Date().toISOString().split('T')[0];
  closeAiPreview();
}

var _recognition = null;
function toggleVoiceInput() {
  var micBtn = document.getElementById('ai-mic-btn');
  var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) { showToast('Voice input not supported in this browser', 'error'); return; }
  if (_recognition) {
    _recognition.stop(); _recognition = null;
    if (micBtn) { micBtn.textContent = '🎙'; micBtn.classList.remove('recording'); }
    return;
  }
  _recognition = new SpeechRecognition();
  _recognition.lang = 'en-IN';
  _recognition.interimResults = false;
  _recognition.onresult = function(e) {
    var text = e.results[0][0].transcript;
    var input = document.getElementById('ai-quicklog-input');
    if (input) input.value = text;
    sendAiQuickLog();
  };
  _recognition.onend = function() {
    _recognition = null;
    if (micBtn) { micBtn.textContent = '🎙'; micBtn.classList.remove('recording'); }
  };
  _recognition.onerror = function() {
    _recognition = null;
    if (micBtn) { micBtn.textContent = '🎙'; micBtn.classList.remove('recording'); }
    showToast('Voice recognition error', 'error');
  };
  _recognition.start();
  if (micBtn) { micBtn.textContent = '🔴'; micBtn.classList.add('recording'); }
}

// ═══════════════════════════════════════════════════════════════
//  RECEIPT SCANNER
// ═══════════════════════════════════════════════════════════════

var _receiptResult = null;

function openReceiptModal() {
  var overlay = document.getElementById('receipt-modal-overlay');
  if (overlay) overlay.classList.add('open');
  resetReceiptModal();
}

function closeReceiptModal() {
  var overlay = document.getElementById('receipt-modal-overlay');
  if (overlay) overlay.classList.remove('open');
  resetReceiptModal();
}

function resetReceiptModal() {
  _receiptResult = null;
  var res = document.getElementById('receipt-results');
  var scn = document.getElementById('receipt-scanning');
  var dz  = document.getElementById('receipt-dropzone');
  var fi  = document.getElementById('receipt-file-input');
  if (res) res.classList.add('hidden');
  if (scn) scn.classList.add('hidden');
  if (dz)  dz.classList.remove('hidden');
  if (fi)  fi.value = '';
}

function handleReceiptDrop(e) {
  e.preventDefault();
  var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (file) processReceiptFile(file);
}

function handleReceiptFile(e) {
  var file = e.target && e.target.files && e.target.files[0];
  if (file) processReceiptFile(file);
}

async function processReceiptFile(file) {
  if (!file.type.startsWith('image/')) { showToast('Please upload an image (JPG, PNG, WebP)', 'error'); return; }

  var dz  = document.getElementById('receipt-dropzone');
  var scn = document.getElementById('receipt-scanning');
  var res = document.getElementById('receipt-results');
  if (dz)  dz.classList.add('hidden');
  if (scn) scn.classList.remove('hidden');
  if (res) res.classList.add('hidden');

  try {
    var formData = new FormData();
    formData.append('receipt', file);
    var r = await fetch(API_BASE_URL + '/api/ai/scan-receipt', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token },
      body: formData,
    });
    var data = await r.json();
    if (scn) scn.classList.add('hidden');
    if (!data || !data.result) {
      showToast('Could not scan: ' + (data && data.error ? data.error : 'unknown'), 'error');
      if (dz) dz.classList.remove('hidden');
      return;
    }
    _receiptResult = data.result;
    showReceiptResults(data.result);
  } catch (err) {
    if (scn) scn.classList.add('hidden');
    if (dz)  dz.classList.remove('hidden');
    showToast('Receipt scan failed: ' + err.message, 'error');
  }
}

function showReceiptResults(result) {
  var vendorEl = document.getElementById('receipt-vendor');
  var dcEl     = document.getElementById('receipt-date-category');
  var taxEl    = document.getElementById('receipt-tax');
  var totalEl  = document.getElementById('receipt-total');
  if (vendorEl) vendorEl.textContent = result.vendor || 'Unknown Vendor';
  if (dcEl)     dcEl.textContent = (result.date || '—') + ' · ' + (result.category || 'Other Expense');
  if (taxEl)    taxEl.textContent = result.tax > 0 ? '₹' + formatNum(result.tax) : '—';
  if (totalEl)  totalEl.textContent = '₹' + formatNum(result.total || 0);

  var tbody = document.getElementById('receipt-items-tbody');
  if (tbody) {
    var items = result.items || [];
    tbody.innerHTML = items.length
      ? items.map(function(it) {
          return '<tr><td>' + escHtml(it.name || '—') + '</td><td>' + (it.qty || 1) + '</td><td>₹' + formatNum(it.unit_price || 0) + '</td><td>₹' + formatNum(it.total || 0) + '</td></tr>';
        }).join('')
      : '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:12px">No line items detected</td></tr>';
  }
  var res = document.getElementById('receipt-results');
  if (res) res.classList.remove('hidden');
}

async function confirmReceiptTransaction() {
  if (!_receiptResult) return;
  var data = await api('/api/transactions', {
    method: 'POST',
    body: JSON.stringify({
      type: 'expense',
      category: _receiptResult.category || 'Other Expense',
      amount: _receiptResult.total || 0,
      description: _receiptResult.vendor || 'Receipt scan',
      date: _receiptResult.date || new Date().toISOString().split('T')[0],
    }),
  });
  if (data && data.transaction) {
    showToast('Receipt transaction added!', 'success');
    closeReceiptModal();
    await loadDashboard();
    if (document.getElementById('section-transactions') && document.getElementById('section-transactions').classList.contains('active')) loadTransactionsPage();
  } else {
    showToast('Failed to add: ' + (data && data.error ? data.error : 'unknown'), 'error');
  }
}

function rescanReceipt() { resetReceiptModal(); }

// ═══════════════════════════════════════════════════════════════
//  CASH FLOW FORECAST PAGE
// ═══════════════════════════════════════════════════════════════

var _forecastChart = null;

async function loadCashFlowPage() {
  var data = await api('/api/forecast?months=6&history=6');
  if (!data) return;

  var avgIncome  = (data.historicalAvg && data.historicalAvg.income)  || 0;
  var avgExpense = (data.historicalAvg && data.historicalAvg.expense) || 0;
  var avgSavings = avgIncome - avgExpense;

  setText('fc-avg-income',  '₹' + formatNum(avgIncome));
  setText('fc-avg-expense', '₹' + formatNum(avgExpense));

  var savingsEl = document.getElementById('fc-avg-savings');
  if (savingsEl) {
    savingsEl.textContent = (avgSavings >= 0 ? '+' : '−') + '₹' + formatNum(Math.abs(avgSavings));
    savingsEl.style.color = avgSavings >= 0 ? 'var(--income-light)' : 'var(--expense-light)';
  }

  var dqEl = document.getElementById('fc-data-quality');
  if (dqEl) {
    var months = data.dataMonths || 0;
    dqEl.textContent = months + ' month' + (months !== 1 ? 's' : '') + ' of history';
    dqEl.style.color = months >= 3 ? 'var(--income-light)' : '#f59e0b';
  }

  if (data.trends) {
    var it = data.trends.income  >= 0 ? '+' + (data.trends.income  || 0).toFixed(1) + '%/mo' : (data.trends.income  || 0).toFixed(1) + '%/mo';
    var et = data.trends.expense >= 0 ? '+' + (data.trends.expense || 0).toFixed(1) + '%/mo' : (data.trends.expense || 0).toFixed(1) + '%/mo';
    setText('fc-income-trend',  'Income: ' + it);
    setText('fc-expense-trend', 'Expense: ' + et);
  }

  var forecast = data.forecast  || [];
  var history  = data.history   || [];
  var ctx = document.getElementById('forecastChart');
  if (ctx) {
    if (_forecastChart) _forecastChart.destroy();
    var histLabels = history.map(function(h)  { return formatMonthLabel(h.month); });
    var fcLabels   = forecast.map(function(f) { return formatMonthLabel(f.month); });
    var allLabels  = histLabels.concat(fcLabels);
    var histInc = history.map(function(h)  { return h.income; });
    var histExp = history.map(function(h)  { return h.expense; });
    var fcInc   = forecast.map(function(f) { return f.income; });
    var fcExp   = forecast.map(function(f) { return f.expense; });
    var nullPad = function(arr, len) { return new Array(len).fill(null).concat(arr); };

    _forecastChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: allLabels,
        datasets: [
          { label: 'Actual Income',    data: histInc.concat(new Array(fcLabels.length).fill(null)), borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.12)', borderWidth: 2.5, pointRadius: 4, fill: true, tension: 0.3 },
          { label: 'Actual Expense',   data: histExp.concat(new Array(fcLabels.length).fill(null)), borderColor: '#f43f5e', backgroundColor: 'rgba(244,63,94,0.08)',   borderWidth: 2.5, pointRadius: 4, fill: true, tension: 0.3 },
          { label: 'Forecast Income',  data: nullPad(fcInc, histLabels.length), borderColor: '#10b981', borderDash: [6,4], borderWidth: 2, pointRadius: 5, backgroundColor: 'rgba(16,185,129,0.04)', fill: false, tension: 0.3 },
          { label: 'Forecast Expense', data: nullPad(fcExp, histLabels.length), borderColor: '#f43f5e', borderDash: [6,4], borderWidth: 2, pointRadius: 5, backgroundColor: 'rgba(244,63,94,0.04)',   fill: false, tension: 0.3 },
        ],
      },
      options: chartOptions({
        plugins: { legend: { display: true, labels: { color: '#94a3b8', font: { family: 'Inter', size: 12 } } } },
        scales: {
          x: { ticks: { color: '#475569', maxRotation: 30 }, grid: { color: 'rgba(255,255,255,0.05)' } },
          y: { ticks: { color: '#475569', callback: function(v) { return '₹' + formatNum(v); } }, grid: { color: 'rgba(255,255,255,0.06)' } },
        },
      }),
    });
  }

  var tbody = document.getElementById('forecast-tbody');
  if (tbody) {
    var cumBalance = 0;
    tbody.innerHTML = forecast.map(function(f) {
      var net = (f.income || 0) - (f.expense || 0);
      cumBalance += net;
      var netColor = net >= 0 ? 'var(--income-light)' : 'var(--expense-light)';
      var balColor = cumBalance >= 0 ? 'var(--income-light)' : 'var(--expense-light)';
      var conf = f.confidence || 'low';
      var confColor = conf === 'high' ? 'var(--income-light)' : conf === 'medium' ? '#f59e0b' : 'var(--expense-light)';
      return '<tr>' +
        '<td><strong>' + formatMonthLabel(f.month) + '</strong></td>' +
        '<td class="text-income">₹' + formatNum(f.income || 0) + '</td>' +
        '<td class="text-expense">₹' + formatNum(f.expense || 0) + '</td>' +
        '<td style="color:' + netColor + ';font-weight:700">' + (net >= 0 ? '+' : '−') + '₹' + formatNum(Math.abs(net)) + '</td>' +
        '<td style="color:' + balColor + '">' + (cumBalance >= 0 ? '+' : '−') + '₹' + formatNum(Math.abs(cumBalance)) + '</td>' +
        '<td><span style="font-size:0.78rem;color:' + confColor + '">' + conf.toUpperCase() + '</span></td>' +
        '</tr>';
    }).join('');
  }

  if (data.idleCash && data.idleCash.length > 0) {
    var sec   = document.getElementById('idle-cash-section');
    var cards = document.getElementById('idle-cash-cards');
    if (sec) sec.classList.remove('hidden');
    if (cards) {
      cards.innerHTML = data.idleCash.map(function(ic) {
        return '<div class="glass auto-panel" style="margin-bottom:12px"><div class="auto-panel-header">' +
          '<div class="auto-panel-icon">💡</div>' +
          '<div><div class="auto-panel-title">' + escHtml(ic.source) + '</div><p class="auto-panel-sub">' + escHtml(ic.suggestion || 'Consider investing') + '</p></div>' +
          '<div style="margin-left:auto;font-size:1.2rem;font-weight:800;color:var(--income-light)">₹' + formatNum(ic.amount) + '</div>' +
          '</div></div>';
      }).join('');
    }
  }
}

async function runWasteScan() {
  var btn  = document.getElementById('btn-waste-scan');
  var body = document.getElementById('waste-scan-body');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Scanning…'; }
  if (body) body.innerHTML = '<div style="text-align:center;padding:24px"><div class="spinner" style="width:28px;height:28px;margin:0 auto 8px;border-width:3px"></div><p style="color:var(--text-muted);font-size:0.85rem">Analysing with AI…</p></div>';

  var data = await api('/api/ai/subscription-scan');
  if (btn) { btn.disabled = false; btn.textContent = '🔍 Scan Now'; }

  if (!data || data.error) {
    if (body) body.innerHTML = '<div style="text-align:center;padding:20px;color:var(--expense-light)">' + (data && data.error ? data.error : 'Scan failed') + '</div>';
    return;
  }

  var subscriptions = data.subscriptions || [];
  var wasteful      = data.wasteful      || [];
  var tips          = data.tips          || [];

  var html = '';
  if (subscriptions.length) {
    html += '<div style="margin-bottom:20px"><h4 style="margin-bottom:12px;font-size:0.9rem;color:var(--text-secondary)">🔁 Detected Subscriptions</h4>';
    subscriptions.forEach(function(s) {
      html += '<div class="budget-cap-row"><div><div class="cap-name">' + escHtml(s.name || s.category) + '</div><div style="font-size:0.78rem;color:var(--text-muted)">' + (s.frequency || 'recurring') + ' · ' + (s.count || 0) + ' transactions</div></div><div class="cap-amt text-expense">₹' + formatNum(s.totalSpent) + '</div></div>';
    });
    html += '</div>';
  }
  if (wasteful.length) {
    html += '<div style="margin-bottom:20px"><h4 style="margin-bottom:12px;font-size:0.9rem;color:var(--text-secondary)">⚠️ Potential Waste</h4>';
    wasteful.forEach(function(w) {
      html += '<div class="budget-cap-row"><div><div class="cap-name">' + escHtml(w.category) + '</div><div style="font-size:0.78rem;color:var(--text-muted)">' + escHtml(w.reason || '') + '</div></div><div class="cap-amt text-expense">₹' + formatNum(w.amount) + '</div></div>';
    });
    html += '</div>';
  }
  if (tips.length) {
    html += '<div><h4 style="margin-bottom:12px;font-size:0.9rem;color:var(--text-secondary)">💡 Savings Tips</h4>';
    tips.forEach(function(t) {
      html += '<div style="padding:10px 12px;border-radius:8px;background:rgba(124,58,237,0.07);margin-bottom:8px;font-size:0.85rem;color:var(--text-secondary)">' + escHtml(t) + '</div>';
    });
    html += '</div>';
  }
  if (!subscriptions.length && !wasteful.length && !tips.length) {
    html = '<div style="text-align:center;padding:24px;color:var(--income-light)">✅ No obvious waste or suspicious subscriptions detected!</div>';
  }
  if (body) body.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════════
//  TAX & EXPORT PAGE
// ═══════════════════════════════════════════════════════════════

async function loadTaxPage() {
  var data = await api('/api/tax/years');
  if (!data) return;

  var sel = document.getElementById('tax-fy-select');
  if (sel && data.years) {
    sel.innerHTML = '<option value="">Select Financial Year…</option>' +
      data.years.map(function(y) { return '<option value="' + escHtml(y) + '">' + escHtml(y) + '</option>'; }).join('');

    var now = new Date();
    var curFY = now.getMonth() >= 3
      ? now.getFullYear() + '-' + String(now.getFullYear() + 1).slice(-2)
      : (now.getFullYear() - 1) + '-' + String(now.getFullYear()).slice(-2);
    if (data.years.indexOf(curFY) !== -1) sel.value = curFY;
  }

  var exportYearSel = document.getElementById('export-year');
  if (exportYearSel && data.years) {
    var calYears = [];
    data.years.forEach(function(fy) {
      var y = parseInt(fy.split('-')[0]);
      if (calYears.indexOf(y) === -1) calYears.push(y);
      if (calYears.indexOf(y + 1) === -1) calYears.push(y + 1);
    });
    calYears.sort(function(a,b){return b-a;});
    exportYearSel.innerHTML = '<option value="">All time</option>' +
      calYears.map(function(y) { return '<option value="' + y + '">' + y + '</option>'; }).join('');
  }

  loadTaxReport();
}

async function loadTaxReport() {
  var fy = document.getElementById('tax-fy-select') && document.getElementById('tax-fy-select').value;
  if (!fy) return;

  var data = await api('/api/tax/report?fy=' + fy);
  if (!data || data.error) { showToast('Failed to load tax report: ' + (data && data.error ? data.error : 'unknown'), 'error'); return; }

  var sec = document.getElementById('tax-summary-section');
  if (sec) sec.classList.remove('hidden');

  setText('tax-total-income',     '₹' + formatNum(data.totalIncome || 0));
  setText('tax-deductible-total', '₹' + formatNum(data.totalDeductible || 0));
  setText('tax-saved',            '₹' + formatNum(data.estimatedTaxSaved || 0));
  setText('tax-tx-count',         data.transactionCount || 0);

  var secBody = document.getElementById('tax-sections-body');
  if (secBody) {
    var sections = data.sections || {};
    var entries = Object.entries(sections);
    secBody.innerHTML = entries.length
      ? entries.map(function(e) {
          return '<div class="budget-cap-row"><div><div class="cap-name">' + escHtml(e[0]) + '</div><div style="font-size:0.78rem;color:var(--text-muted)">' + sectionDesc(e[0]) + '</div></div><div class="cap-amt" style="color:var(--primary-light)">₹' + formatNum(e[1]) + '</div></div>';
        }).join('')
      : '<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:0.85rem">No deductible transactions for this FY.</div>';
  }

  var tbody = document.getElementById('tax-deductible-tbody');
  if (tbody) {
    var txs = data.deductibleTransactions || [];
    tbody.innerHTML = txs.length
      ? txs.map(function(t) {
          return '<tr><td>' + formatDate(t.date) + '</td><td><span class="badge badge-expense">' + escHtml(t.category) + '</span></td><td>' + escHtml(t.description || '—') + '</td><td><span style="font-size:0.78rem;color:var(--primary-light);font-weight:600">' + escHtml(t.taxSection || '—') + '</span></td><td class="text-expense">₹' + formatNum(t.amount) + '</td></tr>';
        }).join('')
      : '<tr><td colspan="5"><div class="empty-state"><p>No deductible transactions</p></div></td></tr>';
  }
}

function sectionDesc(sec) {
  var map = { '80C': 'LIC, PPF, ELSS, EPF, home loan principal', '80D': 'Health insurance premiums', 'HRA': 'House rent allowance', 'LTA': 'Leave travel allowance', '80E': 'Education loan interest', '80G': 'Charitable donations', '24B': 'Home loan interest', 'NPS': 'National Pension System (80CCD)' };
  return map[sec] || 'Tax-deductible expense';
}

async function exportData(format) {
  var year  = document.getElementById('export-year')  ? document.getElementById('export-year').value  : '';
  var month = document.getElementById('export-month') ? document.getElementById('export-month').value : '';
  var url = '/api/export/' + format;
  var params = [];
  if (year)  params.push('year='  + year);
  if (month) params.push('month=' + month);
  if (params.length) url += '?' + params.join('&');
  var extensions = { tally: 'xml', quickbooks: 'iif', zoho: 'csv', csv: 'csv', json: 'json' };
  downloadWithAuth(null, url, 'finflow_' + format + '_export.' + (extensions[format] || 'txt'));
}

// ═══════════════════════════════════════════════════════════════
//  SPEND POLICY PAGE
// ═══════════════════════════════════════════════════════════════

async function loadPolicyPage() {
  await Promise.all([loadPolicyFlags(), loadPolicyRules()]);
}

async function loadPolicyFlags() {
  var data = await api('/api/policy/flags');
  if (!data) return;
  var flags = data.flags || [];
  var badge = document.getElementById('flags-count-badge');
  if (badge) badge.textContent = flags.length ? '(' + flags.length + ')' : '';
  var body = document.getElementById('policy-flags-body');
  if (!body) return;
  body.innerHTML = flags.length
    ? flags.map(function(f) {
        return '<div class="budget-cap-row" style="' + (f.resolved ? 'opacity:0.5' : '') + '">' +
          '<div style="flex:1"><div class="cap-name">' + escHtml((f.rule_type || '').replace(/_/g, ' ')) + (f.category ? ' — ' + escHtml(f.category) : '') + '</div>' +
          '<div style="font-size:0.78rem;color:var(--text-muted)">' + escHtml(f.description || '') + ' · ' + formatDate((f.flagged_at || '').split('T')[0]) + '</div></div>' +
          '<div style="display:flex;align-items:center;gap:12px"><div class="cap-amt text-expense">₹' + formatNum(f.amount || 0) + '</div>' +
          (!f.resolved ? '<button class="btn btn-ghost btn-sm" onclick="resolveFlag(' + f.id + ')">✓ Resolve</button>' : '<span style="color:var(--income-light);font-size:0.78rem">Resolved</span>') +
          '</div></div>';
      }).join('')
    : '<div style="text-align:center;padding:24px;color:var(--income-light)">✅ No active flags</div>';
}

async function resolveFlag(flagId) {
  await api('/api/policy/flags/' + flagId + '/resolve', { method: 'PUT', body: JSON.stringify({}) });
  showToast('Flag resolved', 'success');
  await loadPolicyFlags();
}

async function loadPolicyRules() {
  var data = await api('/api/policy/rules');
  if (!data) return;
  var ruleCatSel = document.getElementById('rule-category');
  if (ruleCatSel) {
    ruleCatSel.innerHTML = '<option value="">All categories</option>' +
      CATEGORIES.expense.map(function(c) { return '<option value="' + escHtml(c) + '">' + escHtml(c) + '</option>'; }).join('');
  }
  var list = document.getElementById('policy-rules-list');
  if (!list) return;
  var rules = data.rules || [];
  var typeLabel = { category_cap: 'Single Tx Cap', monthly_cap: 'Monthly Cap', duplicate: 'Duplicate Detection', frequency: 'Frequency Limit', merchant_block: 'Merchant Blocklist' };
  list.innerHTML = rules.length
    ? rules.map(function(r) {
        return '<div class="budget-cap-row"><div style="flex:1"><div class="cap-name">' + (typeLabel[r.rule_type] || r.rule_type) + (r.category ? ' — ' + escHtml(r.category) : '') + '</div>' +
          '<div style="font-size:0.78rem;color:var(--text-muted)">' + (r.threshold ? '₹' + formatNum(r.threshold) + ' per ' + (r.period || 'month') : '') + (r.action === 'notify' ? ' · Email notify' : ' · Flag for review') + '</div></div>' +
          '<button class="td-delete" onclick="deletePolicyRule(' + r.id + ')" title="Delete rule">🗑</button></div>';
      }).join('')
    : '<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:0.85rem">No policy rules yet. Add one above.</div>';
}

function showAddRuleForm() {
  var form = document.getElementById('add-rule-form');
  if (form) form.style.display = '';
  updateRuleForm();
}

function updateRuleForm() {
  var type = document.getElementById('rule-type') ? document.getElementById('rule-type').value : '';
  var tg = document.getElementById('rule-threshold-group');
  var tl = document.getElementById('rule-threshold-label');
  var pg = document.getElementById('rule-period-group');
  var mg = document.getElementById('rule-merchant-group');
  if (type === 'duplicate') {
    if (tg) tg.style.display = 'none'; if (pg) pg.style.display = 'none'; if (mg) pg.style.display = 'none';
  } else if (type === 'merchant_block') {
    if (tg) tg.style.display = 'none'; if (pg) pg.style.display = 'none'; if (mg) mg.style.display = '';
  } else if (type === 'frequency') {
    if (tg) tg.style.display = ''; if (tl) tl.textContent = 'Max transactions'; if (pg) pg.style.display = ''; if (mg) mg.style.display = 'none';
  } else {
    if (tg) tg.style.display = ''; if (tl) tl.textContent = 'Amount (₹)'; if (pg) pg.style.display = ''; if (mg) mg.style.display = 'none';
  }
}

async function addPolicyRule() {
  var rule_type = document.getElementById('rule-type') ? document.getElementById('rule-type').value : '';
  var category  = document.getElementById('rule-category') ? (document.getElementById('rule-category').value || null) : null;
  var threshold = document.getElementById('rule-threshold') ? (parseFloat(document.getElementById('rule-threshold').value) || null) : null;
  var period    = document.getElementById('rule-period') ? (document.getElementById('rule-period').value || 'month') : 'month';
  var action    = document.getElementById('rule-action') ? (document.getElementById('rule-action').value || 'flag') : 'flag';
  var keywords  = document.getElementById('rule-merchant-keywords') ? (document.getElementById('rule-merchant-keywords').value || null) : null;
  if (!rule_type) { showToast('Select a rule type', 'error'); return; }
  if (!['duplicate', 'merchant_block'].includes(rule_type) && !threshold) { showToast('Enter a threshold', 'error'); return; }
  var body = { rule_type: rule_type, category: category, threshold: threshold, period: period, action: action };
  if (keywords) body.category = keywords;
  var data = await api('/api/policy/rules', { method: 'POST', body: JSON.stringify(body) });
  if (data && data.rule) {
    document.getElementById('add-rule-form').style.display = 'none';
    showToast('Policy rule added', 'success');
    await loadPolicyRules();
  } else {
    showToast('Failed: ' + (data && data.error ? data.error : 'unknown'), 'error');
  }
}

async function deletePolicyRule(id) {
  if (!confirm('Delete this policy rule?')) return;
  await api('/api/policy/rules/' + id, { method: 'DELETE' });
  showToast('Rule deleted', 'success');
  await loadPolicyRules();
}
