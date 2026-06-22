/**
 * policyEngine.js — Rule-based policy enforcement.
 * Called after every transaction insert. Checks rules from spending_policies table.
 *
 * Rule types:
 *   category_cap      — single transaction amount > threshold for a category
 *   monthly_cap       — total monthly spend in category > threshold
 *   duplicate         — same amount + same category within N hours
 *   frequency         — more than N transactions of same category in a day/week
 *   time_restriction  — transaction outside allowed hours
 *   merchant_block    — description contains a blocked merchant keyword
 */

const { get, all, run } = require('../database');
const { sendBudgetAlert } = require('./emailService');

/**
 * Evaluate all active policies for a given transaction.
 * @param {number} userId
 * @param {Object} transaction — { id, type, category, amount, description, date }
 */
async function evaluatePolicies(userId, transaction) {
  if (transaction.type !== 'expense') return; // policies only apply to expenses

  const rules = all(
    'SELECT * FROM spending_policies WHERE user_id = ? AND active = 1',
    [userId]
  );

  const flags = [];

  for (const rule of rules) {
    try {
      const flag = await checkRule(userId, rule, transaction);
      if (flag) flags.push(flag);
    } catch (err) {
      console.error(`[PolicyEngine] Rule ${rule.id} error:`, err.message);
    }
  }

  // Persist all flags
  for (const f of flags) {
    run(
      `INSERT INTO policy_flags (user_id, transaction_id, rule_id, reason)
       VALUES (?, ?, ?, ?)`,
      [userId, transaction.id, f.ruleId, f.reason]
    );
    console.log(`[PolicyEngine] Flag created: ${f.reason}`);
  }

  // Send email if any flags created and user has budget_alert on
  if (flags.length > 0) {
    const settings = get('SELECT * FROM user_settings WHERE user_id = ?', [userId]);
    if (settings?.budget_alert) {
      const user = get(
        'SELECT u.id, u.name, u.email, s.notify_email FROM users u LEFT JOIN user_settings s ON u.id = s.user_id WHERE u.id = ?',
        [userId]
      );
      if (user) {
        // Re-use budget alert email with policy context
        await sendBudgetAlert(user, {
          category: transaction.category,
          spent:    transaction.amount,
          budget:   flags[0].threshold || 0,
          isGlobal: false,
          policyReason: flags.map(f => f.reason).join('; '),
        }).catch(() => {});
      }
    }
  }

  return flags;
}

/**
 * Check a single rule against a transaction
 */
async function checkRule(userId, rule, tx) {
  const month = tx.date.slice(0, 7);
  const today = tx.date.slice(0, 10);

  switch (rule.rule_type) {

    case 'category_cap': {
      // Single transaction amount exceeds threshold for this category
      if (rule.category && rule.category !== tx.category) break;
      if (tx.amount > rule.threshold) {
        return {
          ruleId:    rule.id,
          reason:    `Single ${tx.category} transaction ₹${tx.amount.toLocaleString('en-IN')} exceeds cap of ₹${rule.threshold.toLocaleString('en-IN')}`,
          threshold: rule.threshold,
        };
      }
      break;
    }

    case 'monthly_cap': {
      // Total monthly spend in category exceeds threshold
      if (rule.category && rule.category !== tx.category) break;
      const totalRow = get(
        `SELECT COALESCE(SUM(amount), 0) AS total FROM transactions
         WHERE user_id = ? AND type = 'expense' AND category = ? AND substr(date,1,7) = ?`,
        [userId, tx.category, month]
      );
      if (totalRow && totalRow.total > rule.threshold) {
        return {
          ruleId:    rule.id,
          reason:    `Monthly ${tx.category} total ₹${totalRow.total.toLocaleString('en-IN')} exceeds cap of ₹${rule.threshold.toLocaleString('en-IN')}`,
          threshold: rule.threshold,
        };
      }
      break;
    }

    case 'duplicate': {
      // Same amount + same category within last 24 hours (excluding this transaction)
      const window = rule.threshold || 24; // hours
      const cutoff = new Date(Date.now() - window * 60 * 60 * 1000).toISOString();
      const dupe = get(
        `SELECT id FROM transactions
         WHERE user_id = ? AND type = 'expense' AND category = ? AND amount = ?
           AND created_at > ? AND id != ?
         LIMIT 1`,
        [userId, tx.category, tx.amount, cutoff, tx.id]
      );
      if (dupe) {
        return {
          ruleId: rule.id,
          reason: `Possible duplicate: ₹${tx.amount} in ${tx.category} already recorded in last ${window}h`,
        };
      }
      break;
    }

    case 'frequency': {
      // More than N transactions in same category today (or this week/month)
      const period   = rule.period || 'day';
      const maxCount = rule.threshold || 3;
      let dateFilter = `date = '${today}'`;
      if (period === 'week') {
        const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
        dateFilter = `date >= '${weekAgo}'`;
      } else if (period === 'month') {
        dateFilter = `substr(date,1,7) = '${month}'`;
      }
      const countRow = get(
        `SELECT COUNT(*) AS cnt FROM transactions
         WHERE user_id = ? AND type = 'expense' AND category = ? AND ${dateFilter}`,
        [userId, tx.category]
      );
      if (countRow && countRow.cnt > maxCount) {
        return {
          ruleId: rule.id,
          reason: `Frequency alert: ${countRow.cnt} ${tx.category} transactions this ${period} (limit ${maxCount})`,
        };
      }
      break;
    }

    case 'merchant_block': {
      // Description contains a blocked keyword
      const blocked = (rule.category || '').toLowerCase().split(',').map(s => s.trim());
      const desc    = (tx.description || '').toLowerCase();
      const hit     = blocked.find(k => k && desc.includes(k));
      if (hit) {
        return {
          ruleId: rule.id,
          reason: `Blocked merchant keyword "${hit}" found in transaction description`,
        };
      }
      break;
    }
  }

  return null;
}

/**
 * Get unresolved flags for a user
 */
function getFlags(userId) {
  return all(
    `SELECT pf.*, t.amount, t.category, t.description, t.date, sp.rule_type
     FROM policy_flags pf
     LEFT JOIN transactions t ON t.id = pf.transaction_id
     LEFT JOIN spending_policies sp ON sp.id = pf.rule_id
     WHERE pf.user_id = ? AND pf.resolved = 0
     ORDER BY pf.created_at DESC`,
    [userId]
  );
}

function resolveFlag(flagId, userId) {
  return run('UPDATE policy_flags SET resolved = 1 WHERE id = ? AND user_id = ?', [flagId, userId]);
}

module.exports = { evaluatePolicies, getFlags, resolveFlag };
