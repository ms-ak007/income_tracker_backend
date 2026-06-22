/**
 * scheduler.js — node-cron based job scheduler for FinFlow automation.
 * Jobs:
 *   • 1st of each month, 09:00 → send monthly report + insert recurring transactions
 *   • Every day 08:00        → send daily digest (for users who opted in)
 *   • Every 15 min           → poll Gmail IMAP for bank emails (if enabled)
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const cron = require('node-cron');
const { all, get, run } = require('../database');
const { sendMonthlyReport, sendDailyDigest } = require('./emailService');
const { pollBankEmails } = require('./bankParser');

// ── Helper: format YYYY-MM-DD ──────────────────────────────────────────────────
function today() {
  return new Date().toISOString().slice(0, 10);
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function prevMonth() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 7);
}

// ── Job 1: Monthly Report + Recurring Transactions (1st of month @ 09:00) ─────
async function runMonthlyJob() {
  console.log('[Scheduler] Running monthly job...');
  const month = prevMonth(); // report is for the previous month

  const users = all('SELECT u.id, u.name, u.email, s.notify_email, s.monthly_report FROM users u LEFT JOIN user_settings s ON u.id = s.user_id');

  for (const user of users) {
    // ── Monthly report email ────────────────────────────────────────────────
    if (user.monthly_report !== 0) { // default ON
      try {
        const summary = get(`
          SELECT
            COALESCE(SUM(CASE WHEN type='income'  THEN amount ELSE 0 END), 0)       AS total_income,
            COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END), 0)       AS total_expense,
            COALESCE(SUM(CASE WHEN type='income'  THEN amount ELSE -amount END), 0) AS net
          FROM transactions WHERE user_id = ? AND substr(date,1,7) = ?
        `, [user.id, month]);

        const byCategory = all(`
          SELECT category, type, SUM(amount) AS total, COUNT(*) AS count
          FROM transactions WHERE user_id = ? AND substr(date,1,7) = ?
          GROUP BY category, type ORDER BY total DESC
        `, [user.id, month]);

        await sendMonthlyReport(user, { month, summary, byCategory });
      } catch (err) {
        console.error(`[Scheduler] Monthly report failed for user ${user.id}:`, err.message);
      }
    }

    // ── Insert recurring transactions ───────────────────────────────────────
    try {
      const recurrings = all(
        `SELECT * FROM recurring_transactions WHERE user_id = ? AND active = 1`,
        [user.id]
      );
      const thisMonth = currentMonth();
      for (const rec of recurrings) {
        // Check if already run this month
        if (rec.last_run && rec.last_run.startsWith(thisMonth)) continue;

        const insertDate = `${thisMonth}-${String(rec.day_of_month).padStart(2, '0')}`;
        run(
          `INSERT INTO transactions (user_id, type, category, amount, description, date, paid_from) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [user.id, rec.type, rec.category, rec.amount, rec.description || '', insertDate, rec.paid_from || null]
        );
        run(
          `UPDATE recurring_transactions SET last_run = ? WHERE id = ?`,
          [today(), rec.id]
        );
        console.log(`[Scheduler] Inserted recurring tx: ${rec.description} (${rec.type}) for user ${user.id}`);
      }
    } catch (err) {
      console.error(`[Scheduler] Recurring tx failed for user ${user.id}:`, err.message);
    }
  }

  console.log('[Scheduler] Monthly job complete.');
}

// ── Job 2: Daily Digest (every day @ 08:00) ────────────────────────────────────
async function runDailyDigest() {
  console.log('[Scheduler] Running daily digest...');
  const todayStr  = today();
  const monthStr  = currentMonth();

  const users = all('SELECT u.id, u.name, u.email, s.notify_email, s.daily_digest FROM users u LEFT JOIN user_settings s ON u.id = s.user_id WHERE s.daily_digest = 1');

  for (const user of users) {
    try {
      const todayTxs = all(
        `SELECT * FROM transactions WHERE user_id = ? AND date = ? ORDER BY id DESC`,
        [user.id, todayStr]
      );
      const monthSummary = get(`
        SELECT
          COALESCE(SUM(CASE WHEN type='income'  THEN amount ELSE 0 END), 0) AS total_income,
          COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END), 0) AS total_expense
        FROM transactions WHERE user_id = ? AND substr(date,1,7) = ?
      `, [user.id, monthStr]);

      await sendDailyDigest(user, { todayTxs, monthSummary, today: todayStr });
    } catch (err) {
      console.error(`[Scheduler] Daily digest failed for user ${user.id}:`, err.message);
    }
  }
}

// ── Job 3: Bank Email Polling (every 15 minutes) ───────────────────────────────
async function runBankPoller() {
  const users = all('SELECT u.id, u.name, u.email, s.imap_user, s.imap_pass FROM users u LEFT JOIN user_settings s ON u.id = s.user_id WHERE s.bank_parser = 1 AND s.imap_user IS NOT NULL');
  for (const user of users) {
    try {
      await pollBankEmails(user);
    } catch (err) {
      console.error(`[Scheduler] Bank poller failed for user ${user.id}:`, err.message);
    }
  }
}

// ── Start all schedules ────────────────────────────────────────────────────────
function startScheduler() {
  // Monthly report + recurring: 09:00 on the 1st of each month
  cron.schedule('0 9 1 * *', runMonthlyJob, { timezone: 'Asia/Kolkata' });

  // Daily digest: 08:00 every day
  cron.schedule('0 8 * * *', runDailyDigest, { timezone: 'Asia/Kolkata' });

  // Bank email poll: every 15 minutes
  cron.schedule('*/15 * * * *', runBankPoller);

  console.log('✅ FinFlow automation scheduler started');
  console.log('   • Monthly report:     1st of each month @ 09:00 IST');
  console.log('   • Daily digest:       Every day @ 08:00 IST');
  console.log('   • Bank email parser:  Every 15 minutes');
}

// Allow manual trigger via debug API
module.exports = { startScheduler, runMonthlyJob, runDailyDigest, runBankPoller };
