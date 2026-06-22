/**
 * cashFlowPredictor.js — Predicts future cash flow using historical transaction data.
 * Uses linear regression on income/expense trends + recurring transaction schedule.
 *
 * Returns: 6-month forecast with confidence bands and idle cash alerts.
 */

const { all, get } = require('../database');

/**
 * Generate a cash flow forecast for the next N months.
 * @param {number} userId
 * @param {number} monthsAhead — default 6
 * @param {number} historyMonths — months of history to use — default 6
 */
function generateForecast(userId, monthsAhead = 6, historyMonths = 6) {
  // ── 1. Load historical monthly summaries ──────────────────────────────────
  const history = all(
    `SELECT
       substr(date,1,7) AS month,
       SUM(CASE WHEN type='income'  THEN amount ELSE 0 END) AS income,
       SUM(CASE WHEN type='expense' THEN amount ELSE 0 END) AS expense,
       COUNT(*) AS txCount
     FROM transactions
     WHERE user_id = ?
     GROUP BY month
     ORDER BY month DESC
     LIMIT ?`,
    [userId, historyMonths]
  ).reverse(); // oldest first for regression

  if (history.length === 0) {
    return {
      historicalAvg: { income: 0, expense: 0 },
      dataMonths: 0,
      trends: { income: 0, expense: 0 },
      history: [],
      forecast: [],
      idleCash: [],
      message: 'Not enough data for forecast. Add some transactions first.'
    };
  }

  const incomes   = history.map(h => h.income);
  const expenses  = history.map(h => h.expense);

  // ── 2. Simple linear regression ───────────────────────────────────────────
  const incomeSlope    = linearRegressionSlope(incomes);
  const expenseSlope   = linearRegressionSlope(expenses);
  const avgIncome      = average(incomes);
  const avgExpense     = average(expenses);
  const stdIncome      = stddev(incomes);
  const stdExpense     = stddev(expenses);

  // ── 3. Load recurring transactions for exact future dates ─────────────────
  const recurring = all(
    `SELECT * FROM recurring_transactions WHERE user_id = ? AND active = 1`,
    [userId]
  );

  // ── 4. Build forecast months ───────────────────────────────────────────────
  const now          = new Date();
  const forecastMonths = [];

  for (let i = 1; i <= monthsAhead; i++) {
    const futureDate = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const monthStr   = futureDate.toISOString().slice(0, 7);

    // Trend-based prediction
    const trendIncome  = Math.max(0, avgIncome  + incomeSlope  * i);
    const trendExpense = Math.max(0, avgExpense + expenseSlope * i);

    // Add recurring transaction amounts
    let recurIncome  = 0;
    let recurExpense = 0;
    for (const r of recurring) {
      if (r.type === 'income')  recurIncome  += r.amount;
      if (r.type === 'expense') recurExpense += r.amount;
    }

    // Blended prediction (trend + recurring baseline)
    const predictedIncome  = Math.round((trendIncome  * 0.7 + recurIncome  * 0.3));
    const predictedExpense = Math.round((trendExpense * 0.7 + recurExpense * 0.3));
    const predictedNet     = predictedIncome - predictedExpense;

    // Confidence degrades with time
    const confidence = Math.max(0.3, 1 - (i - 1) * 0.12);

    // Confidence bands (±1 stddev)
    const incomeHigh  = Math.round(predictedIncome  + stdIncome);
    const incomeLow   = Math.round(Math.max(0, predictedIncome  - stdIncome));
    const expenseHigh = Math.round(predictedExpense + stdExpense);
    const expenseLow  = Math.round(Math.max(0, predictedExpense - stdExpense));

    forecastMonths.push({
      month:           monthStr,
      predictedIncome,
      predictedExpense,
      predictedNet,
      confidence:      Math.round(confidence * 100),
      incomeRange:     { low: incomeLow,  high: incomeHigh  },
      expenseRange:    { low: expenseLow, high: expenseHigh },
      recurringIncome:  Math.round(recurIncome),
      recurringExpense: Math.round(recurExpense),
    });
  }

  // ── 5. Idle cash analysis ──────────────────────────────────────────────────
  const idleCashAlerts = detectIdleCash(forecastMonths, avgIncome, avgExpense);

  // ── 6. Current balance estimate ────────────────────────────────────────────
  const currentMonthData = get(
    `SELECT
       COALESCE(SUM(CASE WHEN type='income'  THEN amount ELSE 0 END), 0) AS income,
       COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END), 0) AS expense
     FROM transactions WHERE user_id = ? AND substr(date,1,7) = ?`,
    [userId, now.toISOString().slice(0, 7)]
  );
  const currentMonthNet = (currentMonthData?.income || 0) - (currentMonthData?.expense || 0);

  // Estimate running balance (cumulative)
  let runningBalance = currentMonthNet;
  for (const m of forecastMonths) {
    runningBalance += m.predictedNet;
    m.estimatedBalance = Math.round(runningBalance);
  }

  const mappedForecast = forecastMonths.map(f => {
    let confStr = 'low';
    if (f.confidence >= 80) confStr = 'high';
    else if (f.confidence >= 50) confStr = 'medium';

    return {
      month: f.month,
      income: f.predictedIncome,
      expense: f.predictedExpense,
      net: f.predictedNet,
      confidence: confStr,
      estimatedBalance: f.estimatedBalance
    };
  });

  const mappedIdleCash = idleCashAlerts.map(alert => ({
    source: 'Idle Cash Alert',
    suggestion: alert.message,
    amount: alert.idleAmount
  }));

  return {
    historicalAvg: {
      income: Math.round(avgIncome),
      expense: Math.round(avgExpense),
    },
    dataMonths: history.length,
    trends: {
      income: avgIncome ? (incomeSlope / avgIncome) * 100 : 0,
      expense: avgExpense ? (expenseSlope / avgExpense) * 100 : 0,
    },
    history: history.map(h => ({
      month:   h.month,
      income:  h.income,
      expense: h.expense,
      net:     h.income - h.expense,
    })),
    forecast:        mappedForecast,
    idleCash:        mappedIdleCash,
    avgMonthlyIncome:  Math.round(avgIncome),
    avgMonthlyExpense: Math.round(avgExpense),
    avgMonthlySavings: Math.round(avgIncome - avgExpense),
    incomeTrend:       incomeSlope > 50 ? 'increasing' : incomeSlope < -50 ? 'decreasing' : 'stable',
    expenseTrend:      expenseSlope > 50 ? 'increasing' : expenseSlope < -50 ? 'decreasing' : 'stable',
    dataQuality:       history.length >= 4 ? 'good' : history.length >= 2 ? 'fair' : 'limited',
  };
}

