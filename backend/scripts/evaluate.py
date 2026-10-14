"""Print the evaluation report (precision/recall, FP rate, trace metrics) for the current database.

    python -m scripts.evaluate [--json]
"""
import argparse
import json

from app import config
from app.db import Database
from app.service import FraudGraphService

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    svc = FraudGraphService(Database(config.DATABASE_URL))
    if svc.is_empty():
        svc.seed()
    else:
        svc.load()
    m = svc.metrics()
    if a.json:
        print(json.dumps(m, indent=2))
    else:
        d, t = m["detection"], m["trace"]
        print(f"Detection @ {d['threshold']}: precision {d['precision']:.3f} recall {d['recall']:.3f} F1 {d['f1']:.3f} "
              f"(TP {d['true_positives']} FP {d['false_positives']} FN {d['false_negatives']})")
        for k, v in m["false_positive_rate"].items():
            print(f"  FP rate {k}: {v['flagged']}/{v['accounts']}")
        print(f"Typology primary-label accuracy: {m['typology']['primary_label_accuracy']:.3f}")
        print(f"Trace: precision {t['mean_precision']:.3f} recall {t['mean_recall']:.3f} hop depth {t['mean_hop_depth']} "
              f"{t['mean_trace_ms']} ms; money span {t['mean_money_span_minutes']} min")
        print("Workflow:", m.get("workflow"))
