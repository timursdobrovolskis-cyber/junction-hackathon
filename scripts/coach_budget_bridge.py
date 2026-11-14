"""Server-only JSON stdin/stdout adapter to the shared budget engine."""
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.category_budgets import build_category_budgets


def main():
    try:
        request = json.load(sys.stdin)
        budget = build_category_budgets(request["originalForecast"], **request["engineInputs"])
        json.dump({"budget": budget}, sys.stdout, allow_nan=False)
    except (ValueError, TypeError, KeyError) as error:
        json.dump({"error": str(error)}, sys.stdout)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
