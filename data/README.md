# Bank data preparation

Run the commands below from the repository root with Python 3.11 or newer. The importer uses the Python standard library. It builds a local SQLite database with integer euro cents and source evidence references.

## Download

These URLs pin the two source files to sponsor commit `fbdecdedf1a1f49dd641c2e6b9f2b62d0dc0cc8f`.

```sh
curl -L --fail --create-dirs https://media.githubusercontent.com/media/hackjunction/Junction-2026-S-pankki/fbdecdedf1a1f49dd641c2e6b9f2b62d0dc0cc8f/tx_junction_transactions.csv -o data/local/tx_junction_transactions.csv
curl -L --fail --create-dirs https://raw.githubusercontent.com/hackjunction/Junction-2026-S-pankki/fbdecdedf1a1f49dd641c2e6b9f2b62d0dc0cc8f/tx_customers_junction.csv -o data/local/tx_customers_junction.csv
python3 scripts/prepare_bank_data.py
```

The transaction URL resolves the full Git LFS object. The importer handles the UTF-8 BOM, checks required fields, validates dates and whole cents, and requires matching customer records. Source hashes are recorded in the audit. A failed import leaves the previously built database in place.

The generated files are `data/local/bank.sqlite` and `data/local/bank.audit.json`. Raw CSVs and generated files under `data/local/` are ignored by Git. Teammates can reproduce the store with the commands above.

## Verified source coverage

- 3,626,755 transactions, 5,100 customers, and 5,100 visible accounts.
- Observations span 2024-10-01 through 2026-09-30. Customers have 23–24 observed months. Forecast evaluation must choose historical cutoffs within this range.
- All 3,621,655 adjacent balance checks reconcile exactly in cents. Opening balances are inferred from each account's first transaction.
- 786,668 transactions have no merchant ID, including all housing payments, utilities payments, salaries, sweeps, and investment movements. Utility providers cannot be distinguished from these fields alone.
- 6,189 salary sweeps and 36,200 investment movements affect account cash. Their labels are retained separately from consumption. The destination of a salary sweep is unknown.
- The source has no explicit transaction ID. Generated IDs combine the transaction file's SHA-256 prefix and CSV row number. They identify evidence within that exact source version.

## Store contract

`customers` stores customer ID, postal code as text, and age.

`transactions` stores `transaction_id`, `source_row`, `customer_id`, `account_id`, `date`, `occurred_at`, `category`, `amount_cents`, `balance_after_cents`, `transaction_type`, `merchant_id`, and `mcc_code`. Positive amounts increase the account balance and negative amounts decrease it. Nullable merchant and MCC fields remain null.

`classified_transactions` adds `flow_group` and `is_consumption`. Purchases, housing, and utilities count as consumption. Salary, other income, investments, and salary sweeps have separate groups. Unrecognized types have a null consumption classification for review. Cash-flow calculations must retain all movements affecting the observed account.

`account_history_checked` adds `balance_gap_cents` using chronological order with source row as the tie-breaker. A nonzero gap requires investigation. `metadata` stores the complete audit under the `audit` key.

For a forecast, query only records through the chosen observation cutoff. For example, use `WHERE customer_id = ? AND date <= ? ORDER BY occurred_at, source_row` and take the last observed balance for that account. Keep later records available only for evaluating the forecast.

Customer profiles are now implemented. See [the profile contract](PROFILE_CONTRACT.md) for generation commands, examples, detection rules, and the handoff to the forecast and coach. This preparation step establishes source integrity and coverage; prediction accuracy still needs separate evaluation.
