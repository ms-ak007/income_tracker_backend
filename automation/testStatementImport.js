const fs = require('fs');
const path = require('path');

const PORT = 3000;
const BASE_URL = `http://localhost:${PORT}`;

async function runTest() {
  console.log('Starting end-to-end API test...');

  // 1. Sign up a new user
  const email = `test-${Date.now()}@finflow.com`;
  console.log(`Signing up user with email: ${email}`);
  let res = await fetch(`${BASE_URL}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Test Statement User',
      email: email,
      password: 'password123'
    })
  });

  if (!res.ok) {
    console.error('Signup failed:', await res.text());
    process.exit(1);
  }

  const signupData = await res.json();
  const token = signupData.token;
  console.log('✅ Signup successful. Token received.');

  // 2. Upload statement CSV
  console.log('Uploading bank statement CSV...');
  const csvPath = path.join(__dirname, '../../mock_hdfc.csv');
  const csvContent = fs.readFileSync(csvPath);

  // We construct a multipart/form-data payload manually or using standard FormData if available in Node 18+
  const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\n`),
    Buffer.from('Content-Disposition: form-data; name="statement"; filename="mock_hdfc.csv"\r\n'),
    Buffer.from('Content-Type: text/csv\r\n\r\n'),
    csvContent,
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ]);

  res = await fetch(`${BASE_URL}/api/bank/import-statement`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`
    },
    body: payload
  });

  if (!res.ok) {
    console.error('Upload statement failed:', await res.text());
    process.exit(1);
  }

  const importResult = await res.json();
  console.log('✅ Upload successful. Parsed transactions count:', importResult.count);
  console.log('Parsed transactions:', JSON.stringify(importResult.transactions, null, 2));

  if (importResult.count !== 3) {
    console.error(`Expected 3 transactions, but got ${importResult.count}`);
    process.exit(1);
  }

  // Verify Swiggy
  const swiggy = importResult.transactions.find(t => t.description.includes('SWIGGY'));
  if (!swiggy || swiggy.amount !== 520.50 || swiggy.type !== 'expense' || swiggy.category !== 'Food') {
    console.error('SWIGGY transaction parsed incorrectly:', swiggy);
    process.exit(1);
  }

  // Verify Salary
  const salary = importResult.transactions.find(t => t.description.includes('SALARY'));
  if (!salary || salary.amount !== 125000.00 || salary.type !== 'income' || salary.category !== 'Salary') {
    console.error('SALARY transaction parsed incorrectly:', salary);
    process.exit(1);
  }

  // Verify Zomato
  const zomato = importResult.transactions.find(t => t.description.includes('ZOMATO'));
  if (!zomato || zomato.amount !== 150.00 || zomato.type !== 'expense' || zomato.category !== 'Food') {
    console.error('ZOMATO transaction parsed incorrectly:', zomato);
    process.exit(1);
  }

  console.log('✅ All transactions parsed correctly!');

  // 3. Confirm statement import
  console.log('Confirming and saving transactions...');
  res = await fetch(`${BASE_URL}/api/bank/confirm-statement`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ transactions: importResult.transactions })
  });

  if (!res.ok) {
    console.error('Confirmation failed:', await res.text());
    process.exit(1);
  }

  const confirmData = await res.json();
  console.log(`✅ Confirmation successful. Saved count: ${confirmData.count}`);

  // 4. Retrieve transactions to verify they exist in db
  console.log('Retrieving transactions from server...');
  res = await fetch(`${BASE_URL}/api/transactions`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });

  if (!res.ok) {
    console.error('Retrieve transactions failed:', await res.text());
    process.exit(1);
  }

  const listData = await res.json();
  console.log(`✅ Retrieved ${listData.transactions.length} transactions from server.`);
  if (listData.transactions.length !== 3) {
    console.error(`Expected 3 saved transactions in list, but got ${listData.transactions.length}`);
    process.exit(1);
  }

  console.log('\n🎉 ALL IMPORT END-TO-END TESTS PASSED!');
}

runTest().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
