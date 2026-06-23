const { parseMessage } = require('../../../../Desktop/income tracker/backend/automation/bankParser');

const testCases = [
  {
    text: 'Rs.500.00 debited from a/c ...XXXX on 20-Jun-26. Info: UPI-SWIGGY',
    expected: { name: 'HDFC', amount: 500, type: 'expense', description: 'UPI-SWIGGY' }
  },
  {
    text: 'Your A/c ...1234 is debited with INR 1,200.00 on 20Jun26 by UPI/PHONEPE',
    expected: { name: 'SBI', amount: 1200, type: 'expense', description: 'UPI/PHONEPE' }
  },
  {
    text: 'ICICI Bank Account XX1234 has been debited with INR 500.00 on 20-Jun-2026.',
    expected: { name: 'ICICI', amount: 500, type: 'expense', description: 'ICICI Bank Transaction' }
  },
  {
    text: 'INR 1500.00 debited from Axis Bank Account XX1234',
    expected: { name: 'Axis', amount: 1500, type: 'expense', description: 'Axis Bank Transaction' }
  },
  {
    text: 'Your Kotak Bank a/c XX1234 is debited by Rs 750',
    expected: { name: 'Kotak', amount: 750, type: 'expense', description: 'Kotak Bank Transaction' }
  },
  {
    text: 'YES BANK Account XX1234 has been debited with INR 500.00',
    expected: { name: 'Yes Bank', amount: 500, type: 'expense', description: 'Yes Bank Transaction' }
  },
  {
    text: 'IndusInd Bank A/c ...1234 debited by Rs 500.00',
    expected: { name: 'IndusInd Bank', amount: 500, type: 'expense', description: 'IndusInd Bank Transaction' }
  },
  {
    text: 'Db a/c XX...1234: Rs 500',
    expected: { name: 'Bank of Baroda', amount: 500, type: 'expense', description: 'Bank of Baroda Transaction' }
  },
  {
    text: 'Cr a/c XX...1234: Rs 1500.50',
    expected: { name: 'Bank of Baroda', amount: 1500.5, type: 'income', description: 'Bank of Baroda Transaction' }
  },
  {
    text: 'PNB: A/c XXXX debited by Rs. 500',
    expected: { name: 'PNB', amount: 500, type: 'expense', description: 'PNB Transaction' }
  },
  {
    text: 'Canara Bank A/c ...1234 debited by Rs 500.00',
    expected: { name: 'Canara Bank', amount: 500, type: 'expense', description: 'Canara Bank Transaction' }
  },
  {
    text: 'Union Bank A/c ...1234 debited by Rs 500.00',
    expected: { name: 'Union Bank', amount: 500, type: 'expense', description: 'Union Bank Transaction' }
  },
  {
    text: 'Paytm: Rs.200 paid to Swiggy on 20-Jun-26',
    expected: { name: 'Paytm', amount: 200, type: 'expense', description: 'Swiggy' }
  },
  {
    text: '₹500 Debited from your PhonePe Wallet to ZOMATO',
    expected: { name: 'PhonePe', amount: 500, type: 'expense', description: 'ZOMATO' }
  }
];

let failed = 0;
for (const tc of testCases) {
  const result = parseMessage(tc.text);
  if (!result) {
    console.error(`❌ FAILED: "${tc.text}" -> returned null`);
    failed++;
    continue;
  }
  const match = result.source === tc.expected.name &&
                result.amount === tc.expected.amount &&
                result.type === tc.expected.type &&
                result.description === tc.expected.description;

  if (match) {
    console.log(`✅ PASSED: [${tc.expected.name}]`);
  } else {
    console.error(`❌ FAILED: "${tc.text}" -> got:`, result, 'expected:', tc.expected);
    failed++;
  }
}

if (failed === 0) {
  console.log('\n🎉 ALL TESTS PASSED SUCCESSFULLY!');
} else {
  console.error(`\n❌ ${failed} TESTS FAILED.`);
  process.exit(1);
}
