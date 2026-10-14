"""Evaluation against the injected ground truth (synthetic data only)."""
from __future__ import annotations

import json
import time
from collections import defaultdict
from statistics import mean

import networkx as nx

from . import config
from .detection import ramp
from .trace import trace_origin
from .typology import TYPOLOGIES


def _prf(tp, fp, fn):
    p = tp / (tp + fp) if tp + fp else 0.0
    r = tp / (tp + fn) if tp + fn else 0.0
    f = 2 * p * r / (p + r) if p + r else 0.0
    return round(p, 4), round(r, 4), round(f, 4)


def evaluate(svc, with_workflow: bool = True) -> dict:
    an = svc.an
    gt_rows = svc.db.query("SELECT * FROM ground_truth")
    if not gt_rows:
        return {"available": False, "reason": "No ground truth stored (not a synthetic dataset)."}
    truth = {r["account_id"]: {**r, "typologies": json.loads(r["typologies"])} for r in gt_rows}
    accts = an.accounts
    scores = an.scores

    # ---- account-level detection
    curve = []
    for th in (0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9):
        flagged = {a for a, s in scores.items() if s["composite"] >= th}
        tp = len(flagged & set(truth))
        p, r, f = _prf(tp, len(flagged) - tp, len(truth) - tp)
        curve.append({"threshold": th, "flagged": len(flagged), "precision": p, "recall": r, "f1": f})
    flagged = an.flagged()
    tp = len(flagged & set(truth))
    p, r, f = _prf(tp, len(flagged) - tp, len(truth) - tp)
    detection = {"threshold": config.ALERT_THRESHOLD, "precision": p, "recall": r, "f1": f,
                 "true_positives": tp, "false_positives": len(flagged) - tp, "false_negatives": len(truth) - tp,
                 "injected_mule_accounts": len(truth), "curve": curve}

    # ---- typology-level
    per_typ = []
    for t in TYPOLOGIES:
        support = [a for a, g in truth.items() if t.code in g["typologies"]]
        primary_support = [a for a, g in truth.items() if g["typologies"][0] == t.code]
        pred = {a for a, s in scores.items() if t.code in s["labels"] and s["composite"] >= config.ALERT_THRESHOLD}
        hit = len(pred & set(support))
        per_typ.append({"code": t.code, "name": t.name, "support": len(support), "predicted": len(pred),
                        "recall": round(hit / len(support), 3) if support else None,
                        "precision": round(len(pred & set(support)) / len(pred), 3) if pred else None,
                        "primary_support": len(primary_support)})
    prim_ok = sum(1 for a, g in truth.items() if scores[a]["primary"] in g["typologies"])
    typology = {"per_typology": per_typ, "primary_label_accuracy": round(prim_ok / len(truth), 4)}

    # ---- false positives on legitimate high-volume accounts
    vol = defaultdict(float)
    for t in an.txns:
        vol[t["src"]] += t["amount"]
        if t["dst"]:
            vol[t["dst"]] += t["amount"]
    ind = sorted((a for a, x in accts.items() if x["account_type"] == "individual" and a not in truth),
                 key=lambda a: -vol[a])
    groups = {
        "merchants": [a for a, x in accts.items() if x["account_type"] == "merchant"],
        "payroll_and_corporate": [a for a, x in accts.items() if x["account_type"] in ("payroll", "corporate")],
        "top_5pct_individuals_by_volume": ind[: max(1, len(ind) // 20)],
        "all_legitimate": [a for a in accts if a not in truth],
    }
    fpr = {k: {"accounts": len(v), "flagged": sum(1 for a in v if a in flagged),
               "rate": round(sum(1 for a in v if a in flagged) / len(v), 4) if v else 0.0} for k, v in groups.items()}

    # ---- trace quality per complaint
    comps = svc.db.query("SELECT * FROM complaints")
    ring_of = {}
    for c in comps:
        o = svc.tx_by_id[c["origin_txn_id"]]
        g = truth.get(o["dst"])
        ring_of[c["id"]] = g["ring_id"] if g else None
    rings = defaultdict(set)
    for a, g in truth.items():
        rings[g["ring_id"]].add(a)
    traces, rows = [], []
    for c in comps:
        o = svc.tx_by_id[c["origin_txn_id"]]
        tr = trace_origin(an, o)
        mules = {i for i, n in tr["nodes"].items() if n["role"] == "mule"}
        rid = ring_of[c["id"]]
        if rid is None:
            continue
        # true chain = ring accounts reachable from the first mule through transfers among ring members
        sub = nx.DiGraph()
        for t in an.txns:
            if t["kind"] == "transfer" and t["src"] in rings[rid] and t["dst"] in rings[rid]:
                sub.add_edge(t["src"], t["dst"])
        chain = {o["dst"]} | (nx.descendants(sub, o["dst"]) if o["dst"] in sub else set())
        tp = len(mules & chain)
        rows.append({"complaint": c["id"], "ring": rid, "traced": len(mules), "true_chain": len(chain),
                     "precision": round(tp / len(mules), 3) if mules else 0.0,
                     "recall": round(tp / len(chain), 3) if chain else 0.0,
                     "hop_depth": tr["stats"]["max_hop_depth"], "trace_ms": tr["stats"]["trace_ms"],
                     "money_span_minutes": tr["stats"]["money_span_minutes"]})
    trace = {
        "complaints_evaluated": len(rows),
        "mean_precision": round(mean(r["precision"] for r in rows), 4) if rows else 0.0,
        "mean_recall": round(mean(r["recall"] for r in rows), 4) if rows else 0.0,
        "mean_hop_depth": round(mean(r["hop_depth"] for r in rows), 2) if rows else 0.0,
        "mean_trace_ms": round(mean(r["trace_ms"] for r in rows), 2) if rows else 0.0,
        "mean_money_span_minutes": round(mean(r["money_span_minutes"] for r in rows), 1) if rows else 0.0,
        "per_complaint": rows,
    }
    out = {"available": True, "detection": detection, "typology": typology,
           "false_positive_rate": fpr, "trace": trace}
    if with_workflow:
        out["workflow"] = workflow_timing(svc)
    return out


def workflow_timing(svc) -> dict:
    """Scripted 'simulated investigator': top alert -> open linked case -> export report.

    Measures system latency of the click-path; it is a lower bound on human time-to-summary.
    """
    t0 = time.perf_counter()
    alerts = svc.alerts(limit=1)["items"]
    t1 = time.perf_counter()
    case_id = None
    if alerts and alerts[0]["case_ids"]:
        case_id = alerts[0]["case_ids"][0]
    else:
        cases = svc.list_cases()
        case_id = cases[0]["id"] if cases else None
    if case_id is None:
        return {"available": False}
    case = svc.get_case(case_id)
    t2 = time.perf_counter()
    pdf = svc.report_pdf(case_id)
    t3 = time.perf_counter()
    return {"available": True, "alert_queue_ms": round((t1 - t0) * 1000, 1), "open_case_ms": round((t2 - t1) * 1000, 1),
            "report_export_ms": round((t3 - t2) * 1000, 1), "total_ms": round((t3 - t0) * 1000, 1),
            "interactions": 3, "report_bytes": len(pdf), "case_id": case_id}
