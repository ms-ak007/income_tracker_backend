require('dotenv').config();
const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const path    = require('path');
const cors    = require('cors');
const multer  = require('multer');
const fs      = require('fs');
const { initDb, run, get, all } = require('./database');
const { startScheduler, runMonthlyJob, runDailyDigest, runBankPoller } = require('./automation/scheduler');
const { checkBudgets } = require('./automation/budgetChecker');
const { sendTestEmail } = require('./automation/emailService');
const { pollBankEmails, guessCategory } = require('./automation/bankParser');
const { extractFromText }   = require('./automation/ai/conversationalLogger');
const { processReceipt }    = require('./automation/ai/receiptOcr');
const { runWasteReport }    = require('./automation/ai/subscriptionDetector');
const { evaluatePolicies, getFlags, resolveFlag } = require('./automation/policyEngine');
const { generateForecast }  = require('./automation/cashFlowPredictor');
const { generateTaxReport, getAvailableFinancialYears, autoTagTransactions, setTaxTag } = require('./automation/taxEngine');
const { toTallyXML, toQuickBooksIIF, toZohoCSV, toGenericCSV, toGenericJSON } = require('./automation/accountingExport');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'finflow_super_secret_key_2024_change_in_prod';

// Multer — receipt uploads (temp storage)
const upload = multer({
  dest: path.join(__dirname, 'data', 'uploads'),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    cb(null, allowed.includes(file.mimetype));
  },
});

const statementUpload = multer({
  dest: path.join(__dirname, 'data', 'uploads'),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, cb) => {
    cb(null, file.originalname.endsWith('.csv') || file.mimetype === 'text/csv' || file.mimetype === 'application/vnd.ms-excel');
  },
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Auth Middleware
function requireAuth(req, res, next) {
  const header = req.headers['authorization'];
  const token  = header && header.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// =============================================================
//  AUTH ROUTES
// =============================================================

// POST /api/auth/signup
app.post('/api/auth/signup', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ error: 'Name, email and password are required' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const emailLower = email.toLowerCase().trim();
  const existing   = get('SELECT id FROM users WHERE email = ?', [emailLower]);
  if (existing) return res.status(409).json({ error: 'Email already registered' });

  const passwordHash = await bcrypt.hash(password, 10);
  const result = run(
    'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)',
    [name.trim(), emailLower, passwordHash]
  );

  const user  = get('SELECT id, name, email, created_at FROM users WHERE id = ?', [result.lastInsertRowid]);
  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
  res.status(201).json({ token, user });
});

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Email and password are required' });

  const user = get('SELECT * FROM users WHERE email = ?', [email.toLowerCase().trim()]);
  if (!user) return res.status(401).json({ error: 'Invalid email or password' });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid)  return res.status(401).json({ error: 'Invalid email or password' });

  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
  const { password_hash, ...safeUser } = user;
  res.json({ token, user: safeUser });
});

// =============================================================
//  USER ROUTE
// =============================================================

// GET /api/user/me
app.get('/api/user/me', requireAuth, (req, res) => {
  const user = get('SELECT id, name, email, created_at FROM users WHERE id = ?', [req.userId]);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user });
});

// =============================================================
//  TRANSACTION ROUTES
// =============================================================

// GET /api/transactions?month=YYYY-MM
app.get('/api/transactions', requireAuth, (req, res) => {
  const { month } = req.query;
  let rows;
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    rows = all(
      `SELECT * FROM transactions WHERE user_id = ? AND substr(date,1,7) = ? ORDER BY date DESC, id DESC`,
      [req.userId, month]
    );
  } else {
    rows = all(
      `SELECT * FROM transactions WHERE user_id = ? ORDER BY date DESC, id DESC`,
      [req.userId]
    );
  }
  res.json({ transactions: rows });
});

