/**
 * subscriptionDetector.js — AI-powered waste & subscription detection.
 * Analyzes transaction history to find:
 *   1. Recurring charges (weekly/monthly/annual) you may have forgotten
 *   2. Duplicate vendor payments (same vendor, similar amount, same month)
 *   3. Unused SaaS / trial subscriptions
 *   4. Inefficient spending patterns
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { all, get } = require('../../database');
const { GoogleGenerativeAI } = require('@google/generative-ai');

let genAI = null;
function getClient() {
  if (!genAI) {
    if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set in .env');
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  }
  return genAI;
}

/**
 * Run all waste detection analyses for a user.
 * @returns {Object} { subscriptions, duplicates, patterns, aiInsights, potentialSavings }
 */
async function runWasteReport(userId) {
  const txs = all(
    `SELECT * FROM transactions WHERE user_id = ? AND type = 'expense' ORDER BY date DESC`,
    [userId]
  );

  const [subscriptions, duplicates, patterns] = await Promise.all([
    detectSubscriptions(txs),
    detectDuplicates(txs),
    detectPatterns(txs),
  ]);

  const potentialSavings = [
    ...subscriptions.filter(s => s.status === 'possibly_unused'),
    ...duplicates,
  ].reduce((sum, item) => sum + (item.monthlyAmount || item.amount || 0), 0);

  // AI insights (optional — graceful fallback)
  let aiInsights = [];
  try {
    aiInsights = await generateAiInsights(txs, { subscriptions, duplicates, patterns });
  } catch (_) {}

  const wasteful = [
    ...duplicates.map(d => ({
      category: d.category,
      reason: d.message,
      amount: d.amount
    })),
    ...patterns.map(p => ({
      category: p.category,
      reason: p.message,
      amount: p.amount
    }))
  ];

  let tips = [];
  if (aiInsights && aiInsights.length > 0) {
    tips = aiInsights.map(insight => `${insight.title}: ${insight.message}`);
  } else {
    tips = [
      "Review your 'Other Expense' category to ensure transactions are tagged accurately.",
      "Consider setting up budget caps on categories where you see frequent spikes.",
      "Track your recurring bills as templates in the Automations tab to auto-log them."
    ];
  }

  return { subscriptions, duplicates, patterns, aiInsights, potentialSavings, wasteful, tips };
}

/**
 * Detect recurring charges that look like subscriptions
 */
