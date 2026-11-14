import unittest
from scripts.calendar_risk_demo import risk_demo_rows, build_risk_demo
from src.cash_flow import forecast_cash_flow

class RiskDemoTests(unittest.TestCase):
    def test_ledger_is_fictional_reconciles_and_ends_at_declared_cash(self):
        rows=risk_demo_rows()
        self.assertEqual(rows[-1]['balance_after_cents'],90000)
        self.assertTrue(all(r['customer_id']=='RISK-DEMO' and r['transaction_id'].startswith('risk-demo-') for r in rows))
        for first,second in zip(rows,rows[1:]):
            self.assertEqual(first['balance_after_cents']+second['amount_cents'],second['balance_after_cents'])

    def test_warning_amount_is_from_engine_and_scenario_is_not_a_customer_fact(self):
        demo=build_risk_demo(); forecast=forecast_cash_flow(risk_demo_rows(),'RISK-DEMO','2026-10-31',buffer_cents=30000)
        warning=demo['notifications'][0]
        self.assertTrue(demo['isIllustrative']);self.assertTrue(warning['isIllustrative'])
        self.assertEqual(demo['daily'],forecast['daily'])
        self.assertEqual(warning['metrics'][1]['amountCents'],-forecast['lowestExpectedBalance']['amountCents'])
        self.assertEqual(next(d['date'] for d in forecast['daily'] if d['expectedBalanceCents']<0),warning['firstShortfallDate'])
        self.assertEqual({e['kind'] for e in demo['events']},{'income','bill','subscription'})
        self.assertTrue(any(e['cadence']=='yearly' for e in demo['events']))
        self.assertFalse(any(e.get('category')=='Restaurants' for e in demo['events']))

if __name__=='__main__':unittest.main()
