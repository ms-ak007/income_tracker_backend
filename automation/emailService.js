/**
 * emailService.js — Nodemailer wrapper for all FinFlow automated emails.
 * Uses Gmail SMTP (or any SMTP) configured via .env
 */

require('dotenv').config();
const nodemailer = require('nodemailer');

// ── Transport ──────────────────────────────────────────────────────────────────
function createTransport() {
  return nodemailer.createTransport({
    host:   process.env.SMTP_HOST || 'smtp.gmail.com',
    port:   Number(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function fmt(n) {
  return '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function baseStyle() {
  return `
    body { margin:0; padding:0; background:#0f0f13; font-family:'Segoe UI',Arial,sans-serif; color:#e2e8f0; }
    .wrap { max-width:620px; margin:0 auto; padding:32px 16px; }
    .card { background:linear-gradient(135deg,#1e1e2e,#16213e); border-radius:16px; border:1px solid rgba(99,102,241,.25); overflow:hidden; }
    .header { background:linear-gradient(135deg,#6366f1,#8b5cf6); padding:32px; text-align:center; }
    .header h1 { margin:0; font-size:26px; font-weight:700; color:#fff; }
    .header p { margin:6px 0 0; color:rgba(255,255,255,.8); font-size:14px; }
    .body { padding:28px 32px; }
    .stat-row { display:flex; gap:12px; margin-bottom:24px; }
    .stat { flex:1; background:rgba(99,102,241,.1); border:1px solid rgba(99,102,241,.2); border-radius:12px; padding:16px; text-align:center; }
    .stat .val { font-size:22px; font-weight:700; }
    .stat .lbl { font-size:12px; color:#94a3b8; margin-top:4px; }
    .income  .val { color:#34d399; }
    .expense .val { color:#f87171; }
    .net     .val { color:#818cf8; }
    table { width:100%; border-collapse:collapse; font-size:13px; }
    th { background:rgba(99,102,241,.15); color:#94a3b8; padding:10px 12px; text-align:left; font-weight:600; }
    td { padding:10px 12px; border-bottom:1px solid rgba(255,255,255,.05); }
    .badge-income  { background:rgba(52,211,153,.15); color:#34d399; border-radius:4px; padding:2px 8px; font-size:11px; }
    .badge-expense { background:rgba(248,113,113,.15); color:#f87171; border-radius:4px; padding:2px 8px; font-size:11px; }
    .footer { text-align:center; padding:20px; font-size:12px; color:#475569; }
    .alert-box { background:rgba(248,113,113,.1); border:1px solid rgba(248,113,113,.3); border-radius:12px; padding:20px; margin-bottom:20px; }
    .alert-box h2 { margin:0 0 8px; color:#f87171; font-size:18px; }
    .alert-box p  { margin:0; color:#cbd5e1; }
  `;
}

// ── 1. Monthly Report ──────────────────────────────────────────────────────────
async function sendMonthlyReport(user, { month, summary, byCategory }) {
  if (!process.env.SMTP_USER) return;

  const notifyEmail = user.notify_email || user.email;
  const net         = summary.net || 0;
  const netColor    = net >= 0 ? '#34d399' : '#f87171';

  const catRows = (byCategory || [])
    .map(r => `<tr>
      <td>${r.category}</td>
      <td><span class="badge-${r.type}">${r.type}</span></td>
      <td style="text-align:right">${fmt(r.total)}</td>
      <td style="text-align:right">${r.count}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html><html><head><style>${baseStyle()}</style></head><body>
  <div class="wrap"><div class="card">
    <div class="header">
      <h1>📊 FinFlow Monthly Report</h1>
      <p>${month} — Auto-generated report for ${user.name}</p>
    </div>
    <div class="body">
      <div class="stat-row">
        <div class="stat income"><div class="val">${fmt(summary.total_income)}</div><div class="lbl">Total Income</div></div>
        <div class="stat expense"><div class="val">${fmt(summary.total_expense)}</div><div class="lbl">Total Expense</div></div>
        <div class="stat net"><div class="val" style="color:${netColor}">${fmt(net)}</div><div class="lbl">Net Balance</div></div>
      </div>
      <h3 style="color:#94a3b8;font-size:13px;text-transform:uppercase;letter-spacing:.08em;margin-bottom:12px">Breakdown by Category</h3>
      <table>
        <tr><th>Category</th><th>Type</th><th style="text-align:right">Total</th><th style="text-align:right">Transactions</th></tr>
        ${catRows || '<tr><td colspan="4" style="text-align:center;color:#64748b">No transactions this month</td></tr>'}
      </table>
    </div>
    <div class="footer">FinFlow — Your Personal Finance Tracker<br>You received this because monthly reports are enabled in your settings.</div>
  </div></div></body></html>`;

  await createTransport().sendMail({
    from:    `"FinFlow" <${process.env.SMTP_USER}>`,
    to:      notifyEmail,
    subject: `📊 FinFlow Monthly Report — ${month}`,
    html,
  });

  console.log(`[Email] Monthly report sent to ${notifyEmail} for ${month}`);
}

// ── 2. Budget Alert ────────────────────────────────────────────────────────────
async function sendBudgetAlert(user, { category, spent, budget, isGlobal }) {
  if (!process.env.SMTP_USER) return;

  const notifyEmail = user.notify_email || user.email;
  const label       = isGlobal ? 'Total Monthly Expenses' : `Category: ${category}`;
  const pct         = Math.round((spent / budget) * 100);

  const html = `<!DOCTYPE html><html><head><style>${baseStyle()}</style></head><body>
  <div class="wrap"><div class="card">
    <div class="header" style="background:linear-gradient(135deg,#dc2626,#b91c1c)">
      <h1>🚨 Budget Alert</h1>
      <p>You've exceeded a spending limit, ${user.name}</p>
    </div>
    <div class="body">
      <div class="alert-box">
        <h2>⚠️ ${label} Exceeded</h2>
        <p>You've spent <strong>${fmt(spent)}</strong> against a budget of <strong>${fmt(budget)}</strong> (${pct}%)</p>
      </div>
      <p style="color:#94a3b8;font-size:14px">Review your spending in the <strong>FinFlow dashboard</strong> to stay on track for the rest of the month.</p>
    </div>
    <div class="footer">FinFlow — Your Personal Finance Tracker<br>Disable budget alerts in Settings → Automations.</div>
  </div></div></body></html>`;

  await createTransport().sendMail({
    from:    `"FinFlow" <${process.env.SMTP_USER}>`,
    to:      notifyEmail,
    subject: `🚨 Budget Alert: ${label} exceeded (${pct}%)`,
    html,
  });

  console.log(`[Email] Budget alert sent to ${notifyEmail} — ${label}`);
}

// ── 3. Daily Digest ────────────────────────────────────────────────────────────
async function sendDailyDigest(user, { todayTxs, monthSummary, today }) {
  if (!process.env.SMTP_USER) return;

  const notifyEmail = user.notify_email || user.email;
  const todayTotal  = todayTxs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);

  const txRows = todayTxs.length
    ? todayTxs.map(t => `<tr>
        <td><span class="badge-${t.type}">${t.type}</span></td>
        <td>${t.category}</td>
        <td>${t.description || '—'}</td>
        <td style="text-align:right">${fmt(t.amount)}</td>
      </tr>`).join('')
    : `<tr><td colspan="4" style="text-align:center;color:#64748b;padding:20px">No transactions today 🎉</td></tr>`;

  const html = `<!DOCTYPE html><html><head><style>${baseStyle()}</style></head><body>
  <div class="wrap"><div class="card">
    <div class="header">
      <h1>☀️ Daily Digest</h1>
      <p>${today} — Good morning, ${user.name}!</p>
    </div>
    <div class="body">
      <div class="stat-row">
        <div class="stat expense"><div class="val">${fmt(todayTotal)}</div><div class="lbl">Spent Today</div></div>
        <div class="stat income"><div class="val">${fmt(monthSummary.total_income)}</div><div class="lbl">Month Income</div></div>
        <div class="stat expense"><div class="val">${fmt(monthSummary.total_expense)}</div><div class="lbl">Month Expense</div></div>
      </div>
      <h3 style="color:#94a3b8;font-size:13px;text-transform:uppercase;letter-spacing:.08em;margin-bottom:12px">Today's Transactions</h3>
      <table>
        <tr><th>Type</th><th>Category</th><th>Description</th><th style="text-align:right">Amount</th></tr>
        ${txRows}
      </table>
    </div>
    <div class="footer">FinFlow — Your Personal Finance Tracker<br>Disable daily digest in Settings → Automations.</div>
  </div></div></body></html>`;

  await createTransport().sendMail({
    from:    `"FinFlow" <${process.env.SMTP_USER}>`,
    to:      notifyEmail,
    subject: `☀️ FinFlow Daily Digest — ${today} (Spent: ${fmt(todayTotal)})`,
    html,
  });

  console.log(`[Email] Daily digest sent to ${notifyEmail} for ${today}`);
}

// ── 4. Test email ──────────────────────────────────────────────────────────────
async function sendTestEmail(toEmail) {
  if (!process.env.SMTP_USER) {
    console.error('[Email] SMTP_USER not set in .env');
    return false;
  }
  try {
    await createTransport().sendMail({
      from:    `"FinFlow" <${process.env.SMTP_USER}>`,
      to:      toEmail,
      subject: '✅ FinFlow — Email Configuration Test',
      html:    `<!DOCTYPE html><html><head><style>${baseStyle()}</style></head><body>
        <div class="wrap"><div class="card">
          <div class="header"><h1>✅ Email Working!</h1><p>Your FinFlow automation emails are configured correctly.</p></div>
          <div class="body"><p style="color:#94a3b8">You will now receive budget alerts, monthly reports, and daily digests as configured in your Automations settings.</p></div>
          <div class="footer">FinFlow — Your Personal Finance Tracker</div>
        </div></div></body></html>`,
    });
    console.log(`[Email] Test email sent to ${toEmail}`);
    return true;
  } catch (err) {
    console.error('[Email] Test failed:', err.message);
    return false;
  }
}

module.exports = { sendMonthlyReport, sendBudgetAlert, sendDailyDigest, sendTestEmail };
