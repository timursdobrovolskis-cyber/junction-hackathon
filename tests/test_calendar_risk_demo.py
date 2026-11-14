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
        self.assertEqual(warning['laterShortfallCents'],-forecast['lowestExpectedBalance']['amountCents'])
        self.assertEqual(warning['firstShortfallCents'],30000)
        self.assertEqual(warning['metrics'][2]['amountCents'],30000)
        self.assertEqual(warning['firstShortfallCents'],-next(d['expectedBalanceCents'] for d in forecast['daily'] if d['date']==warning['firstShortfallDate']))
        self.assertEqual(warning['timeline'][1]['amountCents'],120000)
        self.assertEqual(warning['timeline'][2]['date'],'2026-11-28')
        self.assertEqual(next(d['date'] for d in forecast['daily'] if d['expectedBalanceCents']<0),warning['firstShortfallDate'])
        self.assertEqual({e['kind'] for e in demo['events']},{'income','bill','subscription'})
        self.assertTrue(any(e['cadence']=='yearly' for e in demo['events']))
        self.assertFalse(any(e.get('category')=='Restaurants' for e in demo['events']))

    def test_scheduled_totals_reconcile_every_month_without_irregular_purchases(self):
        demo=build_risk_demo()
        self.assertEqual(len(demo['monthSummaries']),24)
        self.assertEqual(len({e['id'] for e in demo['events']}),len(demo['events']))
        for month,summary in demo['monthSummaries'].items():
            entries=[e for e in demo['events'] if e['date'].startswith(month)]
            self.assertEqual(summary['paymentCount'],len(entries))
            for direction,key in [('inflow','incomeCents'),('outflow','outflowCents')]:
                self.assertEqual(summary[key],sum(e['amountCents'] for e in entries if e['direction']==direction))
            self.assertEqual(sum(e['title']=='Netflix' for e in entries),1)
            self.assertEqual(sum(e['title']=='Gym membership' for e in entries),1)
        self.assertEqual(demo['monthSummaries']['2026-11'],{'incomeCents':240000,'outflowCents':159576,'paymentCount':11})
        self.assertEqual(sum(e['title']=='Adobe Creative Cloud' for e in demo['events']),2)
        self.assertTrue(all(e['date'][5:10]=='03-03' for e in demo['events'] if e['title']=='Adobe Creative Cloud'))

if __name__=='__main__':unittest.main()
