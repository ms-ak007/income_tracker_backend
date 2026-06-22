/**
 * taxEngine.js — Indian income tax compliance engine.
 * Tags transactions with deductibility under IT Act sections.
 * Generates audit-ready reports per financial year (Apr–Mar).
 *
 * Sections covered: 80C, 80D, HRA, 80E, 80G, business expense, LTA
 */

const { all, get, run } = require('../database');

// ── Tax Section Mappings ───────────────────────────────────────────────────────
const TAX_SECTION_MAP = {
  'Insurance':           { section: '80C', cap: 150000, label: 'Life Insurance Premium', deductible: true },
  'Healthcare':          { section: '80D', cap: 25000,  label: 'Health Insurance / Medical', deductible: true },
  'Education':           { section: '80C/80E', cap: 150000, label: 'Tuition / Education Loan Interest', deductible: true },
  'Rent / EMI':          { section: 'HRA/24b', cap: null,   label: 'House Rent / Home Loan Interest', deductible: true, partial: true },
  'Investment Returns':  { section: 'LTCG/STCG', cap: 100000, label: 'Capital Gains', deductible: false, taxable: true },
  'Subscriptions':       { section: 'Business', cap: null, label: 'Business Subscription', deductible: true, partial: true },
  'Transportation':      { section: 'LTA', cap: null, label: 'Leave Travel Allowance', deductible: true, partial: true },
  'Food & Dining':       { section: 'Business', cap: null, label: 'Business Entertainment', deductible: false },
  'Other Expense':       { section: null, cap: null, label: null, deductible: false },
};

// Categories always fully deductible (for salaried + business)
const ALWAYS_DEDUCTIBLE = ['Insurance', 'Healthcare'];
// Categories deductible only for business/freelancers
const BUSINESS_DEDUCTIBLE = ['Subscriptions', 'Transportation', 'Food & Dining'];

/**
 * Get the Indian financial year string for a date.
 * FY Apr 1 to Mar 31
 */
function getFinancialYear(dateStr) {
  const d = new Date(dateStr);
  const year = d.getFullYear();
  const month = d.getMonth() + 1; // 1-12
  return month >= 4 ? `${year}-${String(year + 1).slice(-2)}` : `${year - 1}-${String(year).slice(-2)}`;
}

function getFYDateRange(fy) {
  // e.g. "2025-26" → Apr 2025 to Mar 2026
  const startYear = parseInt(fy.split('-')[0]);
  return {
    start: `${startYear}-04-01`,
    end:   `${startYear + 1}-03-31`,
  };
}

/**
 * Generate tax deduction report for a financial year.
 */
function generateTaxReport(userId, fy) {
  const { start, end } = getFYDateRange(fy);

  const txs = all(
    `SELECT t.*, tt.tax_section, tt.is_deductible
     FROM transactions t
     LEFT JOIN tax_tags tt ON tt.transaction_id = t.id AND tt.user_id = t.user_id
     WHERE t.user_id = ? AND t.date >= ? AND t.date <= ?
     ORDER BY t.date ASC`,
    [userId, start, end]
  );

  const deductible   = [];
  const nonDeductible = [];
  const taxable      = [];
  const sectionTotals = {};

  for (const tx of txs) {
    const mapping = TAX_SECTION_MAP[tx.category] || { section: null, deductible: false };
    const isDeductible = tx.is_deductible !== null
      ? Boolean(tx.is_deductible)
      : (mapping.deductible && tx.type === 'expense');

    const isTaxable = mapping.taxable && tx.type === 'income';

    const entry = {
      id:          tx.id,
      date:        tx.date,
      category:    tx.category,
      description: tx.description,
      amount:      tx.amount,
      type:        tx.type,
      section:     tx.tax_section || mapping.section,
      label:       mapping.label,
      partial:     mapping.partial || false,
    };

    if (isTaxable) {
      taxable.push(entry);
    } else if (isDeductible) {
      deductible.push(entry);
      const sec = entry.section || 'Other';
      if (!sectionTotals[sec]) sectionTotals[sec] = { total: 0, cap: mapping.cap, entries: [] };
      sectionTotals[sec].total += tx.amount;
      sectionTotals[sec].entries.push(entry);
    } else {
      nonDeductible.push(entry);
    }
  }

  // Compute actual deduction (capped per section)
  let totalDeductionClaimed = 0;
  const sectionSummary = Object.entries(sectionTotals).map(([section, data]) => {
    const effectiveDeduction = data.cap ? Math.min(data.total, data.cap) : data.total;
    totalDeductionClaimed += effectiveDeduction;
    return {
      section,
      totalSpent:        Math.round(data.total),
      cap:               data.cap,
      effectiveDeduction: Math.round(effectiveDeduction),
      utilizationPct:    data.cap ? Math.round((data.total / data.cap) * 100) : 100,
      transactionCount:  data.entries.length,
    };
  });

  const totalIncome  = txs.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const totalExpense = txs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);

  // Estimated tax saved (assuming 30% bracket for illustration)
  const taxSavedEstimate = Math.round(totalDeductionClaimed * 0.3);

  return {
    financialYear:   fy,
    dateRange:       { start, end },
    totalIncome:     Math.round(totalIncome),
    totalExpense:    Math.round(totalExpense),
    deductibleTotal: Math.round(deductible.reduce((s, t) => s + t.amount, 0)),
    totalDeductionClaimed: Math.round(totalDeductionClaimed),
    taxSavedEstimate,
    sectionSummary,
    deductibleTransactions:    deductible,
    nonDeductibleTransactions: nonDeductible,
    taxableIncome:             taxable,
    transactionCount:          txs.length,
  };
}

/**
 * Get available financial years with data.
 */
function getAvailableFinancialYears(userId) {
  const dates = all(
    `SELECT DISTINCT substr(date, 1, 7) AS month FROM transactions WHERE user_id = ? ORDER BY month`,
    [userId]
  );
  const fys = new Set();
  dates.forEach(({ month }) => fys.add(getFinancialYear(month + '-01')));
  return [...fys].sort().reverse();
}

/**
 * Auto-tag all transactions for a user (non-destructive — only sets if not already tagged).
 */
function autoTagTransactions(userId) {
  const txs = all(
    `SELECT t.id, t.category, t.type FROM transactions t
     LEFT JOIN tax_tags tt ON tt.transaction_id = t.id AND tt.user_id = t.user_id
     WHERE t.user_id = ? AND tt.id IS NULL`,
    [userId]
  );

  let tagged = 0;
  for (const tx of txs) {
    const mapping = TAX_SECTION_MAP[tx.category];
    if (!mapping) continue;
    const isDeductible = mapping.deductible && tx.type === 'expense' ? 1 : 0;
    try {
      run(
        `INSERT OR IGNORE INTO tax_tags (user_id, transaction_id, tax_section, is_deductible)
         VALUES (?, ?, ?, ?)`,
        [userId, tx.id, mapping.section, isDeductible]
      );
      tagged++;
    } catch (_) {}
  }
  return tagged;
}

/**
 * Override tax tag for a specific transaction.
 */
function setTaxTag(userId, txId, { taxSection, isDeductible }) {
  run(
    `INSERT OR REPLACE INTO tax_tags (user_id, transaction_id, tax_section, is_deductible)
     VALUES (?, ?, ?, ?)`,
    [userId, txId, taxSection, isDeductible ? 1 : 0]
  );
}

module.exports = { generateTaxReport, getAvailableFinancialYears, autoTagTransactions, setTaxTag, getFinancialYear };
