"""Versioned customer plans in a separate SQLite file; never writes bank data."""
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sqlite3
import uuid


class Conflict(ValueError):
    pass


class NotFound(ValueError):
    pass


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


def digest(value):
    return hashlib.sha256(encoded(value).encode()).hexdigest()


class PlanStore:
    def __init__(self, path="data/local/plans.sqlite"):
        self.path = Path(path).resolve()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as db:
            version = db.execute("PRAGMA user_version").fetchone()[0]
            if version not in (0, 1):
                raise ValueError("Unsupported plan store schema")
            db.executescript("""
                CREATE TABLE IF NOT EXISTS plans (
                    customer_id TEXT PRIMARY KEY, plan_id TEXT UNIQUE NOT NULL,
                    revision INTEGER NOT NULL, state TEXT NOT NULL, result TEXT NOT NULL,
                    created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS mutations (
                    customer_id TEXT NOT NULL, mutation_id TEXT NOT NULL,
                    payload_hash TEXT NOT NULL, response TEXT NOT NULL,
                    PRIMARY KEY(customer_id, mutation_id));
                CREATE TABLE IF NOT EXISTS audit (
                    id INTEGER PRIMARY KEY, customer_id TEXT NOT NULL, plan_id TEXT NOT NULL,
                    revision INTEGER NOT NULL, recorded_at TEXT NOT NULL, event TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS matches (
                    customer_id TEXT NOT NULL, plan_id TEXT NOT NULL, expense_id TEXT NOT NULL,
                    transaction_id TEXT NOT NULL,
                    PRIMARY KEY(customer_id, transaction_id), UNIQUE(plan_id, expense_id));
                PRAGMA user_version=1;
            """)

    @contextmanager
    def connection(self):
        db = sqlite3.connect(self.path, timeout=15, isolation_level=None)
        db.row_factory = sqlite3.Row
        try:
            yield db
        finally:
            db.close()

    @staticmethod
    def unpack(row):
        if row is None:
            return None
        return {"planId": row["plan_id"], "customerId": row["customer_id"],
                "revision": row["revision"], "state": json.loads(row["state"]),
                "engineResult": json.loads(row["result"]), "createdAt": row["created_at"],
                "updatedAt": row["updated_at"]}

    def load(self, customer, plan_id=None):
        with self.connection() as db:
            plan = self.unpack(db.execute("SELECT * FROM plans WHERE customer_id=?", (customer,)).fetchone())
            if plan_id is not None and (plan is None or plan["planId"] != plan_id):
                raise NotFound("No such plan for this customer")
            return plan

    def mutate(self, customer, mutation_id, expected_revision, payload, calculate, plan_id=None):
        if not isinstance(mutation_id, str) or not mutation_id.strip() or len(mutation_id) > 160:
            raise ValueError("A mutationId of 1–160 characters is required")
        if type(expected_revision) is not int or expected_revision < 0:
            raise ValueError("expectedRevision must be a nonnegative integer")
        fingerprint = digest({"payload": payload, "expectedRevision": expected_revision, "planId": plan_id})
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            try:
                retry = db.execute("SELECT * FROM mutations WHERE customer_id=? AND mutation_id=?", (customer, mutation_id)).fetchone()
                if retry:
                    if retry["payload_hash"] != fingerprint:
                        raise Conflict("mutationId was already used for a different action")
                    response = json.loads(retry["response"])
                    db.commit()
                    return response
                current = self.unpack(db.execute("SELECT * FROM plans WHERE customer_id=?", (customer,)).fetchone())
                if plan_id is not None and (current is None or current["planId"] != plan_id):
                    raise NotFound("No such plan for this customer")
                if expected_revision != (current["revision"] if current else 0):
                    raise Conflict("Plan revision changed; reload before applying this action")
                identity = current["planId"] if current else str(uuid.uuid4())
                revision = expected_revision + 1
                state, result, events = calculate(current, identity, revision)
                if state["customerId"] != customer or result["customerId"] != customer:
                    raise ValueError("Plan calculation belongs to another customer")
                now = datetime.now(timezone.utc).isoformat()
                created = current["createdAt"] if current else now
                db.execute("DELETE FROM matches WHERE customer_id=? AND plan_id=?", (customer, identity))
                for expense in state["plannedExpenses"]:
                    if expense["status"] == "matched":
                        db.execute("INSERT INTO matches VALUES (?,?,?,?)", (customer, identity, expense["id"], expense["matchedTransactionId"]))
                db.execute("INSERT OR REPLACE INTO plans VALUES (?,?,?,?,?,?,?)",
                           (customer, identity, revision, encoded(state), encoded(result), created, now))
                response = {"status": "saved", "planId": identity, "customerId": customer, "revision": revision,
                            "state": state, "engineResult": result, "createdAt": created, "updatedAt": now}
                for event in events:
                    db.execute("INSERT INTO audit(customer_id,plan_id,revision,recorded_at,event) VALUES (?,?,?,?,?)",
                               (customer, identity, revision, now, encoded(event)))
                db.execute("INSERT INTO mutations VALUES (?,?,?,?)", (customer, mutation_id, fingerprint, encoded(response)))
                db.commit()
                return response
            except Exception:
                db.rollback()
                raise

    def audit(self, customer, plan_id):
        self.load(customer, plan_id)
        with self.connection() as db:
            return [{"revision": row["revision"], "recordedAt": row["recorded_at"], **json.loads(row["event"])}
                    for row in db.execute("SELECT * FROM audit WHERE customer_id=? AND plan_id=? ORDER BY id", (customer, plan_id))]