// POST /api/transactions
app.post('/api/transactions', requireAuth, (req, res) => {
  const { type, category, amount, description, date, paid_from } = req.body;

  if (!type || !category || !amount || !date)
    return res.status(400).json({ error: 'type, category, amount and date are required' });
  if (!['income', 'expense'].includes(type))
    return res.status(400).json({ error: 'type must be "income" or "expense"' });
  if (isNaN(amount) || Number(amount) <= 0)
    return res.status(400).json({ error: 'Amount must be a positive number' });

  // paid_from is only meaningful for expenses
  const paidFrom = (type === 'expense' && paid_from) ? paid_from.trim() || null : null;

  const result = run(
    `INSERT INTO transactions (user_id, type, category, amount, description, date, paid_from) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [req.userId, type, category, Number(amount), description || '', date, paidFrom]
  );
  const tx = get('SELECT * FROM transactions WHERE id = ?', [result.lastInsertRowid]);

  // Fire budget check asynchronously (non-blocking)
  if (type === 'expense') {
    checkBudgets(req.userId, category).catch(e => console.error('[BudgetChecker]', e.message));
  }

  res.status(201).json({ transaction: tx });
});

// DELETE /api/transactions/:id
app.delete('/api/transactions/:id', requireAuth, (req, res) => {
  const tx = get('SELECT id FROM transactions WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
  if (!tx) return res.status(404).json({ error: 'Transaction not found' });
  run('DELETE FROM transactions WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// =============================================================
//  MONTHLY REPORT ROUTES
// =============================================================

// GET /api/reports/monthly
app.get('/api/reports/monthly', requireAuth, (req, res) => {
  const rows = all(`
    SELECT
      substr(date,1,7) AS month,
      SUM(CASE WHEN type='income'  THEN amount ELSE 0 END)       AS total_income,
      SUM(CASE WHEN type='expense' THEN amount ELSE 0 END)       AS total_expense,
      SUM(CASE WHEN type='income'  THEN amount ELSE -amount END) AS net,
      COUNT(*) AS transaction_count
    FROM transactions WHERE user_id = ?
    GROUP BY month ORDER BY month DESC
  `, [req.userId]);
  res.json({ months: rows });
});

// GET /api/reports/monthly/:year/:month
app.get('/api/reports/monthly/:year/:month', requireAuth, (req, res) => {
  const monthStr = `${req.params.year}-${req.params.month.padStart(2, '0')}`;

  const summary = get(`
    SELECT
      COALESCE(SUM(CASE WHEN type='income'  THEN amount ELSE 0 END), 0)       AS total_income,
      COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END), 0)       AS total_expense,
      COALESCE(SUM(CASE WHEN type='income'  THEN amount ELSE -amount END), 0) AS net
    FROM transactions WHERE user_id = ? AND substr(date,1,7) = ?
  `, [req.userId, monthStr]);

  const byCategory = all(`
    SELECT category, type, SUM(amount) AS total, COUNT(*) AS count
    FROM transactions WHERE user_id = ? AND substr(date,1,7) = ?
    GROUP BY category, type ORDER BY total DESC
  `, [req.userId, monthStr]);

  const transactions = all(`
    SELECT * FROM transactions WHERE user_id = ? AND substr(date,1,7) = ?
    ORDER BY date DESC, id DESC
  `, [req.userId, monthStr]);

  res.json({ month: monthStr, summary, byCategory, transactions });
});

// GET /api/reports/trend
app.get('/api/reports/trend', requireAuth, (req, res) => {
  const rows = all(`
    SELECT
      substr(date,1,7) AS month,
      SUM(CASE WHEN type='income'  THEN amount ELSE 0 END) AS income,
      SUM(CASE WHEN type='expense' THEN amount ELSE 0 END) AS expense
    FROM transactions WHERE user_id = ?
    GROUP BY month ORDER BY month ASC
  `, [req.userId]);
  res.json({ trend: rows });
});

// GET /api/reports/categories
app.get('/api/reports/categories', requireAuth, (req, res) => {
  const { month } = req.query;
  let rows;
  if (month && month !== 'all') {
    rows = all(`
      SELECT category, SUM(amount) AS total FROM transactions
      WHERE user_id = ? AND type = 'expense' AND substr(date,1,7) = ?
      GROUP BY category ORDER BY total DESC
    `, [req.userId, month]);
  } else {
    const curMonth = new Date().toISOString().slice(0, 7);
    rows = all(`
      SELECT category, SUM(amount) AS total FROM transactions
      WHERE user_id = ? AND type = 'expense' AND substr(date,1,7) = ?
      GROUP BY category ORDER BY total DESC
    `, [req.userId, curMonth]);
  }
  res.json({ categories: rows });
});

// =============================================================
//  INCOME SOURCE ROUTES
// =============================================================

// GET /api/reports/income-sources
// Returns per-income-category: total earned, total expenses paid from it, remaining balance
app.get('/api/reports/income-sources', requireAuth, (req, res) => {
  const { month } = req.query; // optional: 'YYYY-MM' or omit for all-time

  let dateFilter = 'WHERE user_id = ?';
  let params = [req.userId];

  if (month && /^\d{4}-\d{2}$/.test(month)) {
    dateFilter = `WHERE user_id = ? AND substr(date,1,7) = ?`;
    params = [req.userId, month];
  }

  // All income rows grouped by category
  const incomeRows = all(
    `SELECT category AS source, SUM(amount) AS total_earned
     FROM transactions
     ${dateFilter} AND type = 'income'
     GROUP BY category`,
    params
  );

  // All expense rows that have a paid_from tag
  const expenseRows = all(
    `SELECT paid_from AS source, SUM(amount) AS total_spent
     FROM transactions
     ${dateFilter} AND type = 'expense' AND paid_from IS NOT NULL AND paid_from != ''
     GROUP BY paid_from`,
    params
  );

  // Merge into a unified map keyed by income source name
  const sourceMap = {};

  incomeRows.forEach(r => {
    sourceMap[r.source] = {
      source: r.source,
      total_earned: r.total_earned || 0,
      total_spent:  0,
      remaining:    r.total_earned || 0,
    };
  });

  expenseRows.forEach(r => {
    if (!sourceMap[r.source]) {
      // Expenses tagged to a source that has no income yet
      sourceMap[r.source] = { source: r.source, total_earned: 0, total_spent: 0, remaining: 0 };
    }
    sourceMap[r.source].total_spent += r.total_spent || 0;
    sourceMap[r.source].remaining   -= r.total_spent || 0;
  });

  const sources = Object.values(sourceMap).sort((a, b) => b.total_earned - a.total_earned);
  res.json({ sources });
});

// =============================================================
//  YEARLY REPORT ROUTES
// =============================================================

// GET /api/reports/yearly — all years summary
app.get('/api/reports/yearly', requireAuth, (req, res) => {
  const rows = all(`
    SELECT
      substr(date,1,4) AS year,
      SUM(CASE WHEN type='income'  THEN amount ELSE 0 END)       AS total_income,
      SUM(CASE WHEN type='expense' THEN amount ELSE 0 END)       AS total_expense,
      SUM(CASE WHEN type='income'  THEN amount ELSE -amount END) AS net,
      COUNT(*) AS transaction_count
    FROM transactions WHERE user_id = ?
    GROUP BY year ORDER BY year DESC
  `, [req.userId]);
  res.json({ years: rows });
});

// GET /api/reports/yearly/:year — full breakdown for a year
app.get('/api/reports/yearly/:year', requireAuth, (req, res) => {
  const year = req.params.year;

  const summary = get(`
    SELECT
      COALESCE(SUM(CASE WHEN type='income'  THEN amount ELSE 0 END), 0)       AS total_income,
      COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END), 0)       AS total_expense,
      COALESCE(SUM(CASE WHEN type='income'  THEN amount ELSE -amount END), 0) AS net,
      COUNT(*) AS transaction_count
    FROM transactions WHERE user_id = ? AND substr(date,1,4) = ?
  `, [req.userId, year]);

  const byMonth = all(`
    SELECT
      substr(date,1,7) AS month,
      SUM(CASE WHEN type='income'  THEN amount ELSE 0 END)       AS total_income,
      SUM(CASE WHEN type='expense' THEN amount ELSE 0 END)       AS total_expense,
      SUM(CASE WHEN type='income'  THEN amount ELSE -amount END) AS net,
      COUNT(*) AS transaction_count
    FROM transactions WHERE user_id = ? AND substr(date,1,4) = ?
    GROUP BY month ORDER BY month ASC
  `, [req.userId, year]);

  const byCategory = all(`
    SELECT category, type, SUM(amount) AS total, COUNT(*) AS count
    FROM transactions WHERE user_id = ? AND substr(date,1,4) = ?
    GROUP BY category, type ORDER BY total DESC
  `, [req.userId, year]);

  const transactions = all(`
    SELECT * FROM transactions WHERE user_id = ? AND substr(date,1,4) = ?
    ORDER BY date DESC, id DESC
  `, [req.userId, year]);

  res.json({ year, summary, byMonth, byCategory, transactions });
});

// =============================================================
//  CSV DOWNLOAD ROUTES
// =============================================================

// GET /api/download/monthly/:year/:month
app.get('/api/download/monthly/:year/:month', requireAuth, (req, res) => {
  const monthStr = `${req.params.year}-${req.params.month.padStart(2,'0')}`;
  const txs = all(
    `SELECT date,type,category,description,amount FROM transactions WHERE user_id=? AND substr(date,1,7)=? ORDER BY date DESC,id DESC`,
    [req.userId, monthStr]
  );
  const s = get(
    `SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END),0) AS ti, COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END),0) AS te, COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE -amount END),0) AS net FROM transactions WHERE user_id=? AND substr(date,1,7)=?`,
    [req.userId, monthStr]
  );
  const csv = buildCSV([
    [`FinFlow Monthly Report - ${monthStr}`], [],
    [`Total Income`, s.ti], [`Total Expense`, s.te], [`Net Balance`, s.net], [],
    [`Date`, `Type`, `Category`, `Description`, `Amount (INR)`],
    ...txs.map(t => [t.date, t.type, t.category, t.description || '', t.amount]),
  ]);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="finflow_${monthStr}.csv"`);
  res.send(csv);
});

