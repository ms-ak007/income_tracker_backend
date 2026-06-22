/**
 * bankParser.js — Gmail IMAP poller that reads bank transaction SMS-forwarded emails
 * and auto-creates transactions in FinFlow.
 *
 * Setup: Forward your bank SMS alerts to a Gmail address, then enable IMAP
 * and create an App Password. Enter credentials in the Automations settings panel.
 *
 * Supported banks/services (Indian):
 * HDFC, SBI, ICICI, Axis, Kotak, Yes Bank, IndusInd,
 * Paytm, PhonePe, Google Pay, Amazon Pay, CRED
 */

const Imap       = require('imap');
const { simpleParser } = require('mailparser');
const { run, get }    = require('../database');

// ── Transaction patterns ───────────────────────────────────────────────────────
// Each pattern must have named groups: type ('credited'/'debited'), amount, description (optional)
const BANK_PATTERNS = [
  // HDFC: "Rs.500.00 debited from a/c ...XXXX on 20-Jun-26. Info: UPI-SWIGGY"
  {
    name: 'HDFC',
    regex: /Rs\.?([\d,]+\.?\d{0,2})\s+(debited|credited)\s+(?:from|to)\s+[aA]\/[cC]\s+[\w\s]+?(?:Info|UPI|Ref)?[:\s-]*([^\.\n]+)/i,
    map: (m) => ({ amount: parseFloat(m[1].replace(/,/g, '')), type: m[2].toLowerCase() === 'debited' ? 'expense' : 'income', description: m[3]?.trim() }),
  },
  // SBI: "Your A/c ...1234 is debited with INR 1,200.00 on 20Jun26 by UPI/PHONEPE"
  {
    name: 'SBI',
    regex: /[Aa]\/[Cc]\s+[\w]+\s+is\s+(debited|credited)\s+with\s+(?:INR|Rs\.?)\s*([\d,]+\.?\d{0,2})\s+on\s+[\dA-Za-z]+\s+(?:by\s+)?([^\.\n]+)?/i,
    map: (m) => ({ amount: parseFloat(m[2].replace(/,/g, '')), type: m[1].toLowerCase() === 'debited' ? 'expense' : 'income', description: m[3]?.trim() }),
  },
  // ICICI: "ICICI Bank Account XX1234 has been debited with INR 500.00 on 20-Jun-2026."
  {
    name: 'ICICI',
    regex: /ICICI Bank Account\s+[\w]+\s+has\s+been\s+(debited|credited)\s+with\s+(?:INR|Rs\.?)\s*([\d,]+\.?\d{0,2})/i,
    map: (m) => ({ amount: parseFloat(m[2].replace(/,/g, '')), type: m[1].toLowerCase() === 'debited' ? 'expense' : 'income', description: 'ICICI Bank Transaction' }),
  },
  // Axis: "INR 1500.00 debited from Axis Bank Account XX1234"
  {
    name: 'Axis',
    regex: /(?:INR|Rs\.?)\s*([\d,]+\.?\d{0,2})\s+(debited from|credited to)\s+Axis Bank/i,
    map: (m) => ({ amount: parseFloat(m[1].replace(/,/g, '')), type: m[2].toLowerCase().includes('debit') ? 'expense' : 'income', description: 'Axis Bank Transaction' }),
  },
  // Kotak: "Your Kotak Bank a/c XX1234 is debited by Rs 750"
  {
    name: 'Kotak',
    regex: /Kotak Bank.*?is\s+(debited|credited)\s+by\s+(?:Rs\.?|INR)\s*([\d,]+\.?\d{0,2})/i,
    map: (m) => ({ amount: parseFloat(m[2].replace(/,/g, '')), type: m[1].toLowerCase() === 'debited' ? 'expense' : 'income', description: 'Kotak Bank Transaction' }),
  },
  // Paytm: "Paytm: Rs.200 paid to MERCHANT on 20-Jun-26"
  {
    name: 'Paytm',
    regex: /Paytm.*?(?:Rs\.?|INR)\s*([\d,]+\.?\d{0,2})\s+(paid to|received from)\s+([^\.\n]+)/i,
    map: (m) => ({ amount: parseFloat(m[1].replace(/,/g, '')), type: m[2].toLowerCase().includes('paid') ? 'expense' : 'income', description: m[3]?.trim() || 'Paytm' }),
  },
  // PhonePe: "₹500 Debited from your PhonePe Wallet to SWIGGY"
  {
    name: 'PhonePe',
    regex: /₹\s*([\d,]+\.?\d{0,2})\s+(Debited|Credited)\s+(?:from|to)\s+(?:your\s+)?PhonePe.*?(?:to|from)\s+([^\.\n]+)/i,
    map: (m) => ({ amount: parseFloat(m[1].replace(/,/g, '')), type: m[2].toLowerCase() === 'debited' ? 'expense' : 'income', description: m[3]?.trim() || 'PhonePe' }),
  },
  // Generic UPI: "You have sent Rs 350 to merchant@upi"
  {
    name: 'UPI Generic',
    regex: /(?:You have sent|Sent)\s+(?:Rs\.?|INR|₹)\s*([\d,]+\.?\d{0,2})\s+to\s+([^\s\.\n]+)/i,
    map: (m) => ({ amount: parseFloat(m[1].replace(/,/g, '')), type: 'expense', description: m[2]?.trim() }),
  },
  // Generic Credit: "Received Rs 5000 from employer@upi"
  {
    name: 'UPI Credit',
    regex: /[Rr]eceived\s+(?:Rs\.?|INR|₹)\s*([\d,]+\.?\d{0,2})\s+from\s+([^\s\.\n]+)/i,
    map: (m) => ({ amount: parseFloat(m[1].replace(/,/g, '')), type: 'income', description: m[2]?.trim() }),
  },
];

