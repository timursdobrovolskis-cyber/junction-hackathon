from copy import deepcopy
from pathlib import Path
import tempfile
import threading
import unittest

from test_category_budgets import sample
from src.planned_expenses import normalize_expenses, reconcile, expense_scenario
from src.forecast_safety import estimate_savings
from src.plan_recovery import current_and_recovery
from src.plan_store import PlanStore, Conflict, NotFound
from src.plan_service import PlanService


def base():
    value = sample()
    value['startingBalanceCents'] += 100000
    for row in value['daily']:
        for key in ('expectedBalanceCents', 'calibratedLowerBalanceCents', 'calibratedUpperBalanceCents'):
            row[key] += 100000
    value.update(modelVersion="conditioned-income-v2", currency="EUR", warnings=[], bufferCents=10000,
                 evidence=[], upcomingPayments=[], horizonDays=30)
    return value


def request():
    return {"customerId": "C", "asOf": "2026-09-30", "bufferCents": 10000, "savingsTargetCents": 30000,
            "plannedExpenses": [], "savingsConfirmed": False, "commitmentsConfirmed": False}


def expense(**changes):
    return {"id": "repair", "date": "2026-10-07", "amountCents": 20000,
            "category": "Transportation", "label": "Car repair", "inclusion": "additional", **changes}


class FixtureEngine:
    """Deterministic calculation input, using the real expense/recovery functions."""
    database = Path('/unused/read-only-bank.sqlite')

    def plan(self, req, *, expense_state=None, spending_plan=None, source=None, matching_decisions=None):
        f = base(); f["customerId"] = req["customerId"]
        if req.get("fail"):
            raise ValueError("Calculation failed")
        costs = req.get("futureCommitments", [])
        expenses = normalize_expenses(req.get("plannedExpenses", []), req["customerId"], req["asOf"], expense_state)
        expenses, reviews, events = reconcile(expenses, [], req["asOf"], matching_decisions)
        scenario, future = expense_scenario(f, expenses, costs, reviews)
        budget, options, limits = current_and_recovery(f, scenario, req, future, spending_plan, source)
        return {"customerId": req["customerId"], "asOf": req["asOf"], "modelVersion": f["modelVersion"],
                "forecast": f, "planScenario": scenario, "budget": budget,
                "savings": estimate_savings(scenario, req["bufferCents"], future),
                "plannedExpenses": expenses, "matchingDecisions": events, "matchingReviews": reviews,
                "spendingPlan": limits, "alternatives": options}


