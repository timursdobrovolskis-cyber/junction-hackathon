import { cents, date, identifier, requireValue } from './validation.mjs';

/** Parse decimal CSV money without binary floating-point multiplication. */
export function euroStringToCents(value) {
  requireValue(typeof value === 'string' && /^-?\d+(?:\.\d{1,2})?$/.test(value), 'CSV money must be a decimal string with at most two decimal places');
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = value.replace(/^-/, '').split('.');
  const amount = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  requireValue(amount <= BigInt(Number.MAX_SAFE_INTEGER), 'CSV money exceeds safe integer cents');
  return cents(Number(negative ? -amount : amount), 'CSV amount', { signed: true });
}

/** Adapter for the verified S-Bank CSV schema; callers scope rows to one customer. */
export function normalizeSBankTransaction(row, { sourceSha256, sourceRow }) {
  requireValue(typeof sourceSha256 === 'string' && /^[a-f0-9]{64}$/.test(sourceSha256), 'sourceSha256 must identify the input file');
  requireValue(Number.isSafeInteger(sourceRow) && sourceRow >= 2, 'sourceRow must include the CSV header row');
  identifier(row.customer_id, 'customer_id');
  identifier(row.bank_account_id, 'bank_account_id');
  identifier(row.category, 'category');
  identifier(row.transaction_type, 'transaction_type');
  date(row.tx_date, 'tx_date');
  const amountCents = euroStringToCents(row.tx_amount_eur);
  let kind = 'other';
  if (['salary', 'other_income'].includes(row.transaction_type) && amountCents > 0) kind = 'income';
  if (['purchase', 'housing_payment', 'utilities_payment'].includes(row.transaction_type)) {
    kind = amountCents < 0 ? 'expense' : amountCents > 0 ? 'refund' : 'other';
  }
  if (['investment_deposit', 'investment_withdrawal'].includes(row.transaction_type)) kind = 'investment';
  if (row.transaction_type === 'salary_sweep') kind = 'transfer';
  // Financial-movement categories must not become consumption due to a conflicting type.
  const expectedMovement = { 'Invest Deposit': 'investment', 'Invest Withdraw': 'investment', 'Salary Sweep': 'transfer' }[row.category];
  if (expectedMovement && kind !== expectedMovement) kind = 'other';
  return {
    id: `sbank:${sourceSha256}:${sourceRow}`,
    customerId: row.customer_id, accountId: row.bank_account_id, date: row.tx_date,
    category: row.category, kind, amountCents,
    ...(row.balance_after_eur !== undefined && row.balance_after_eur !== ''
      ? { balanceAfterCents: euroStringToCents(row.balance_after_eur) } : {}),
    ...(row.merchant_id ? { merchantId: row.merchant_id } : {}),
    source: { sha256: sourceSha256, row: sourceRow, transactionType: row.transaction_type,
      ...(row.tx_timestamp ? { timestamp: row.tx_timestamp } : {}) },
  };
}

/** Convert the small extraction format into the coach's customer-scoped profile input. */
export function profilesFromSBankExtract(extract) {
  requireValue(extract.format === 'sbank-extract-v1', 'unsupported S-Bank extract format');
  requireValue(Array.isArray(extract.customers), 'extract customers must be an array');
  date(extract.asOf, 'extract.asOf');
  date(extract.coverage.startDate, 'extract.coverage.startDate');
  date(extract.coverage.endDate, 'extract.coverage.endDate');
  return extract.customers.map(({ customerId, rows }) => {
    identifier(customerId, 'customerId');
    requireValue(Array.isArray(rows), 'customer rows must be an array');
    requireValue(rows.every((row) => row.customer_id === customerId), 'extract contains a different customer');
    return {
      customerId, currency: 'EUR', asOf: extract.asOf, dataSource: 'historical_bank_data',
      missingInputs: [],
      assumptions: [
        'Historical replay of the organizer’s synthetic S-Bank data, not a live bank connection.',
        `History coverage is declared from ${extract.coverage.startDate} through ${extract.coverage.endDate} for accounts present in the extract.`,
        'No spending categories have been confirmed as adjustable. Historical patterns do not determine the customer’s priorities.',
      ],
      transactionHistory: { ...extract.coverage,
        transactions: rows.map((row) => normalizeSBankTransaction(row, {
          sourceSha256: extract.source.sha256, sourceRow: row.sourceRow,
        })) },
    };
  });
}