// GET /api/download/yearly/:year
app.get('/api/download/yearly/:year', requireAuth, (req, res) => {
  const year = req.params.year;
  const txs  = all(
    `SELECT date,type,category,description,amount FROM transactions WHERE user_id=? AND substr(date,1,4)=? ORDER BY date DESC,id DESC`,
    [req.userId, year]
  );
  const s = get(
    `SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END),0) AS ti, COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END),0) AS te, COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE -amount END),0) AS net, COUNT(*) AS cnt FROM transactions WHERE user_id=? AND substr(date,1,4)=?`,
    [req.userId, year]
  );
  const byM = all(
    `SELECT substr(date,1,7) AS month, SUM(CASE WHEN type='income' THEN amount ELSE 0 END) AS income, SUM(CASE WHEN type='expense' THEN amount ELSE 0 END) AS expense, SUM(CASE WHEN type='income' THEN amount ELSE -amount END) AS net FROM transactions WHERE user_id=? AND substr(date,1,4)=? GROUP BY month ORDER BY month ASC`,
    [req.userId, year]
  );
  const csv = buildCSV([
    [`FinFlow Annual Report - ${year}`], [],
    [`ANNUAL SUMMARY`],
    [`Total Income`, s.ti], [`Total Expense`, s.te], [`Net Balance`, s.net], [`Total Transactions`, s.cnt], [],
    [`MONTHLY BREAKDOWN`],
    [`Month`, `Income (INR)`, `Expense (INR)`, `Net (INR)`],
    ...byM.map(m => [m.month, m.income, m.expense, m.net]),
    [], [`ALL TRANSACTIONS`],
    [`Date`, `Type`, `Category`, `Description`, `Amount (INR)`],
    ...txs.map(t => [t.date, t.type, t.category, t.description || '', t.amount]),
  ]);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="finflow_${year}_annual.csv"`);
  res.send(csv);
});

function buildCSV(rows) {
  return rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\r\n');
}

// =============================================================
//  AUTOMATION — SETTINGS ROUTES
// =============================================================

// GET /api/settings/notifications — get user's automation settings
app.get('/api/settings/notifications', requireAuth, (req, res) => {
  let settings = get('SELECT * FROM user_settings WHERE user_id = ?', [req.userId]);
  if (!settings) {
    // Create default settings row
    run('INSERT INTO user_settings (user_id) VALUES (?)', [req.userId]);
    settings = get('SELECT * FROM user_settings WHERE user_id = ?', [req.userId]);
  }
  // Never expose raw IMAP password
  const { imap_pass, ...safe } = settings;
  safe.imap_configured = !!(settings.imap_user && settings.imap_pass);
  res.json({ settings: safe });
});

// PUT /api/settings/notifications — update automation settings
app.put('/api/settings/notifications', requireAuth, (req, res) => {
  const { notify_email, budget_alert, monthly_report, daily_digest, bank_parser, global_budget, imap_user, imap_pass } = req.body;

  // Upsert settings
  const existing = get('SELECT user_id FROM user_settings WHERE user_id = ?', [req.userId]);
  if (!existing) {
    run('INSERT INTO user_settings (user_id) VALUES (?)', [req.userId]);
  }

  const fields = [];
  const vals   = [];
  if (notify_email    !== undefined) { fields.push('notify_email = ?');    vals.push(notify_email || null); }
  if (budget_alert    !== undefined) { fields.push('budget_alert = ?');    vals.push(budget_alert ? 1 : 0); }
  if (monthly_report  !== undefined) { fields.push('monthly_report = ?');  vals.push(monthly_report ? 1 : 0); }
  if (daily_digest    !== undefined) { fields.push('daily_digest = ?');    vals.push(daily_digest ? 1 : 0); }
  if (bank_parser     !== undefined) { fields.push('bank_parser = ?');     vals.push(bank_parser ? 1 : 0); }
  if (global_budget   !== undefined) { fields.push('global_budget = ?');   vals.push(global_budget || null); }
  if (imap_user       !== undefined) { fields.push('imap_user = ?');       vals.push(imap_user || null); }
  if (imap_pass       !== undefined) { fields.push('imap_pass = ?');       vals.push(imap_pass || null); }

  if (fields.length) {
    vals.push(req.userId);
    run(`UPDATE user_settings SET ${fields.join(', ')} WHERE user_id = ?`, vals);
  }

  res.json({ success: true });
});

// POST /api/settings/test-email — send a test email
app.post('/api/settings/test-email', requireAuth, async (req, res) => {
  const user = get('SELECT email FROM users WHERE id = ?', [req.userId]);
  const settings = get('SELECT notify_email FROM user_settings WHERE user_id = ?', [req.userId]);
  const toEmail = (settings && settings.notify_email) || user.email;
  const ok = await sendTestEmail(toEmail);
  if (ok) res.json({ success: true, message: `Test email sent to ${toEmail}` });
  else    res.status(500).json({ error: 'Failed to send test email. Check your SMTP .env config.' });
});

// =============================================================
//  AUTOMATION — BUDGET CAPS ROUTES
// =============================================================

// GET /api/budgets — get all budget caps for user
app.get('/api/budgets', requireAuth, (req, res) => {
  const caps = all('SELECT * FROM budget_caps WHERE user_id = ? ORDER BY category', [req.userId]);
  res.json({ budgets: caps });
});

// POST /api/budgets — add or update a budget cap
app.post('/api/budgets', requireAuth, (req, res) => {
  const { category, amount } = req.body;
  if (!category || !amount || isNaN(amount) || Number(amount) <= 0)
    return res.status(400).json({ error: 'category and a positive amount are required' });

  run(`INSERT INTO budget_caps (user_id, category, amount) VALUES (?, ?, ?)
       ON CONFLICT(user_id, category) DO UPDATE SET amount = excluded.amount`,
    [req.userId, category.trim(), Number(amount)]);

  const cap = get('SELECT * FROM budget_caps WHERE user_id = ? AND category = ?', [req.userId, category.trim()]);
  res.status(201).json({ budget: cap });
});

// DELETE /api/budgets/:id — remove a budget cap
app.delete('/api/budgets/:id', requireAuth, (req, res) => {
  const cap = get('SELECT id FROM budget_caps WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
  if (!cap) return res.status(404).json({ error: 'Budget cap not found' });
  run('DELETE FROM budget_caps WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// =============================================================
//  AUTOMATION — RECURRING TRANSACTIONS ROUTES
// =============================================================

// GET /api/recurring — list all recurring templates
app.get('/api/recurring', requireAuth, (req, res) => {
  const rows = all('SELECT * FROM recurring_transactions WHERE user_id = ? ORDER BY id DESC', [req.userId]);
  res.json({ recurring: rows });
});

// POST /api/recurring — create a new recurring template
app.post('/api/recurring', requireAuth, (req, res) => {
  const { type, category, amount, description, paid_from, day_of_month } = req.body;
  if (!type || !category || !amount || isNaN(amount) || Number(amount) <= 0)
    return res.status(400).json({ error: 'type, category, and a positive amount are required' });
  if (!['income','expense'].includes(type))
    return res.status(400).json({ error: 'type must be income or expense' });
  const day = Math.min(28, Math.max(1, parseInt(day_of_month) || 1));
  const result = run(
    `INSERT INTO recurring_transactions (user_id, type, category, amount, description, paid_from, day_of_month) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [req.userId, type, category, Number(amount), description || '', paid_from || null, day]
  );
  const rec = get('SELECT * FROM recurring_transactions WHERE id = ?', [result.lastInsertRowid]);
  res.status(201).json({ recurring: rec });
});

