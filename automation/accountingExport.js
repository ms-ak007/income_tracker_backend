/**
 * accountingExport.js — Export transactions in standard accounting formats.
 *
 * Supported formats:
 *   - Tally XML    (ERP 9 / Prime VOUCHER format)
 *   - QuickBooks   (IIF format)
 *   - Zoho Books   (CSV)
 *   - Generic JSON (API-friendly)
 *   - Generic CSV  (for any spreadsheet tool)
 */

const { all, get } = require('../database');

// ── Tally XML ─────────────────────────────────────────────────────────────────
function toTallyXML(userId, { year, month } = {}) {
  const txs = fetchTransactions(userId, year, month);
  const companyName = 'FinFlow Personal';

  const vouchers = txs.map(tx => {
    const isIncome  = tx.type === 'income';
    const debitAcc  = isIncome ? tx.category      : 'Cash/Bank';
    const creditAcc = isIncome ? 'Cash/Bank'      : tx.category;
    const narration = tx.description || tx.category;
    const date      = tx.date.replace(/-/g, '');  // YYYYMMDD

    return `    <VOUCHER VCHTYPE="Journal" ACTION="Create" OBJVIEW="Accounting Voucher View">
      <DATE>${date}</DATE>
      <NARRATION>${escXml(narration)}</NARRATION>
      <VOUCHERTYPENAME>Journal</VOUCHERTYPENAME>
      <ALLLEDGERENTRIES.LIST>
        <LEDGERNAME>${escXml(debitAcc)}</LEDGERNAME>
        <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
        <AMOUNT>-${tx.amount.toFixed(2)}</AMOUNT>
      </ALLLEDGERENTRIES.LIST>
      <ALLLEDGERENTRIES.LIST>
        <LEDGERNAME>${escXml(creditAcc)}</LEDGERNAME>
        <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
        <AMOUNT>${tx.amount.toFixed(2)}</AMOUNT>
      </ALLLEDGERENTRIES.LIST>
    </VOUCHER>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>${escXml(companyName)}</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
${vouchers}
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;
}

function escXml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── QuickBooks IIF ────────────────────────────────────────────────────────────
function toQuickBooksIIF(userId, { year, month } = {}) {
  const txs = fetchTransactions(userId, year, month);

  const header = `!TRNS\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tMEMO\n!SPL\tTRNSTYPE\tDATE\tACCNT\tAMOUNT\tMEMO\n!ENDTRNS`;

  const rows = txs.map(tx => {
    const date     = formatQBDate(tx.date);
    const type     = tx.type === 'income' ? 'DEPOSIT' : 'CHECK';
    const amount   = tx.type === 'income' ? tx.amount : -tx.amount;
    const splitAmt = -amount;
    const account  = tx.type === 'income' ? 'Checking' : tx.category;
    const splitAcc = tx.type === 'income' ? tx.category : 'Checking';
    const memo     = tx.description || tx.category;

    return `TRNS\t${type}\t${date}\t${account}\t${memo}\t${amount.toFixed(2)}\t${memo}
SPL\t${type}\t${date}\t${splitAcc}\t${splitAmt.toFixed(2)}\t${memo}
ENDTRNS`;
  }).join('\n');

  return header + '\n' + rows;
}

function formatQBDate(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return `${m}/${d}/${y}`;
}

// ── Zoho Books CSV ────────────────────────────────────────────────────────────
function toZohoCSV(userId, { year, month } = {}) {
  const txs = fetchTransactions(userId, year, month);

  const headers = ['Date', 'Transaction Type', 'Category', 'Description', 'Amount (INR)', 'Account', 'Reference'];
  const rows = txs.map(tx => [
    tx.date,
    tx.type === 'income' ? 'Income' : 'Expense',
    tx.category,
    tx.description || '',
    tx.amount.toFixed(2),
    tx.paid_from || 'Cash/Bank',
    `TXN-${tx.id}`,
  ]);

  return [headers, ...rows].map(row =>
    row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')
  ).join('\r\n');
}

// ── Generic CSV ───────────────────────────────────────────────────────────────
function toGenericCSV(userId, { year, month } = {}) {
  const txs = fetchTransactions(userId, year, month);
  const user = get('SELECT name, email FROM users WHERE id = ?', [userId]);

  const summary = computeSummary(txs);
  const headers = ['Date', 'Type', 'Category', 'Description', 'Amount (₹)', 'Paid From', 'Created At'];

  const topRows = [
    [`FinFlow Export — ${user?.name || 'User'}`],
    [`Generated: ${new Date().toLocaleString('en-IN')}`],
    [],
    ['SUMMARY'],
    ['Total Income', summary.totalIncome.toFixed(2)],
    ['Total Expense', summary.totalExpense.toFixed(2)],
    ['Net Balance', summary.net.toFixed(2)],
    ['Transaction Count', txs.length],
    [],
    headers,
    ...txs.map(tx => [
      tx.date,
      tx.type,
      tx.category,
      tx.description || '',
      tx.amount.toFixed(2),
      tx.paid_from || '',
      tx.created_at || '',
    ]),
  ];

  return topRows.map(row =>
    row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')
  ).join('\r\n');
}

// ── Generic JSON ──────────────────────────────────────────────────────────────
function toGenericJSON(userId, { year, month } = {}) {
  const txs    = fetchTransactions(userId, year, month);
  const user   = get('SELECT id, name, email FROM users WHERE id = ?', [userId]);
  const summary = computeSummary(txs);

  return {
    exportedAt:   new Date().toISOString(),
    user:         { id: user.id, name: user.name },
    period:       { year: year || 'all', month: month || 'all' },
    summary,
    transactions: txs,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fetchTransactions(userId, year, month) {
  if (month) {
    const monthStr = `${year}-${String(month).padStart(2, '0')}`;
    return all(
      `SELECT * FROM transactions WHERE user_id = ? AND substr(date,1,7) = ? ORDER BY date ASC, id ASC`,
      [userId, monthStr]
    );
  }
  if (year) {
    return all(
      `SELECT * FROM transactions WHERE user_id = ? AND substr(date,1,4) = ? ORDER BY date ASC, id ASC`,
      [userId, String(year)]
    );
  }
  return all(
    `SELECT * FROM transactions WHERE user_id = ? ORDER BY date ASC, id ASC`,
    [userId]
  );
}

function computeSummary(txs) {
  return {
    totalIncome:  txs.filter(t => t.type === 'income' ).reduce((s, t) => s + t.amount, 0),
    totalExpense: txs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0),
    get net() { return this.totalIncome - this.totalExpense; },
    count: txs.length,
  };
}

module.exports = { toTallyXML, toQuickBooksIIF, toZohoCSV, toGenericCSV, toGenericJSON };