class ExpenseScenarioTests(unittest.TestCase):
    def scenario(self, expenses, forecast=None, previous=None, costs=None):
        f = forecast or base()
        normalized = normalize_expenses(expenses, f['customerId'], f['asOf'], previous)
        return expense_scenario(f, normalized, costs or [], [])

    def test_dated_cost_once_preserves_base_and_reconciles_components(self):
        f = base(); before = deepcopy(f)
        s, reserves = self.scenario([expense()], f)
        self.assertEqual(f, before)
        self.assertEqual(reserves, [])
        for original, changed in zip(f['daily'], s['daily']):
            self.assertEqual(changed['expectedBalanceCents'], original['expectedBalanceCents'] - (20000 if changed['date'] >= '2026-10-07' else 0))
            i = s['daily'].index(changed)
            net = sum((1 if c['direction'] == 'inflow' else -1) * c['dailyAmountsCents'][i] for c in s['cashFlowComponents'])
            self.assertEqual(net, changed['expectedNetChangeCents'])
        self.assertNotIn('calibration', s)
        self.assertFalse(s['calibrationCoverageClaimApplies'])
        self.assertNotIn('calibratedLowerBalanceCents', s['daily'][0])
        self.assertEqual(s['daily'][0]['conditionalLowerBalanceCents'], f['daily'][0]['calibratedLowerBalanceCents'])
        self.assertFalse(estimate_savings(s, 10000, [])['calibrationCoverageClaimApplies'])

    def test_multiple_edits_and_cancellation_are_reversible(self):
        a, _ = self.scenario([expense(), expense(id='dentist', amountCents=5000)])
        self.assertEqual(a['daily'][-1]['expectedBalanceCents'], base()['daily'][-1]['expectedBalanceCents'] - 25000)
        b, _ = self.scenario([expense(amountCents=10000)], previous=a['plannedExpenses'])
        self.assertEqual(b['daily'][-1]['expectedBalanceCents'], base()['daily'][-1]['expectedBalanceCents'] - 10000)
        c, _ = self.scenario([], previous=b['plannedExpenses'])
        self.assertEqual(c['daily'][-1]['expectedBalanceCents'], base()['daily'][-1]['expectedBalanceCents'])
        self.assertTrue(all(e['status'] == 'cancelled' for e in c['plannedExpenses']))

    def test_horizon_boundary_and_rollover_never_both_charge_and_reserve(self):
        s, costs = self.scenario([expense(date='2026-10-30'), expense(id='later', date='2026-10-31')])
        self.assertEqual(len(s['lockedCommitments']), 1)
        self.assertEqual(costs, [{'id': 'later', 'date': '2026-10-31', 'amountCents': 20000}])
        f = base(); f['asOf'] = '2026-10-01'
        f['daily'] = [{**row, 'date': f'2026-10-{i+2:02d}'} for i, row in enumerate(f['daily'])]
        rolled, costs = self.scenario([expense(id='later', date='2026-10-31')], f, s['plannedExpenses'])
        self.assertEqual(costs, [])
        self.assertEqual(len(rolled['lockedCommitments']), 1)

    def test_known_later_reserve_survives_customer_saying_it_is_already_included(self):
        original, _ = self.scenario([expense(date='2026-12-01')])
        updated, costs = self.scenario([expense(date='2026-12-01', inclusion='already_included')], previous=original['plannedExpenses'])
        self.assertEqual(costs, [{'id':'repair','date':'2026-12-01','amountCents':20000}])
        self.assertEqual(updated['expenseBlockers'], [])

    def test_included_uncertain_past_due_and_duplicate_ids(self):
        s, _ = self.scenario([expense(inclusion='already_included')])
        self.assertEqual(s['daily'][-1]['expectedBalanceCents'], base()['daily'][-1]['expectedBalanceCents'])
        for changes in ({'inclusion': 'unsure'}, {'date': '2026-09-29'}, {'inclusion': 'already_included', 'date': '2026-12-01'}):
            s, _ = self.scenario([expense(**changes)])
            self.assertEqual(s['status'], 'needs_review')
            self.assertEqual(estimate_savings(s, 10000, [])['status'], 'withheld')
        with self.assertRaises(ValueError): self.scenario([expense(), expense()])
        with self.assertRaises(ValueError): self.scenario([expense()], costs=[dict(id='repair',date='2026-12-01',amountCents=1)])
        for changes in ({'amountCents': True}, {'amountCents': -1}, {'date': '2026-02-30'}, {'customerId': 'other'}, {'matchedTransactionId': 'x'}):
            with self.assertRaises(ValueError): self.scenario([expense(**changes)])

    def test_obligation_cannot_be_cut_even_if_its_category_is_adjustable(self):
        r = request(); r.update(plannedExpenses=[expense(category='Restaurants')], adjustableCategories=['Restaurants', 'Entertainment', 'Transportation'])
        result = FixtureEngine().plan(r)
        self.assertEqual(result['budget']['lockedCommitmentsCents'], 20000)
        for option in result['alternatives']:
            self.assertEqual(option['budget']['lockedCommitmentsCents'], 20000)
            self.assertEqual(option['budget']['lockedCommitments'][0]['id'], 'repair')

    def test_recovery_changes_only_chosen_dimension_and_preserves_essentials(self):
        r = request(); r['plannedExpenses'] = [expense()]
        result = FixtureEngine().plan(r)
        self.assertEqual(result['budget']['status'], 'infeasible')
        less, cuts = result['alternatives']
        self.assertTrue(less['available']); self.assertTrue(cuts['available'])
        self.assertEqual(less['savingsTargetAfterCents'], 10000)
        self.assertTrue(all(c['changeCents'] == 0 for c in less['categoryChanges']))
        self.assertEqual(cuts['savingsTargetAfterCents'], 30000)
        self.assertTrue(all(c['changeCents'] <= 0 for c in cuts['categoryChanges']))
        for name in ['Housing', 'Groceries']:
            self.assertEqual(next(c['changeCents'] for c in cuts['categoryChanges'] if c['category'] == name), 0)
        self.assertEqual(r['savingsTargetCents'], 30000)
        self.assertEqual(result['budget']['savingsTargetCents'], 30000)

    def test_impossible_options_and_explicit_floors_remain_infeasible(self):
        r = request(); r['plannedExpenses'] = [expense(amountCents=999999)]
        self.assertTrue(all(not option['available'] for option in FixtureEngine().plan(r)['alternatives']))
        r = request(); r.update(plannedExpenses=[expense()], minimumCategoryCents={'Entertainment': 20000}, categoryOverrides={'Restaurants': 50000})
        result = FixtureEngine().plan(r)
        for option in result['alternatives']:
            if option['budget']:
                amounts = {c['category']: c['previewLimitCents'] for c in option['budget']['categories']}
                self.assertGreaterEqual(amounts['Entertainment'], 20000)
                self.assertEqual(amounts['Restaurants'], 50000)


