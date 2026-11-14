from collections import Counter
import unittest

from scripts.evaluate_cash_flow import add_metrics, summarize


class EvaluationTests(unittest.TestCase):
    def test_metrics_distinguish_error_coverage_and_window_risk(self):
        totals = Counter()
        add_metrics(totals, [100, 100], [200, -100], [0, 0], [-200, -200], [300, 300], 0)
        result = summarize(totals)
        self.assertEqual(result["dailyMAECents"], 150)
        self.assertEqual(result["dailyBiasCents"], 50)
        self.assertEqual(result["day30MAECents"], 200)
        self.assertEqual(result["scenarioEnvelopeCoveragePercent"], 100)
        self.assertEqual(result["centralLowCash"]["recall"], 0)
        self.assertIsNone(result["centralLowCash"]["precision"])
        self.assertEqual(result["scenarioLowCash"]["recall"], 1)
        self.assertEqual(result["scenarioLowCash"]["precision"], 1)


if __name__ == "__main__":
    unittest.main()