// PUT /api/recurring/:id — update a recurring template
app.put('/api/recurring/:id', requireAuth, (req, res) => {
  const rec = get('SELECT id FROM recurring_transactions WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
  if (!rec) return res.status(404).json({ error: 'Recurring transaction not found' });
  const { type, category, amount, description, paid_from, day_of_month, active } = req.body;
  run(`UPDATE recurring_transactions SET
    type = COALESCE(?, type), category = COALESCE(?, category), amount = COALESCE(?, amount),
    description = COALESCE(?, description), paid_from = COALESCE(?, paid_from),
    day_of_month = COALESCE(?, day_of_month), active = COALESCE(?, active)
    WHERE id = ?`,
    [type, category, amount ? Number(amount) : null, description, paid_from, day_of_month ? parseInt(day_of_month) : null, active !== undefined ? (active ? 1 : 0) : null, req.params.id]
  );
  res.json({ success: true });
});

// DELETE /api/recurring/:id — delete a recurring template
app.delete('/api/recurring/:id', requireAuth, (req, res) => {
  const rec = get('SELECT id FROM recurring_transactions WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
  if (!rec) return res.status(404).json({ error: 'Recurring transaction not found' });
  run('DELETE FROM recurring_transactions WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// =============================================================
//  AUTOMATION — DEBUG / MANUAL TRIGGER ROUTES
// =============================================================

// POST /api/debug/run-monthly-report  — manually trigger the monthly job
app.post('/api/debug/run-monthly-report', requireAuth, async (req, res) => {
  try { await runMonthlyJob(); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/debug/run-daily-digest — manually trigger daily digest
app.post('/api/debug/run-daily-digest', requireAuth, async (req, res) => {
  try { await runDailyDigest(); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/debug/run-bank-poller — manually poll bank emails now
app.post('/api/debug/run-bank-poller', requireAuth, async (req, res) => {
  try { await runBankPoller(); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════
//  AI — CONVERSATIONAL LOGGING
// ═══════════════════════════════════════════════════════════════

// POST /api/ai/log-from-text — NLP: natural language text → transaction
app.post('/api/ai/log-from-text', requireAuth, async (req, res) => {
  const { text } = req.body;
  if (!text || text.trim().length < 3)
    return res.status(400).json({ error: 'Text input is required' });

  try {
    const result = await extractFromText(text);
    if (result.error) return res.status(422).json(result);

    // Cache to ai_log_cache
    run(`INSERT INTO ai_log_cache (user_id, input_text, result_json, source) VALUES (?, ?, ?, ?)`,
      [req.userId, text.slice(0, 500), JSON.stringify(result), result.source || 'text']);

    res.json({ result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai/confirm-log — Confirm AI result and insert transaction
app.post('/api/ai/confirm-log', requireAuth, async (req, res) => {
  const { type, category, amount, description, date, paid_from } = req.body;
  if (!type || !category || amount === undefined || amount === null || !date)
    return res.status(400).json({ error: 'type, category, amount, date required' });

  const result = run(
    `INSERT INTO transactions (user_id, type, category, amount, description, date, paid_from) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [req.userId, type, category, Number(amount), description || '', date, paid_from || null]
  );
  const tx = get('SELECT * FROM transactions WHERE id = ?', [result.lastInsertRowid]);

  if (type === 'expense') {
    checkBudgets(req.userId, category).catch(() => {});
    evaluatePolicies(req.userId, tx).catch(() => {});
  }

  res.status(201).json({ transaction: tx });
});

// ═══════════════════════════════════════════════════════════════
//  AI — RECEIPT OCR
// ═══════════════════════════════════════════════════════════════

// POST /api/ai/scan-receipt — Upload image, get structured receipt data
app.post('/api/ai/scan-receipt', requireAuth, upload.single('receipt'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image uploaded' });

  try {
    const result = await processReceipt(req.file.path);
    // Clean up temp file
    fs.unlink(req.file.path, () => {});
    res.json({ result });
  } catch (err) {
    fs.unlink(req.file?.path, () => {});
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
//  AI — SUBSCRIPTION & WASTE DETECTION
// ═══════════════════════════════════════════════════════════════

// GET /api/ai/subscription-scan — Detect waste and subscriptions
app.get('/api/ai/subscription-scan', requireAuth, async (req, res) => {
  try {
    const report = await runWasteReport(req.userId);
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
//  POLICY ENGINE ROUTES
// ═══════════════════════════════════════════════════════════════

// GET /api/policy/rules
app.get('/api/policy/rules', requireAuth, (req, res) => {
  const rules = all('SELECT * FROM spending_policies WHERE user_id = ? ORDER BY id DESC', [req.userId]);
  res.json({ rules });
});

// POST /api/policy/rules
app.post('/api/policy/rules', requireAuth, (req, res) => {
  const { rule_type, category, threshold, period, action } = req.body;
  if (!rule_type) return res.status(400).json({ error: 'rule_type is required' });
  const VALID_TYPES = ['category_cap', 'monthly_cap', 'duplicate', 'frequency', 'merchant_block'];
  if (!VALID_TYPES.includes(rule_type)) return res.status(400).json({ error: 'Invalid rule_type' });
  const result = run(
    `INSERT INTO spending_policies (user_id, rule_type, category, threshold, period, action) VALUES (?, ?, ?, ?, ?, ?)`,
    [req.userId, rule_type, category || null, threshold || null, period || 'month', action || 'flag']
  );
  const rule = get('SELECT * FROM spending_policies WHERE id = ?', [result.lastInsertRowid]);
  res.status(201).json({ rule });
});

// DELETE /api/policy/rules/:id
app.delete('/api/policy/rules/:id', requireAuth, (req, res) => {
  const rule = get('SELECT id FROM spending_policies WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
  if (!rule) return res.status(404).json({ error: 'Rule not found' });
  run('DELETE FROM spending_policies WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// GET /api/policy/flags
app.get('/api/policy/flags', requireAuth, (req, res) => {
  const flags = getFlags(req.userId);
  res.json({ flags, count: flags.length });
});

// PUT /api/policy/flags/:id/resolve
app.put('/api/policy/flags/:id/resolve', requireAuth, (req, res) => {
  resolveFlag(req.params.id, req.userId);
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════
//  CASH FLOW FORECAST ROUTES
// ═══════════════════════════════════════════════════════════════

// GET /api/forecast?months=6&history=6
app.get('/api/forecast', requireAuth, (req, res) => {
  const months  = Math.min(12, Math.max(1, parseInt(req.query.months)  || 6));
  const history = Math.min(24, Math.max(2, parseInt(req.query.history) || 6));
  const forecast = generateForecast(req.userId, months, history);
  res.json(forecast);
});

// ═══════════════════════════════════════════════════════════════
//  TAX COMPLIANCE ROUTES
// ═══════════════════════════════════════════════════════════════

// GET /api/tax/years — available financial years
app.get('/api/tax/years', requireAuth, (req, res) => {
  const years = getAvailableFinancialYears(req.userId);
  res.json({ years });
});

// GET /api/tax/report?fy=2025-26
app.get('/api/tax/report', requireAuth, (req, res) => {
  const fy = req.query.fy;
  if (!fy || !/^\d{4}-\d{2}$/.test(fy)) return res.status(400).json({ error: 'fy must be YYYY-YY format (e.g. 2025-26)' });
  autoTagTransactions(req.userId); // auto-tag untagged transactions
  const report = generateTaxReport(req.userId, fy);
  res.json(report);
});

// PUT /api/tax/tag/:txId — manually override a tax tag
app.put('/api/tax/tag/:txId', requireAuth, (req, res) => {
  const { taxSection, isDeductible } = req.body;
  setTaxTag(req.userId, req.params.txId, { taxSection, isDeductible });
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════
//  ACCOUNTING EXPORT ROUTES
// ═══════════════════════════════════════════════════════════════

// GET /api/export/tally?year=2025
app.get('/api/export/tally', requireAuth, (req, res) => {
  const xml = toTallyXML(req.userId, { year: req.query.year, month: req.query.month });
  res.setHeader('Content-Type', 'text/xml');
  res.setHeader('Content-Disposition', `attachment; filename="finflow_tally_${req.query.year || 'all'}.xml"`);
  res.send(xml);
});

// GET /api/export/quickbooks?year=2025
app.get('/api/export/quickbooks', requireAuth, (req, res) => {
  const iif = toQuickBooksIIF(req.userId, { year: req.query.year, month: req.query.month });
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Content-Disposition', `attachment; filename="finflow_quickbooks_${req.query.year || 'all'}.iif"`);
  res.send(iif);
});

// GET /api/export/zoho?year=2025
app.get('/api/export/zoho', requireAuth, (req, res) => {
  const csv = toZohoCSV(req.userId, { year: req.query.year, month: req.query.month });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="finflow_zoho_${req.query.year || 'all'}.csv"`);
  res.send(csv);
});

// GET /api/export/csv?year=2025
app.get('/api/export/csv', requireAuth, (req, res) => {
  const csv = toGenericCSV(req.userId, { year: req.query.year, month: req.query.month });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="finflow_export_${req.query.year || 'all'}.csv"`);
  res.send(csv);
});

// GET /api/export/json?year=2025
app.get('/api/export/json', requireAuth, (req, res) => {
  const data = toGenericJSON(req.userId, { year: req.query.year, month: req.query.month });
  res.setHeader('Content-Disposition', `attachment; filename="finflow_export_${req.query.year || 'all'}.json"`);
  res.json(data);
});

// POST /api/bank/import-statement — Import bank statement CSV
app.post('/api/bank/import-statement', requireAuth, statementUpload.single('statement'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No CSV file uploaded' });

  try {
    const csvContent = fs.readFileSync(req.file.path, 'utf8');
    // Clean up temp file
    fs.unlink(req.file.path, () => {});

    // Parse CSV line by line
    const lines = csvContent.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);
    if (lines.length < 2) {
      return res.status(400).json({ error: 'CSV file is empty or missing data rows' });
    }

    // Try to find headers: Date, Description/Narration, Amount, Type
    const headers = lines[0].split(',').map(h => h.replace(/^["']|["']$/g, '').trim().toLowerCase());
    
    // Find column indexes
    let dateIdx = headers.findIndex(h => h.includes('date'));
    let descIdx = headers.findIndex(h => h.includes('desc') || h.includes('narr') || h.includes('particular') || h.includes('info'));
    let amountIdx = headers.findIndex(h => h.includes('amount') || h.includes('value') || h.includes('rs') || h.includes('inr'));
    let typeIdx = headers.findIndex(h => h.includes('type') || h.includes('cr/dr') || h.includes('d/c') || h.includes('credit/debit') || h.includes('transaction type'));

    // Fallbacks if headers are not detected
    if (dateIdx === -1) dateIdx = 0;
    if (descIdx === -1) descIdx = 1;
    if (amountIdx === -1) amountIdx = headers.length > 2 ? 2 : 1;
    if (typeIdx === -1) typeIdx = headers.length > 3 ? 3 : -1;

    const parsedTxs = [];
    const todayStr = new Date().toISOString().slice(0, 10);

    for (let i = 1; i < lines.length; i++) {
      // Split and handle commas inside quotes
      const row = lines[i].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(v => v.replace(/^["']|["']$/g, '').trim());
      if (row.length <= Math.max(dateIdx, descIdx, amountIdx)) continue;

      let dateVal = row[dateIdx] || todayStr;
      let descVal = row[descIdx] || 'Bank Transaction';
      let amountVal = parseFloat(row[amountIdx].replace(/[^0-9.-]/g, '')) || 0;
      let typeVal = 'expense'; // default

      if (typeIdx !== -1 && row[typeIdx]) {
        const typeStr = row[typeIdx].toLowerCase();
        if (typeStr.includes('cr') || typeStr.includes('credit') || typeStr.includes('dep') || typeStr.includes('in')) {
          typeVal = 'income';
        }
      } else {
        // If type column not found, try guessing from amount sign or description keywords
        if (amountVal < 0) {
          typeVal = 'expense';
          amountVal = Math.abs(amountVal);
        } else if (descVal.toLowerCase().includes('salary') || descVal.toLowerCase().includes('refund') || descVal.toLowerCase().includes('credited') || descVal.toLowerCase().includes('interest')) {
          typeVal = 'income';
        }
      }

      // Standardize date to YYYY-MM-DD
      let cleanDate = todayStr;
      try {
        const dateParts = dateVal.split(/[-/]/);
        if (dateParts.length === 3) {
          if (dateParts[2].length === 4) {
            cleanDate = `${dateParts[2]}-${dateParts[1].padStart(2,'0')}-${dateParts[0].padStart(2,'0')}`;
          } else if (dateParts[0].length === 4) {
            cleanDate = `${dateParts[0]}-${dateParts[1].padStart(2,'0')}-${dateParts[2].padStart(2,'0')}`;
          }
        } else {
          const parsedD = new Date(dateVal);
          if (!isNaN(parsedD.getTime())) {
            cleanDate = parsedD.toISOString().slice(0, 10);
          }
        }
      } catch (_) {}

      if (amountVal > 0) {
        const guessedCat = guessCategory(descVal, typeVal);
        parsedTxs.push({
          date: cleanDate,
          description: `[Import] ${descVal}`,
          type: typeVal,
          category: guessedCat,
          amount: amountVal
        });
      }
    }

    res.json({ success: true, count: parsedTxs.length, transactions: parsedTxs });
  } catch (err) {
    fs.unlink(req.file?.path, () => {});
    res.status(500).json({ error: err.message });
  }
});

// POST /api/bank/confirm-statement — Save confirmed bank transactions
app.post('/api/bank/confirm-statement', requireAuth, async (req, res) => {
  const { transactions } = req.body;
  if (!transactions || !Array.isArray(transactions) || transactions.length === 0) {
    return res.status(400).json({ error: 'No transactions provided' });
  }

  let count = 0;
  try {
    for (const t of transactions) {
      run(
        `INSERT INTO transactions (user_id, type, category, amount, description, date, paid_from) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [req.userId, t.type, t.category, t.amount, t.description, t.date, null]
      );
      count++;
    }
    res.json({ success: true, count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SPA Fallback
app.get('/dashboard',  (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/cashflow',   (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/tax',        (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('*',           (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Start
initDb().then(() => {
  startScheduler();
  app.listen(PORT, '0.0.0.0', () => {
  console.log(`FinFlow running on port ${PORT}`);
});
    console.log('');
    console.log('  FinFlow running on port ' + PORT);
    console.log('  Open: http://localhost:' + PORT);
    console.log('');
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
