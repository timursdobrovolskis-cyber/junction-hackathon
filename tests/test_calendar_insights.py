from copy import deepcopy
import unittest
from src.calendar_insights import calendar_insights
from scripts.build_calendar_examples import recurring_demo_rows


class InsightTests(unittest.TestCase):
    def setUp(self):
        self.rows = [r for r in recurring_demo_rows() if r['date'] <= '2026-09-30']
        self.forecast = {'bufferCents': 50000, 'belowBufferDates': [], 'possibleBelowBufferDates': []}

    def purchase(self, month, amount, kind='purchase'):
        return {**self.rows[0], 'transaction_id': f'{month}-{amount}-{kind}', 'date': f'2026-{month}-22',
                'amount_cents': -amount, 'transaction_type': kind, 'merchant_id': 'shopping'}

    def insights(self, extra=(), rows=None, forecast=None):
        return calendar_insights((self.rows if rows is None else rows) + list(extra), 'CALENDAR-DEMO', '2026-09-30', self.forecast if forecast is None else forecast, [], [])

    def test_sustained_increase_has_exact_metrics_and_evidence(self):
        extra = [self.purchase('07', 80000), self.purchase('08', 100000), self.purchase('09', 130000)]
        warning = next(n for n in self.insights(extra) if n['kind'] == 'spending_trend')
        self.assertEqual([x['amountCents'] for x in warning['monthlyTotals']], [81299, 101299, 131299])
        self.assertEqual(warning['metrics'][0]['amountCents'], 50000)
        self.assertEqual(warning['asOf'], '2026-09-30')
        self.assertTrue(set(r['transaction_id'] for r in extra) <= set(warning['evidenceIds']))

    def test_single_spike_small_changes_and_investments_do_not_trigger_trend(self):
        for amounts, kind in [([80000, 80000, 130000], 'purchase'), ([1000, 1200, 1500], 'purchase'), ([80000, 100000, 130000], 'investment_deposit')]:
            alerts = self.insights([self.purchase(m, a, kind) for m, a in zip(['07','08','09'], amounts)])
            self.assertFalse(any(n['kind'] == 'spending_trend' for n in alerts))

    def test_partial_history_and_other_customers_do_not_trigger_alerts(self):
        extra = [self.purchase('07',80000),self.purchase('08',100000),self.purchase('09',130000)]
        partial = [r for r in self.rows if r['date'] >= '2026-07-01']
        self.assertFalse(any(n['kind'] == 'spending_trend' for n in self.insights(extra,rows=partial)))
        self.assertEqual(self.insights([{**r, 'customer_id': 'OTHER'} for r in extra]), self.insights())
        self.assertEqual(self.insights([{**extra[0], 'date': '2026-10-01'}]), self.insights())

    def test_refunds_reduce_spending_and_do_not_create_false_increase(self):
        extra = [self.purchase('07',80000),self.purchase('08',100000),self.purchase('09',130000),self.purchase('09',-60000)]
        self.assertFalse(any(n['kind'] == 'spending_trend' for n in self.insights(extra)))

    def test_repeated_deficit_excludes_transfers_and_reports_engine_scope(self):
        extra = [self.purchase('08',300000),self.purchase('09',320000)]
        alert = next(n for n in self.insights(extra) if n['kind']=='spending_above_income')
        self.assertEqual(alert['metrics'][0]['amountCents'],407299)
        self.assertEqual(alert['metrics'][1]['amountCents'],240000)
        self.assertFalse(any(n['kind']=='spending_above_income' for n in self.insights([self.purchase('08',999999,'investment_deposit'),self.purchase('09',999999,'investment_deposit')])))

    def test_buffer_warning_reuses_forecast_without_mutation(self):
        forecast = {**self.forecast, 'possibleBelowBufferDates': ['2026-10-12']}
        before = deepcopy(forecast)
        notice = next(n for n in self.insights(forecast=forecast) if n['kind']=='buffer_risk')
        self.assertIn('Some forecast scenarios',notice['summary'])
        self.assertEqual(notice['forecastDates'],['2026-10-12'])
        self.assertEqual(forecast,before)

if __name__ == '__main__': unittest.main()
