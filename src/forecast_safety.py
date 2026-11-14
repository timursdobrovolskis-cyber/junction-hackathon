"""Past-error calibration and conditional savings capacity; never transfers money."""

from datetime import date
import hashlib
import json
from math import ceil
from fractions import Fraction


def model_digest(model):
    return hashlib.sha256(json.dumps(model, sort_keys=True).encode()).hexdigest()


def path_score(forecast, actual):
    if len(actual) != len(forecast["daily"]) or not actual:
        raise ValueError("A complete actual path is required")
    return max(max(d["lowerScenarioBalanceCents"] - a, a - d["upperScenarioBalanceCents"], 0)
               for d, a in zip(forecast["daily"], actual))


def fit_calibration(scores, model, through, target=0.9, horizon_days=30):
    if not 0 < target < 1 or not scores or any(s < 0 for s in scores):
        raise ValueError("Nonnegative scores and a coverage target between zero and one are required")
    rank = ceil((len(scores) + 1) * target)
    if rank > len(scores):
        raise ValueError("Too few calibration paths for requested coverage")
    return {"method": "split-path-envelope-expansion", "modelVersion": model["modelVersion"],
            "modelDigest": model_digest(model), "calibrationThrough": date.fromisoformat(through).isoformat(),
            "horizonDays": horizon_days, "targetPathCoverage": target, "calibrationPaths": len(scores),
            "marginCents": sorted(scores)[rank - 1]}


def apply_calibration(forecast, calibration, model):
    if calibration["modelDigest"] != model_digest(model) or forecast["modelVersion"] != model["modelVersion"]:
        raise ValueError("Calibration and forecast model do not match")
    if calibration["calibrationThrough"] > forecast["asOf"]:
        raise ValueError("Calibration uses outcomes after forecast cutoff")
    if forecast["horizonDays"] != calibration["horizonDays"]:
        raise ValueError("Calibration is valid only for its evaluated horizon")
    result = {**forecast, "calibration": dict(calibration)}
    if calibration["method"] == "scaled-path-envelope-expansion":
        if not forecast["daily"]:
            return result
        scale = forecast["uncertaintyScaleCents"]
        if type(scale) is not int or scale <= 0:
            raise ValueError("A positive history-based uncertainty scale is required")
        margin = ceil(Fraction(calibration["normalizedMarginNumerator"], calibration["normalizedMarginDenominator"]) * scale)
        result["calibration"] = {**calibration, "effectiveMarginCents": margin}
    else:
        margin = calibration["marginCents"]
    result["daily"] = [{**d, "calibratedLowerBalanceCents": d["lowerScenarioBalanceCents"] - margin,
                         "calibratedUpperBalanceCents": d["upperScenarioBalanceCents"] + margin}
                        for d in forecast["daily"]]
    result["warnings"] = forecast["warnings"] + [
        "Calibration targets whole-path coverage on the synthetic population; distribution shifts and individual customers can violate it."]
    return result


def fit_scaled_calibration(scores_and_scales, model, through, target=0.9):
    if not 0 < target < 1 or not scores_and_scales:
        raise ValueError("Calibration data and a target between zero and one are required")
    scores = []
    for score, scale in scores_and_scales:
        if score < 0 or scale <= 0:
            raise ValueError("Nonnegative errors and positive scales are required")
        scores.append(Fraction(score, scale))
    rank = ceil((len(scores) + 1) * target)
    if rank > len(scores):
        raise ValueError("Too few calibration paths")
    q = sorted(scores)[rank - 1]
    return {"method": "scaled-path-envelope-expansion", "modelVersion": model["modelVersion"],
            "modelDigest": model_digest(model), "calibrationThrough": date.fromisoformat(through).isoformat(),
            "horizonDays": 30, "targetPathCoverage": target, "calibrationPaths": len(scores),
            "normalizedMarginNumerator": q.numerator, "normalizedMarginDenominator": q.denominator}


def estimate_savings(forecast, buffer_cents, future_commitments, commitments_confirmed=False):
    """Preview a one-time withdrawal now, preserving the calibrated path buffer.

    Future commitments must be beyond the forecast horizon and are fully reserved
    without assuming later income. In-horizon costs belong in the forecast itself.
    """
    if not isinstance(buffer_cents, int) or buffer_cents < 0:
        raise ValueError("An explicit nonnegative integer cash buffer is required")
    result = {"currency": "EUR", "asOf": forecast["asOf"], "status": "withheld",
              "suggestedSavingsCents": None, "conditionalCapacityCents": None,
              "bufferCents": buffer_cents, "movesMoney": False}
    if not forecast["daily"] or forecast["status"] != "estimated" or "calibration" not in forecast:
        return {**result, "reason": "An eligible calibrated forecast is required."}
    if len(forecast["accounts"]) != 1:
        return {**result, "reason": "Account-specific liquidity must be modeled before combining multiple accounts."}
    ids = set()
    reserve = 0
    for cost in future_commitments:
        if cost["id"] in ids:
            raise ValueError("Duplicate future commitment")
        ids.add(cost["id"])
        if date.fromisoformat(cost["date"]).isoformat() <= forecast["daily"][-1]["date"]:
            raise ValueError("In-horizon commitments must be included in the forecast, not added twice")
        if not isinstance(cost["amountCents"], int) or cost["amountCents"] < 0:
            raise ValueError("Commitment amount must be nonnegative integer cents")
        reserve += cost["amountCents"]
    floor = min(forecast["startingBalanceCents"], *(d["calibratedLowerBalanceCents"] for d in forecast["daily"]))
    capacity = max(0, floor - buffer_cents - reserve)
    return {**result, "status": "conditional_estimate" if commitments_confirmed else "needs_confirmation",
            "conditionalCapacityCents": capacity,
            "suggestedSavingsCents": capacity if commitments_confirmed else None,
            "reservedFutureCostsCents": reserve, "futureCommitments": future_commitments,
            "limitingBalanceCents": floor, "horizonEnd": forecast["daily"][-1]["date"],
            "assumptions": ["The supplied buffer is a user/product choice, not learned financial advice.",
                            "Only listed future costs are reserved; confirm other commitments before acting.",
                            "Capacity assumes a withdrawal now, no automatic money movement, and end-of-day liquidity.",
                            "A calibrated bound is not a guarantee of future affordability."]}
