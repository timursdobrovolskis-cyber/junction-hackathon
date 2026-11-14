"""Atomic plan actions, read-only previews, recovery selection and matching review."""
from copy import deepcopy
from src.plan_store import PlanStore, Conflict, NotFound
from src.planned_expenses import public_expenses, iso
import sqlite3


class PlanService:
    def __init__(self, engine, store=None):
        self.engine = engine
        self.store = store or PlanStore()
        if self.store.path == engine.database:
            raise ValueError("Plan storage must be separate from the read-only bank database")

    def load(self, customer):
        saved = self.store.load(customer)
        if saved is None:
            return {"status": "no_saved_plan", "customerId": customer}
        try:
            fresh = self.engine.plan(saved["state"]["request"], expense_state=saved["state"]["plannedExpenses"],
                                     spending_plan=saved["state"]["spendingPlan"],
                                     source={"planId": saved["planId"], "revision": saved["revision"]})
            return {"status": "loaded", **saved, "engineResult": fresh,
                    "pendingMatchingDecisions": fresh.get("matchingDecisions", [])}
        except (ValueError, TypeError, OSError, sqlite3.Error) as error:
            return {"status": "recalculation_failed", **saved, "error": str(error),
                    "message": "Saved state and last successful result restored; recalculation failed."}

    def preview(self, raw):
        if not isinstance(raw, dict):
            raise ValueError("A financial request object is required")
        request = deepcopy(raw)
        plan_id = request.pop("sourcePlanId", None)
        revision = request.pop("sourceRevision", None)
        if (plan_id is None) != (revision is None):
            raise ValueError("Provide both sourcePlanId and sourceRevision")
        if plan_id is None:
            return self.engine.plan(request)
        if not isinstance(plan_id, str) or not plan_id or type(revision) is not int or revision < 1:
            raise ValueError("Source plan identity and revision are invalid")
        saved = self.store.load(request.get("customerId"), plan_id)
        if revision != saved["revision"]:
            raise Conflict("Preview source revision changed; reload the plan")
        if request.get("asOf", "") < saved["state"]["asOf"]:
            raise Conflict("Saved plans cannot move backwards in observation time")
        return self.engine.plan(request, expense_state=saved["state"]["plannedExpenses"],
                                spending_plan=saved["state"]["spendingPlan"], source={"planId": plan_id, "revision": revision})

    def mutate(self, customer, body, action="save"):
        common = {"planId", "expectedRevision", "mutationId", "confirmations"}
        extra = {"save": {"request", "priorityNotes"}, "select": {"optionId"},
                 "matches": {"decisions", "asOf"}, "reconcile": {"asOf"}}[action]
        if not isinstance(body, dict) or set(body) - (common | extra) or not {"expectedRevision", "mutationId"} <= set(body):
            raise ValueError("Invalid saved-plan action")
        if body["expectedRevision"] != 0 and not body.get("planId"):
            raise ValueError("planId is required for an existing plan")
        if action == "matches" and "decisions" not in body:
            raise ValueError("Matching decisions are required")
        confirmations = body.get("confirmations", {})
        if (not isinstance(confirmations, dict) or set(confirmations) - {"savingsConfirmed", "commitmentsConfirmed"}
                or any(type(value) is not bool for value in confirmations.values())):
            raise ValueError("Explicit confirmations must be booleans")

        def calculate(current, plan_id, revision):
            if action != "save" and current is None:
                raise NotFound("Save a plan before applying this action")
            previous = current["state"] if current else None
            request = deepcopy(body.get("request")) if action == "save" else deepcopy(previous["request"])
            if not isinstance(request, dict) or request.get("customerId") != customer:
                raise ValueError("Request belongs to another customer")
            request.setdefault("plannedExpenses", [])
            if action in {"matches", "reconcile"} and "asOf" in body:
                request["asOf"] = iso(body["asOf"])
            if previous and request.get("asOf", "") < previous["asOf"]:
                raise Conflict("Saved plans cannot move backwards in observation time")
            old_expenses = previous["plannedExpenses"] if previous else None
            spending = previous["spendingPlan"] if previous else None
            selected = deepcopy(previous.get("selectedAlternative")) if previous else None
            notes = deepcopy(body.get("priorityNotes", previous.get("priorityNotes", {}) if previous else {}))
            if not isinstance(notes, dict) or any(not isinstance(k, str) or not isinstance(v, str) or len(v) > 240 for k, v in notes.items()):
                raise ValueError("priorityNotes must map categories to short customer-written reasons")
            changed = previous is None or any(request.get(k) != previous["request"].get(k)
                                             for k in set(request) | set(previous["request"])
                                             if k not in {"savingsConfirmed", "commitmentsConfirmed"})
            if changed or action in {"select", "matches", "reconcile"}:
                request.update(savingsConfirmed=False, commitmentsConfirmed=False)
            request.update(confirmations)
            events = [{"actor": "customer", "action": action, "request": deepcopy(request), "priorityNotes": notes}]
            if action == "select":
                original = self.engine.plan(previous["request"], expense_state=old_expenses, spending_plan=spending,
                                            source={"planId": plan_id, "revision": current["revision"]})
                option = next((o for o in original["alternatives"] if o["id"] == body.get("optionId")), None)
                if option is None or not option["available"]:
                    raise Conflict("Recovery option is stale or unavailable; preview the current plan")
                request.update(option["preferenceChanges"])
                spending = option["spendingPlan"]
                selected = {"id": option["id"], "kind": option["kind"], "sourceRevision": current["revision"],
                            "selectedAtRevision": revision, "asOf": request["asOf"], "active": True}
                events[0]["selectedAlternative"] = selected
            result = self.engine.plan(request, expense_state=old_expenses, spending_plan=spending,
                                      source={"planId": plan_id, "revision": revision},
                                      matching_decisions=body.get("decisions") if action == "matches" else None)
            if action == "select" and not result["budget"].get("feasible"):
                raise Conflict("Selected option no longer fits; no changes were saved")
            for category in notes:
                if category not in result["spendingPlan"]:
                    raise ValueError("Priority note has no projected category")
            request["plannedExpenses"] = public_expenses(result["plannedExpenses"])
            if selected and action == "save" and changed:
                selected["active"] = False
            events[0]["request"] = deepcopy(request)
            state = {"customerId": customer, "asOf": request["asOf"], "request": request,
                     "plannedExpenses": result["plannedExpenses"], "spendingPlan": result["spendingPlan"],
                     "selectedAlternative": selected, "priorityNotes": notes}
            events.extend(result["matchingDecisions"])
            return state, result, events

        return self.store.mutate(customer, body["mutationId"], body["expectedRevision"],
                                 {"action": action, "body": body}, calculate, body.get("planId"))
