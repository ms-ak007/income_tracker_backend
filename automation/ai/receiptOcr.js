/**
 * receiptOcr.js — Two-stage receipt processing:
 *  Stage 1: Tesseract.js  → extract raw text from image
 *  Stage 2: Gemini Vision → parse into structured line items
 *
 * Returns: { vendor, date, totalAmount, lineItems, taxTotal, category, rawText }
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const Tesseract = require('tesseract.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs   = require('fs');
const path = require('path');

let genAI = null;

function getClient() {
  if (!genAI) {
    if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set in .env');
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  }
  return genAI;
}

const RECEIPT_PROMPT = `You are a receipt parser for an Indian personal finance app.
I will give you the OCR text from a receipt or invoice. Extract structured data.

Return ONLY a valid JSON object:
{
  "vendor": "store/restaurant/service name",
  "date": "YYYY-MM-DD or null",
  "totalAmount": number (final total paid, in INR),
  "subtotal": number or null,
  "taxTotal": number or null (GST/VAT/service charge),
  "lineItems": [
    { "name": "item name", "qty": number, "unitPrice": number, "totalPrice": number, "taxRate": "18%" or null }
  ],
  "category": "Food & Dining" | "Shopping" | "Healthcare" | "Transportation" | "Utilities" | "Entertainment" | "Education" | "Other Expense",
  "paymentMethod": "Cash" | "UPI" | "Card" | "Net Banking" | null,
  "invoiceNumber": "string or null",
  "gstin": "vendor GSTIN or null",
  "confidence": 0.0 to 1.0
}

Rules:
- Focus on the FINAL total — not subtotals
- GST is usually 5%, 12%, 18%, or 28% in India
- If the receipt is in Hindi/Tamil/Telugu, still return English output
- If a field cannot be determined, use null
- NEVER return markdown — only raw JSON

OCR Text:
{{OCR_TEXT}}`;

/**
 * Stage 1: Extract text from image using Tesseract
 */
async function extractTextFromImage(imagePath) {
  try {
    const { data: { text, confidence } } = await Tesseract.recognize(imagePath, 'eng+hin', {
      logger: () => {}, // suppress progress logs
    });
    return { text: text.trim(), confidence: confidence / 100 };
  } catch (err) {
    throw new Error('OCR failed: ' + err.message);
  }
}

/**
 * Stage 2: Parse OCR text with Gemini
 */
async function parseReceiptText(ocrText) {
  if (!ocrText || ocrText.length < 10) {
    return { error: 'OCR text too short to parse' };
  }

  try {
    const client = getClient();
    const model  = client.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const prompt = RECEIPT_PROMPT.replace('{{OCR_TEXT}}', ocrText.slice(0, 3000));
    const result = await model.generateContent(prompt);
    const raw    = result.response.text().trim();
    const cleaned = raw.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();

    return JSON.parse(cleaned);
  } catch (err) {
    // Fallback: simple regex extraction from raw text
    return fallbackParseReceipt(ocrText, err.message);
  }
}

/**
 * Stage 2 (Vision fallback): Send image directly to Gemini Vision
 */
async function parseReceiptViaVision(imagePath) {
  try {
    const client   = getClient();
    const model    = client.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const imageData = fs.readFileSync(imagePath);
    const base64    = imageData.toString('base64');
    const ext       = path.extname(imagePath).slice(1).toLowerCase();
    const mimeType  = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
                    : ext === 'png' ? 'image/png'
                    : ext === 'webp' ? 'image/webp'
                    : 'image/jpeg';

    const prompt = `You are a receipt parser. Look at this receipt image and extract data.
Return ONLY raw JSON with: vendor, date (YYYY-MM-DD), totalAmount (INR number), taxTotal, 
lineItems (array of {name, qty, unitPrice, totalPrice}), category, paymentMethod, confidence.
Do not include markdown.`;

    const result = await model.generateContent([
      prompt,
      { inlineData: { data: base64, mimeType } },
    ]);

    const raw     = result.response.text().trim();
    const cleaned = raw.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();
    return JSON.parse(cleaned);
  } catch (err) {
    return { error: 'Vision parse failed: ' + err.message };
  }
}

/**
 * Main: process an uploaded receipt image file
 * Tries: Tesseract+Gemini → Vision fallback → regex fallback
 */
async function processReceipt(imagePath) {
  let rawText = '';
  let ocrConfidence = 0;

  // Stage 1: OCR
  try {
    const ocr = await extractTextFromImage(imagePath);
    rawText = ocr.text;
    ocrConfidence = ocr.confidence;
  } catch (_) {}

  // Stage 2a: Parse OCR text with Gemini
  if (rawText.length > 20) {
    try {
      const parsed = await parseReceiptText(rawText);
      if (parsed && !parsed.error && parsed.totalAmount) {
        return { ...parsed, rawText, ocrConfidence, source: 'tesseract+gemini' };
      }
    } catch (_) {}
  }

  // Stage 2b: Gemini Vision (direct image)
  try {
    const visionResult = await parseReceiptViaVision(imagePath);
    if (visionResult && !visionResult.error && visionResult.totalAmount) {
      return { ...visionResult, rawText, ocrConfidence, source: 'gemini_vision' };
    }
  } catch (_) {}

  // Stage 3: Regex fallback
  return { ...fallbackParseReceipt(rawText), rawText, ocrConfidence, source: 'fallback' };
}

/**
 * Simple regex fallback
 */
function fallbackParseReceipt(text, aiError) {
  const amountMatch = text.match(/(?:total|grand total|amount|net payable)[^\d]*([\d,]+\.?\d{0,2})/i);
  const totalAmount = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : null;

  const taxMatch = text.match(/(?:gst|tax|vat|cgst|sgst)[^\d]*([\d,]+\.?\d{0,2})/i);
  const taxTotal = taxMatch ? parseFloat(taxMatch[1].replace(/,/g, '')) : null;

  const dateMatch = text.match(/(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/);
  let date = null;
  if (dateMatch) {
    const parts = dateMatch[1].split(/[-/]/);
    if (parts[2]?.length === 4) date = `${parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`;
    else if (parts[0]?.length === 4) date = `${parts[0]}-${parts[1].padStart(2,'0')}-${parts[2].padStart(2,'0')}`;
  }

  return {
    vendor:     null,
    date,
    totalAmount,
    subtotal:   null,
    taxTotal,
    lineItems:  [],
    category:   'Other Expense',
    paymentMethod: null,
    invoiceNumber: null,
    gstin:      null,
    confidence: totalAmount ? 0.3 : 0.1,
    aiError,
  };
}

module.exports = { processReceipt, extractTextFromImage, parseReceiptText };