// ── Auto-categorize based on description keywords ─────────────────────────────
function guessCategory(description, type) {
  if (type === 'income') {
    const d = (description || '').toLowerCase();
    if (d.includes('salary') || d.includes('payroll')) return 'Salary';
    if (d.includes('freelance') || d.includes('invoice'))  return 'Freelance';
    if (d.includes('interest') || d.includes('fd'))        return 'Interest';
    return 'Other Income';
  }
  const d = (description || '').toLowerCase();
  if (d.includes('swiggy') || d.includes('zomato') || d.includes('food') || d.includes('restaurant')) return 'Food';
  if (d.includes('uber') || d.includes('ola') || d.includes('metro') || d.includes('train'))          return 'Transport';
  if (d.includes('amazon') || d.includes('flipkart') || d.includes('myntra'))                         return 'Shopping';
  if (d.includes('netflix') || d.includes('hotstar') || d.includes('spotify') || d.includes('prime')) return 'Entertainment';
  if (d.includes('electricity') || d.includes('water') || d.includes('gas') || d.includes('bill'))    return 'Utilities';
  if (d.includes('rent') || d.includes('maintenance'))                                                  return 'Rent';
  if (d.includes('hospital') || d.includes('pharmacy') || d.includes('doctor'))                       return 'Healthcare';
  if (d.includes('school') || d.includes('college') || d.includes('fee'))                             return 'Education';
  return 'Other';
}

// ── Parse a message body for a known bank pattern ─────────────────────────────
function parseMessage(text) {
  for (const pattern of BANK_PATTERNS) {
    const m = text.match(pattern.regex);
    if (m) {
      try {
        const parsed = pattern.map(m);
        if (parsed.amount && parsed.amount > 0) {
          return { ...parsed, source: pattern.name };
        }
      } catch (_) {}
    }
  }
  return null;
}

// ── IMAP fetch unread emails ───────────────────────────────────────────────────
function fetchUnreadEmails(imapUser, imapPass) {
  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user:     imapUser,
      password: imapPass,
      host:     'imap.gmail.com',
      port:     993,
      tls:      true,
      tlsOptions: { rejectUnauthorized: false },
      connTimeout: 15000,
      authTimeout: 10000,
    });

    const emails = [];

    imap.once('ready', () => {
      imap.openBox('INBOX', false, (err, box) => {
        if (err) { imap.end(); return reject(err); }

        imap.search(['UNSEEN'], (err, results) => {
          if (err || !results || !results.length) { imap.end(); return resolve([]); }

          const fetch = imap.fetch(results, { bodies: '', markSeen: true });

          fetch.on('message', (msg) => {
            let buffer = '';
            msg.on('body', (stream) => stream.on('data', c => buffer += c));
            msg.once('end', async () => {
              try {
                const parsed = await simpleParser(buffer);
                const text = (parsed.text || '') + ' ' + (parsed.subject || '');
                emails.push(text);
              } catch (_) {}
            });
          });

          fetch.once('end', () => { imap.end(); });
        });
      });
    });

    imap.once('end', () => resolve(emails));
    imap.once('error', (err) => reject(err));
    imap.connect();
  });
}

// ── Main poller function called by scheduler ───────────────────────────────────
async function pollBankEmails(user) {
  if (!user.imap_user || !user.imap_pass) return;

  console.log(`[BankParser] Polling Gmail for user ${user.id} (${user.imap_user})`);

  let emails;
  try {
    emails = await fetchUnreadEmails(user.imap_user, user.imap_pass);
  } catch (err) {
    console.error(`[BankParser] IMAP error for user ${user.id}:`, err.message);
    return;
  }

  let imported = 0;
  const todayStr = new Date().toISOString().slice(0, 10);

  for (const emailText of emails) {
    const parsed = parseMessage(emailText);
    if (!parsed) continue;

    const category = guessCategory(parsed.description, parsed.type);

    try {
      run(
        `INSERT INTO transactions (user_id, type, category, amount, description, date, paid_from)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          user.id,
          parsed.type,
          category,
          parsed.amount,
          `[Auto] ${parsed.description || parsed.source}`,
          todayStr,
          parsed.type === 'expense' ? null : null,
        ]
      );
      imported++;
      console.log(`[BankParser] Imported: ${parsed.type} ₹${parsed.amount} (${category}) — ${parsed.description}`);
    } catch (err) {
      console.error('[BankParser] Insert error:', err.message);
    }
  }

  if (imported > 0) {
    // Update last_polled timestamp in user_settings
    run(`UPDATE user_settings SET bank_last_polled = datetime('now'), bank_last_count = ? WHERE user_id = ?`,
      [imported, user.id]);
  }

  console.log(`[BankParser] Done for user ${user.id}: ${imported}/${emails.length} emails matched`);
}

module.exports = { pollBankEmails, parseMessage, guessCategory };
