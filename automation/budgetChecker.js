/**
 * budgetChecker.js — Called after every new expense transaction.
 * Checks global monthly budget and per-category caps, fires email alerts when exceeded.
 */

const { get, all } = require('../database');
const { sendBudgetAlert } = require('./emailService');

// Tracks which alerts have already been sent this month to avoid spam.
// Key: `${userId}-${category || 'global'}-${YYYY-MM}`
const alertedThisMonth = new Set();

/**
 * Run budget checks for a user after a new expense transaction.
 * @param {number} userId
 * @param {string} transactionCategory — the category of the just-added expense
 */
async function checkBudgets(userId, transactionCategory) {
  try {
    const settings = get('SELECT * FROM user_settings WHERE user_id = ?', [userId]);
    if (!settings || !settings.budget_alert) return;

    const user   = get('SELECT id, name, email, notify_email FROM users u LEFT JOIN user_settings s ON u.id = s.user_id WHERE u.id = ?', [userId]);
    const userFull = get('SELECT u.id, u.name, u.email, s.notify_email FROM users u LEFT JOIN user_settings s ON u.id = s.user_id WHERE u.id = ?', [userId]);
    const month  = new Date().toISOString().slice(0, 7); // YYYY-MM

    // ── 1. Global monthly budget check ────────────────────────────────────────
    if (settings.global_budget) {
      const alertKey = `${userId}-global-${month}`;
      if (!alertedThisMonth.has(alertKey)) {
        const totalExpense = get(
          `SELECT COALESCE(SUM(amount), 0) AS total FROM transactions
           WHERE user_id = ? AND type = 'expense' AND substr(date,1,7) = ?`,
          [userId, month]
        );
        if (totalExpense && totalExpense.total > settings.global_budget) {
          alertedThisMonth.add(alertKey);
          await sendBudgetAlert(userFull, {
            category: null,
            spent:    totalExpense.total,
            budget:   settings.global_budget,
            isGlobal: true,
          });
        }
      }
    }

    // ── 2. Per-category budget cap check ─────────────────────────────────────
    const caps = all('SELECT * FROM budget_caps WHERE user_id = ?', [userId]);
    for (const cap of caps) {
      if (cap.category !== transactionCategory) continue; // only check the relevant category
      const alertKey = `${userId}-${cap.category}-${month}`;
      if (alertedThisMonth.has(alertKey)) continue;

      const catTotal = get(
        `SELECT COALESCE(SUM(amount), 0) AS total FROM transactions
         WHERE user_id = ? AND type = 'expense' AND category = ? AND substr(date,1,7) = ?`,
        [userId, cap.category, month]
      );
      if (catTotal && catTotal.total > cap.amount) {
        alertedThisMonth.add(alertKey);
        await sendBudgetAlert(userFull, {
          category: cap.category,
          spent:    catTotal.total,
          budget:   cap.amount,
          isGlobal: false,
        });
      }
    }
  } catch (err) {
    console.error('[BudgetChecker] Error:', err.message);
  }
}

// Clear alert cache at midnight each day (prevents stale keys)
const now = new Date();
const msToMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1) - now;
setTimeout(() => {
  alertedThisMonth.clear();
  setInterval(() => alertedThisMonth.clear(), 24 * 60 * 60 * 1000);
}, msToMidnight);

module.exports = { checkBudgets };
