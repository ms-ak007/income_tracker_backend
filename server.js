const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const path    = require('path');
const { initDb, run, get, all } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'finflow_super_secret_key_2024_change_in_prod';

// Middleware
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

// SPA Fallback
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('*',          (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Start
initDb().then(() => {
  app.listen(PORT, () => {
    console.log('');
    console.log('  FinFlow running on port ' + PORT);
    console.log('  Open: http://localhost:' + PORT);
    console.log('');
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
