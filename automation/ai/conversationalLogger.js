/**
 * conversationalLogger.js — Google Gemini NLP: natural language → transaction
 *
 * Examples:
 *   "Spent 1500 on AWS server costs today"
 *   "Got my freelance payment of ₹45,000 from Acme Corp"
 *   "Team lunch at Swiggy, split 4 ways, my share 680"
 *   "Netflix subscription 649 yesterday"
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { GoogleGenerativeAI } = require('@google/generative-ai');

let genAI = null;

function getClient() {
  if (!genAI) {
    if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set in .env');
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  }
  return genAI;
}

const SYSTEM_PROMPT = `You are a financial transaction parser for an Indian personal finance app.
Extract transaction details from the user's natural language input.

Today's date: {{TODAY}}

Return ONLY a valid JSON object with these exact fields:
{
  "type": "income" or "expense",
  "amount": number (positive, in INR — convert if needed),
  "category": one of the categories listed below,
  "description": short human-readable description (max 60 chars),
  "date": "YYYY-MM-DD" format,
  "merchant": merchant or payer name if mentioned (or null),
  "confidence": 0.0 to 1.0,
  "ambiguous": true if you're not sure about any field
}

Income categories: Salary, Freelance, Business, Investment Returns, Rental Income, Gift, Bonus, Other Income
Expense categories: Food & Dining, Rent / EMI, Transportation, Shopping, Utilities, Healthcare, Entertainment, Education, Insurance, Travel, Subscriptions, Other Expense

Rules:
- "today" → today's date, "yesterday" → yesterday, "this morning" → today
- ₹, Rs, INR, rupees all mean Indian Rupees
- If split (e.g. "split 4 ways"), use the individual share amount
- Subscriptions like Netflix, Spotify → Subscriptions category
- AWS, DigitalOcean, servers → Other Expense (or Subscriptions if recurring)
- Food delivery, restaurant, café → Food & Dining
- Petrol, Uber, Ola, metro → Transportation
- If amount is ambiguous, set confidence < 0.5
- NEVER return markdown or code blocks — only raw JSON`;

const INCOME_KEYWORDS = ['received', 'got paid', 'salary', 'freelance payment', 'earned', 'income', 'credited', 'received payment', 'transferred to me'];
const EXPENSE_KEYWORDS = ['spent', 'paid', 'bought', 'purchased', 'charged', 'debited', 'subscription', 'bill'];

/**
 * Extract transaction from natural language text.
 * @param {string} text — natural language input
 * @returns {Object} parsed transaction or { error }
 */
async function extractFromText(text) {
  if (!text || text.trim().length < 3) return { error: 'Input too short' };

  const today = new Date().toISOString().slice(0, 10);

  try {
    const client = getClient();
    const model  = client.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const prompt = SYSTEM_PROMPT.replace('{{TODAY}}', today) + '\n\nUser input: ' + text.trim();

    const result   = await model.generateContent(prompt);
    const raw      = result.response.text().trim();

    // Strip markdown code fences if present
    const cleaned  = raw.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();
    const parsed   = JSON.parse(cleaned);

    // Validate required fields
    if (!parsed.type || !parsed.amount || !parsed.date) {
      return { error: 'AI could not extract required fields', raw };
    }
    if (!['income', 'expense'].includes(parsed.type)) {
      return { error: 'Invalid type returned by AI', raw };
    }

    return {
      type:        parsed.type,
      amount:      Math.abs(Number(parsed.amount)),
      category:    parsed.category || (parsed.type === 'income' ? 'Other Income' : 'Other Expense'),
      description: parsed.description || text.slice(0, 60),
      date:        parsed.date || today,
      merchant:    parsed.merchant || null,
      confidence:  parsed.confidence || 0.8,
      ambiguous:   parsed.ambiguous || false,
      source:      'ai_text',
    };
  } catch (err) {
    // Fallback: simple regex extraction
    return fallbackExtract(text, err.message);
  }
}

/**
 * Extract from audio transcription (pass transcribed text)
 */
async function extractFromTranscription(transcribedText) {
  return extractFromText(transcribedText);
}

/**
 * Batch extract from forwarded message text (e.g. WhatsApp forward)
 */
async function extractFromForwardedMessage(messageText) {
  // Strip forwarding headers
  const cleaned = messageText
    .replace(/^Forwarded message\s*[-–:]\s*/im, '')
    .replace(/^From:.*$/im, '')
    .trim();
  return extractFromText(cleaned);
}

/**
 * Simple regex fallback when AI is unavailable
 */
function fallbackExtract(text, aiError) {
  let amount = null;
  const amountMatch = text.match(/(?:₹|rs\.?|inr|rupees?)\s*([\d,]+(?:\.\d{1,2})?)|(\b[\d,]+(?:\.\d{1,2})?)\s*(?:₹|rs|inr|rupees?)/i);
  
  if (amountMatch) {
    amount = parseFloat((amountMatch[1] || amountMatch[2]).replace(/,/g, ''));
  } else {
    // Search for any generic number in the text as a secondary fallback
    const genericMatch = text.match(/\b\d+(?:,\d{3})*(?:\.\d{1,2})?\b/);
    if (genericMatch) {
      amount = parseFloat(genericMatch[0].replace(/,/g, ''));
    }
  }

  const lower = text.toLowerCase();
  const isExpense = EXPENSE_KEYWORDS.some(k => lower.includes(k));
  const isIncome  = INCOME_KEYWORDS.some(k => lower.includes(k));
  const type = isIncome ? 'income' : 'expense';

  const today = new Date().toISOString().slice(0, 10);

  return {
    type,
    amount:      amount !== null ? amount : 0,
    category:    type === 'income' ? 'Other Income' : 'Other Expense',
    description: text.slice(0, 60),
    date:        today,
    merchant:    null,
    confidence:  amount !== null ? 0.4 : 0.1,
    ambiguous:   true,
    source:      'fallback',
    aiError,
  };
}

module.exports = { extractFromText, extractFromTranscription, extractFromForwardedMessage };