function detectSubscriptions(txs) {
  // Group by rounded amount + similar description (within 10%)
  const groups = {};

  for (const tx of txs) {
    const key = `${tx.category}__${Math.round(tx.amount / 10) * 10}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(tx);
  }

  const subscriptions = [];
  const KNOWN_SUBS = ['netflix', 'hotstar', 'spotify', 'prime', 'youtube', 'notion', 'github', 'adobe', 'microsoft', 'google', 'slack', 'zoom', 'dropbox', 'canva', 'figma', 'chatgpt', 'openai'];

  for (const [key, items] of Object.entries(groups)) {
    if (items.length < 2) continue;

    // Sort by date
    const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date));

    // Check if monthly recurring (25-35 day gaps)
    const isMonthly = sorted.length >= 2 && checkIntervalConsistency(sorted, 25, 35);
    const isAnnual  = sorted.length >= 2 && checkIntervalConsistency(sorted, 355, 370);
    const isWeekly  = sorted.length >= 3 && checkIntervalConsistency(sorted, 6, 8);

    if (!isMonthly && !isAnnual && !isWeekly) continue;

    const lastCharge   = sorted[sorted.length - 1];
    const daysSinceLast = Math.floor((Date.now() - new Date(lastCharge.date)) / 86400000);
    const desc         = (lastCharge.description || '').toLowerCase();
    const isKnown      = KNOWN_SUBS.some(s => desc.includes(s));
    const monthlyAmount = isAnnual ? items[0].amount / 12 : items[0].amount;

    subscriptions.push({
      description:  lastCharge.description || lastCharge.category,
      category:     lastCharge.category,
      amount:       lastCharge.amount,
      monthlyAmount: Math.round(monthlyAmount),
      frequency:    isAnnual ? 'annual' : isWeekly ? 'weekly' : 'monthly',
      occurrences:  items.length,
      lastCharge:   lastCharge.date,
      daysSinceLast,
      isKnownService: isKnown,
      status:       daysSinceLast > 45 && isMonthly ? 'possibly_cancelled'
                  : isKnown ? 'active_subscription'
                  : 'recurring_expense',
      transactions: items.map(t => t.id),
    });
  }

  // Also flag description-based known subscriptions
  for (const tx of txs) {
    const desc = (tx.description || '').toLowerCase();
    const known = KNOWN_SUBS.find(s => desc.includes(s));
    if (known && !subscriptions.find(s => s.transactions?.includes(tx.id))) {
      subscriptions.push({
        description:  tx.description || tx.category,
        category:     tx.category,
        amount:       tx.amount,
        monthlyAmount: tx.amount,
        frequency:    'detected',
        occurrences:  1,
        lastCharge:   tx.date,
        daysSinceLast: Math.floor((Date.now() - new Date(tx.date)) / 86400000),
        isKnownService: true,
        status:       'active_subscription',
        transactions: [tx.id],
      });
    }
  }

  return subscriptions;
}

/**
 * Check if dates in sorted array have consistent intervals (in days)
 */
function checkIntervalConsistency(sorted, minDays, maxDays) {
  if (sorted.length < 2) return false;
  let consistent = 0;
  for (let i = 1; i < sorted.length; i++) {
    const days = (new Date(sorted[i].date) - new Date(sorted[i - 1].date)) / 86400000;
    if (days >= minDays && days <= maxDays) consistent++;
  }
  return consistent >= Math.floor(sorted.length / 2);
}

/**
 * Detect duplicate payments
 */
function detectDuplicates(txs) {
  const duplicates = [];
  const seen = {};

  for (const tx of txs) {
    // Key: amount + category + same week
    const week  = getWeekKey(tx.date);
    const key   = `${Math.round(tx.amount)}__${tx.category}__${week}`;

    if (seen[key] && seen[key].id !== tx.id) {
      duplicates.push({
        type:        'duplicate_payment',
        amount:      tx.amount,
        category:    tx.category,
        description: tx.description,
        date1:       seen[key].date,
        date2:       tx.date,
        txId1:       seen[key].id,
        txId2:       tx.id,
        savings:     tx.amount,
        message:     `Possible duplicate: ₹${tx.amount.toLocaleString('en-IN')} in ${tx.category} charged twice in the same week`,
      });
    } else {
      seen[key] = tx;
    }
  }

  return duplicates;
}

function getWeekKey(dateStr) {
  const d = new Date(dateStr);
  const jan1 = new Date(d.getFullYear(), 0, 1);
  return `${d.getFullYear()}-W${Math.ceil(((d - jan1) / 86400000 + jan1.getDay() + 1) / 7)}`;
}

/**
 * Detect spending pattern anomalies
 */
function detectPatterns(txs) {
  const patterns = [];
  const byCategory = {};

  for (const tx of txs) {
    if (!byCategory[tx.category]) byCategory[tx.category] = [];
    byCategory[tx.category].push(tx.amount);
  }

  for (const [cat, amounts] of Object.entries(byCategory)) {
    if (amounts.length < 3) continue;
    const avg = amounts.reduce((s, a) => s + a, 0) / amounts.length;
    const latest = amounts[0]; // most recent

    // Spike: latest transaction is 3x the average
    if (latest > avg * 3) {
      patterns.push({
        type:     'spending_spike',
        category: cat,
        amount:   latest,
        average:  Math.round(avg),
        ratio:    (latest / avg).toFixed(1),
        message:  `${cat}: latest transaction ₹${latest.toLocaleString('en-IN')} is ${(latest / avg).toFixed(1)}x your average of ₹${Math.round(avg).toLocaleString('en-IN')}`,
      });
    }
  }

  return patterns;
}

/**
 * Generate AI-powered natural language insights
 */
async function generateAiInsights(txs, { subscriptions, duplicates, patterns }) {
  if (!process.env.GEMINI_API_KEY) return [];

  const summary = {
    totalExpenses:    txs.reduce((s, t) => s + t.amount, 0),
    topCategories:    getTopCategories(txs),
    subscriptionCount: subscriptions.length,
    duplicateCount:    duplicates.length,
    patternCount:      patterns.length,
  };

  const prompt = `You are a financial advisor AI for an Indian personal finance app.
Based on this spending analysis, provide 3-5 actionable insights in simple language.

Data summary:
${JSON.stringify(summary, null, 2)}

Subscriptions detected: ${subscriptions.map(s => `${s.description} (₹${s.monthlyAmount}/mo)`).join(', ')}
Duplicates: ${duplicates.length}
Anomalies: ${patterns.map(p => p.message).join('; ')}

Return ONLY a JSON array of insight objects:
[{ "type": "saving" | "warning" | "tip", "title": "short title", "message": "actionable advice in 1-2 sentences", "savings": estimated monthly savings in INR or null }]
No markdown, just raw JSON.`;

  const client = getClient();
  const model  = client.getGenerativeModel({ model: 'gemini-1.5-flash' });
  const result = await model.generateContent(prompt);
  const raw    = result.response.text().trim().replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();
  return JSON.parse(raw);
}

function getTopCategories(txs) {
  const map = {};
  txs.forEach(t => { map[t.category] = (map[t.category] || 0) + t.amount; });
  return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([cat, total]) => ({ cat, total }));
}

module.exports = { runWasteReport };