/**
 * Detect months where idle cash exceeds a threshold and suggest investments
 */
function detectIdleCash(forecastMonths, avgIncome, avgExpense) {
  const alerts = [];
  const IDLE_THRESHOLD = avgIncome * 0.3; // >30% of avg income sitting idle

  let consecutivePositive = 0;
  let accumulatedIdle     = 0;

  for (const m of forecastMonths) {
    if (m.predictedNet > IDLE_THRESHOLD) {
      consecutivePositive++;
      accumulatedIdle += m.predictedNet;
    } else {
      consecutivePositive = 0;
      accumulatedIdle = 0;
    }

    if (consecutivePositive >= 2) {
      // Suggest investment options
      const fdRate    = 7.1; // Current SBI FD rate %
      const liquidRate = 7.0; // Liquid fund approx rate %
      const annualReturn = Math.round((accumulatedIdle * fdRate) / 100);

      alerts.push({
        month:           m.month,
        idleAmount:      Math.round(accumulatedIdle),
        consecutiveMonths: consecutivePositive,
        suggestions: [
          {
            type:         'Fixed Deposit (SBI/HDFC)',
            rate:         `${fdRate}% p.a.`,
            minAmount:    10000,
            lockIn:       '1 year',
            estimatedReturn: annualReturn,
            link:         'https://www.sbi.co.in/web/personal-banking/investments-deposits/deposits/fixed-deposit',
          },
          {
            type:         'Liquid Mutual Fund',
            rate:         `~${liquidRate}% p.a.`,
            minAmount:    500,
            lockIn:       'None (T+1 withdrawal)',
            estimatedReturn: Math.round((accumulatedIdle * liquidRate) / 100),
            link:         'https://groww.in/mutual-funds/category/liquid-funds',
          },
          {
            type:         'High-interest Savings (IDFC/AU)',
            rate:         '7% p.a.',
            minAmount:    0,
            lockIn:       'None',
            estimatedReturn: Math.round((accumulatedIdle * 7) / 100),
            link:         'https://www.idfcfirstbank.com/personal-banking/accounts/savings-account',
          },
        ],
        message: `You may have ₹${Math.round(accumulatedIdle).toLocaleString('en-IN')} idle over ${consecutivePositive} months. Investing could earn ~₹${annualReturn.toLocaleString('en-IN')}/year.`,
      });
    }
  }

  return alerts;
}

// ── Math helpers ───────────────────────────────────────────────────────────────
function average(arr) {
  return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
}

function stddev(arr) {
  if (arr.length < 2) return 0;
  const avg = average(arr);
  return Math.sqrt(arr.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / arr.length);
}

function linearRegressionSlope(values) {
  const n = values.length;
  if (n < 2) return 0;
  const xs    = values.map((_, i) => i);
  const xMean = average(xs);
  const yMean = average(values);
  const num   = xs.reduce((s, x, i) => s + (x - xMean) * (values[i] - yMean), 0);
  const den   = xs.reduce((s, x) => s + Math.pow(x - xMean, 2), 0);
  return den === 0 ? 0 : num / den;
}

module.exports = { generateForecast };