def transaction(**changes):
    return {'transaction_id':'tx1', 'customer_id':'C', 'account_id':'A', 'date':'2026-09-08',
            'amount_cents':-20000, 'merchant_id':'garage', 'category':'Transportation', **changes}


class MatchingTests(unittest.TestCase):
    def expenses(self, **changes):
        return normalize_expenses([expense(date='2026-09-07', accountId='A', merchantId='garage', **changes)], 'C', '2026-08-31')

    def test_clear_unique_match_and_replay_idempotency(self):
        matched, reviews, events = reconcile(self.expenses(), [transaction()], '2026-09-10')
        self.assertEqual(matched[0]['status'], 'matched'); self.assertEqual(reviews, [])
        self.assertEqual(events[0]['actor'], 'matching_rule')
        again, reviews, events = reconcile(matched, [transaction()], '2026-09-10')
        self.assertEqual(again, matched); self.assertEqual(events, [])

    def test_previously_linked_transaction_remains_a_competing_review_candidate(self):
        matched, _, _ = reconcile(self.expenses(), [transaction()], '2026-09-10')
        second = {**self.expenses()[0], 'id': 'second'}
        result, reviews, _ = reconcile(matched + [second], [transaction()], '2026-09-10')
        self.assertEqual(result[1]['status'], 'planned')
        self.assertEqual(reviews[0]['expenseId'], 'second')
        with self.assertRaises(ValueError):
            reconcile(result, [transaction()], '2026-09-10', [{'expenseId':'second','action':'confirm','transactionId':'tx1'}])

    def test_editing_remaining_amount_cannot_reuse_an_earlier_partial_payment(self):
        original = self.expenses()
        changed = normalize_expenses([expense(date='2026-09-09', amountCents=10000, accountId='A', merchantId='garage')], 'C', '2026-09-08', original)
        result, _, _ = reconcile(changed, [transaction(amount_cents=-10000)], '2026-09-10')
        self.assertEqual(result[0]['status'], 'planned')

    def test_ambiguous_duplicate_partial_and_refund_candidates_require_review(self):
        cases = [[transaction(), transaction(transaction_id='tx2')], [transaction(merchant_id=None)],
                 [transaction(amount_cents=-10000)], [transaction(amount_cents=20000)]]
        for rows in cases:
            result, reviews, _ = reconcile(self.expenses(), rows, '2026-09-10')
            self.assertEqual(result[0]['status'], 'planned'); self.assertTrue(reviews)
        expenses = self.expenses(); expenses.append({**deepcopy(expenses[0]), 'id':'repair2'})
        result, reviews, _ = reconcile(expenses, [transaction()], '2026-09-10')
        self.assertTrue(all(e['status'] == 'planned' for e in result)); self.assertEqual(len(reviews), 2)

    def test_no_future_foreign_account_or_before_recording_matches(self):
        for row in [transaction(customer_id='other'), transaction(account_id='other'), transaction(date='2026-09-11'), transaction(date='2026-08-31')]:
            result, reviews, events = reconcile(self.expenses(), [row], '2026-09-10')
            self.assertEqual(result[0]['status'], 'planned'); self.assertEqual(events, [])

    def test_reject_confirm_and_undo_keep_auditable_state(self):
        rows = [transaction(merchant_id=None)]
        result, reviews, events = reconcile(self.expenses(), rows, '2026-09-10', [{'expenseId':'repair','action':'reject','transactionId':'tx1'}])
        self.assertEqual(reviews, []); self.assertIn('tx1',result[0]['rejectedTransactionIds'])
        result, _, _ = reconcile(result, rows, '2026-09-10', [{'expenseId':'repair','action':'confirm','transactionId':'tx1'}])
        self.assertEqual(result[0]['status'], 'matched')
        result, _, events = reconcile(result, rows, '2026-09-10', [{'expenseId':'repair','action':'undo','transactionId':'tx1'}])
        self.assertEqual(result[0]['status'], 'planned'); self.assertEqual(events[0]['action'],'undo')
        for row in [transaction(customer_id='other'), transaction(amount_cents=-10000), transaction(amount_cents=20000)]:
            with self.assertRaises(ValueError): reconcile(self.expenses(), [row], '2026-09-10', [{'expenseId':'repair','action':'confirm','transactionId':'tx1'}])

    def test_matched_payment_is_not_charged_after_cutoff_advance(self):
        matched, _, _ = reconcile(self.expenses(), [transaction()], '2026-09-10')
        f = base(); f['asOf'] = '2026-09-30'
        f['startingBalanceCents'] = 130000  # Deterministic observed balance already includes this payment.
        scenario, costs = expense_scenario(f, matched, [], [])
        self.assertEqual(scenario['startingBalanceCents'], 130000)
        self.assertEqual(costs, []); self.assertEqual(scenario['lockedCommitments'], [])
        self.assertEqual(scenario['daily'][-1]['expectedBalanceCents'], f['daily'][-1]['expectedBalanceCents'])


class SavedPlanTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / 'plans.sqlite'
        self.service = PlanService(FixtureEngine(), PlanStore(self.path))

    def save(self, **changes):
        r = request(); r['plannedExpenses'] = [expense()]; r.update(changes)
        return self.service.mutate('C', {'request':r,'expectedRevision':0,'mutationId':'create'})

    def test_restart_restores_exact_preferences_expense_and_identity(self):
        saved = self.save(minimumCategoryCents={'Entertainment':20000})
        restored = PlanService(FixtureEngine(), PlanStore(self.path)).load('C')
        self.assertEqual(restored['planId'], saved['planId'])
        self.assertEqual(restored['state'], saved['state'])
        self.assertEqual(restored['engineResult'], saved['engineResult'])
        self.assertEqual(restored['state']['plannedExpenses'][0]['amountCents'], 20000)
        self.assertEqual(self.service.load('other')['status'], 'no_saved_plan')

    def test_previews_do_not_persist_and_retry_is_idempotent(self):
        r=request(); r['plannedExpenses']=[expense()]
        self.service.preview(r)
        self.assertEqual(self.service.load('C')['status'],'no_saved_plan')
        saved=self.save(); retry=self.save()
        self.assertEqual(saved,retry)
        self.assertEqual(len(self.service.store.audit('C',saved['planId'])),1)
        with self.assertRaises(Conflict): self.save(bufferCents=20000)

    def test_cross_customer_load_mutation_preview_selection_and_matching_are_rejected(self):
        saved=self.save(); identity=saved['planId']
        with self.assertRaises(NotFound): self.service.store.load('other',identity)
        for action, extra in [('save',{'request':{**request(),'customerId':'other'}}),('select',{'optionId':'x'}),('matches',{'decisions':[]})]:
            with self.assertRaises(NotFound): self.service.mutate('other',{'planId':identity,'expectedRevision':1,'mutationId':action,**extra},action)
        with self.assertRaises(NotFound): self.service.preview({**request(),'customerId':'other','sourcePlanId':identity,'sourceRevision':1})

    def test_failed_calculation_rolls_back_and_stale_edits_conflict(self):
        saved=self.save()
        with self.assertRaises(ValueError): self.service.mutate('C',{'planId':saved['planId'],'expectedRevision':1,'mutationId':'fail','request':{**request(),'fail':True}})
        self.assertEqual(self.service.store.load('C'),{k:saved[k] for k in saved if k!='status'})
        with self.assertRaises(Conflict): self.service.mutate('C',{'planId':saved['planId'],'expectedRevision':0,'mutationId':'stale','request':request()})

    def test_reload_retains_last_result_when_calculation_is_unavailable(self):
        saved = self.save()
        def unavailable(*args, **kwargs): raise OSError('Bank store unavailable')
        self.service.engine.plan = unavailable
        loaded = self.service.load('C')
        self.assertEqual(loaded['status'], 'recalculation_failed')
        self.assertEqual(loaded['state'], saved['state'])
        self.assertEqual(loaded['engineResult'], saved['engineResult'])

    def test_two_concurrent_writes_only_one_commits(self):
        saved=self.save(); outcomes=[]
        def update(number):
            try:
                self.service.mutate('C',{'planId':saved['planId'],'expectedRevision':1,'mutationId':str(number),'request':request()})
                outcomes.append('saved')
            except Conflict: outcomes.append('conflict')
        threads=[threading.Thread(target=update,args=(n,)) for n in range(2)]
        for t in threads:t.start()
        for t in threads:t.join()
        self.assertEqual(sorted(outcomes),['conflict','saved'])

    def test_only_selected_option_applies_and_survives_reload(self):
        saved=self.save()
        less=next(o for o in saved['engineResult']['alternatives'] if o['kind']=='save_less')
        selected=self.service.mutate('C',{'planId':saved['planId'],'expectedRevision':1,'mutationId':'choice','optionId':less['id']},'select')
        self.assertEqual(selected['state']['request']['savingsTargetCents'],10000)
        self.assertEqual(selected['state']['spendingPlan'],saved['state']['spendingPlan'])
        self.assertFalse(selected['state']['request']['savingsConfirmed'])
        self.assertEqual(self.service.load('C')['state']['selectedAlternative'],selected['state']['selectedAlternative'])
        with self.assertRaises(Conflict): self.service.mutate('C',{'planId':saved['planId'],'expectedRevision':2,'mutationId':'stale-option','optionId':less['id']},'select')

    def test_spending_option_preserves_target_and_dated_obligation(self):
        saved=self.save(); cuts=next(o for o in saved['engineResult']['alternatives'] if o['kind']=='reduce_flexible_spending')
        selected=self.service.mutate('C',{'planId':saved['planId'],'expectedRevision':1,'mutationId':'choice','optionId':cuts['id']},'select')
        self.assertEqual(selected['state']['request']['savingsTargetCents'],30000)
        self.assertEqual(selected['engineResult']['budget']['lockedCommitmentsCents'],20000)
        self.assertTrue(selected['engineResult']['budget']['feasible'])


if __name__ == '__main__':
    unittest.main()
