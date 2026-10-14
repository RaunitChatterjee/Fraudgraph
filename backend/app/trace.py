"""Complaint-driven money trace + case prioritization.

Given a complaint's originating transaction, follow the money forward through
the transaction graph in a *time-respecting* way:

* an outbound transfer / cash withdrawal is followed only if it happens within
  ``window`` of the funds arriving and is large enough to be a meaningful share
  of them (so ordinary background activity of a mule is not dragged in);
* accounts that look like legitimate hubs (merchants, payroll: sustained activity /
  recurring counterparties) are recorded as *boundary* nodes and not expanded;
* loops are detected (an already-visited account receiving funds again).
"""
from __future__ import annotations

import math
import time
from collections import deque
from datetime import datetime

import networkx as nx

from .detection import Analysis, ramp, epoch

CASH_PREFIX = "CASH:"


def trace_origin(an: Analysis, origin: dict, window_h: float = 12.0, max_hops: int = 8,
                 max_nodes: int = 400, boundary_legitimacy: float = 0.8) -> dict:
    t_start = time.perf_counter()
    window = window_h * 3600
    victim, first = origin["src"], origin["dst"]
    floor_abs = 1_000.0

    nodes: dict[str, dict] = {
        victim: {"id": victim, "hop": 0, "role": "victim", "first_in": origin["t"], "last_in": origin["t"],
                 "inflow": 0.0, "outflow": origin["amount"], "withdrawn": 0.0},
    }
    edges: list[dict] = [_edge(origin, 1, loop=False)]
    taken = {origin["id"]}

    def add_inflow(dst, tx, hop):
        n = nodes.get(dst)
        if n is None:
            nodes[dst] = {"id": dst, "hop": hop, "role": "mule", "first_in": tx["t"], "last_in": tx["t"],
                          "inflow": tx["amount"], "outflow": 0.0, "withdrawn": 0.0, "first_amount": tx["amount"]}
            return True
        n["inflow"] += tx["amount"]
        n["last_in"] = max(n["last_in"], tx["t"])
        return False

    add_inflow(first, origin, 1)
    queue = deque([first])
    expanded_until: dict[str, float] = {}
    loops = 0
    while queue and len(nodes) < max_nodes:
        a = queue.popleft()
        n = nodes[a]
        if n["role"] == "boundary" or n["hop"] >= max_hops:
            continue
        if an.features[a]["legitimacy"] >= boundary_legitimacy:
            n["role"] = "boundary"
            continue
        horizon = n["last_in"] + window
        floor = max(floor_abs, 0.025 * n.get("first_amount", 0))
        for tx in an.out.get(a, []) + an.wd.get(a, []):
            if tx["id"] in taken or tx["t"] < n["first_in"] or tx["t"] > horizon or tx["amount"] < floor:
                continue
            taken.add(tx["id"])
            n["outflow"] += tx["amount"] if tx["kind"] == "transfer" else 0.0
            if tx["kind"] == "withdrawal":
                n["withdrawn"] += tx["amount"]
                cash = CASH_PREFIX + a
                nodes.setdefault(cash, {"id": cash, "hop": n["hop"] + 1, "role": "cash", "inflow": 0.0,
                                        "first_in": tx["t"], "last_in": tx["t"], "outflow": 0.0, "withdrawn": 0.0})
                nodes[cash]["inflow"] += tx["amount"]
                nodes[cash]["last_in"] = max(nodes[cash]["last_in"], tx["t"])
                edges.append(_edge(tx, n["hop"] + 1, dst_override=cash))
                continue
            dst = tx["dst"]
            is_new = add_inflow(dst, tx, n["hop"] + 1)
            loop = (not is_new) and dst in nodes and nodes[dst]["hop"] <= n["hop"]
            loops += 1 if loop else 0
            edges.append(_edge(tx, n["hop"] + 1, loop=loop))
            if is_new or nodes[dst]["last_in"] + window > expanded_until.get(dst, 0):
                if dst not in queue:
                    queue.append(dst)
        expanded_until[a] = horizon
    for n in nodes.values():
        if n["role"] == "mule":
            n["retained"] = max(0.0, n["inflow"] - n["outflow"] - n["withdrawn"])
    mules = [n for n in nodes.values() if n["role"] == "mule"]
    cash = [n for n in nodes.values() if n["role"] == "cash"]
    last_t = max((e["t"] for e in edges), default=origin["t"])
    stats = {
        "origin_txn_id": origin["id"],
        "complaint_amount": origin["amount"],
        "accounts_traced": len(mules),
        "boundary_accounts": sum(1 for n in nodes.values() if n["role"] == "boundary"),
        "max_hop_depth": max((n["hop"] for n in mules), default=0),
        "transfer_count": sum(1 for e in edges if e["kind"] != "withdrawal"),
        "laundered_volume": round(sum(e["amount"] for e in edges if e["kind"] != "withdrawal"), 2),
        "cash_out_total": round(sum(n["inflow"] for n in cash), 2),
        "recoverable_amount": round(sum(n.get("retained", 0.0) for n in mules), 2),
        "loops_detected": loops,
        "money_span_minutes": round((last_t - origin["t"]) / 60.0, 1),
        "trace_ms": round((time.perf_counter() - t_start) * 1000, 1),
    }
    return {"nodes": nodes, "edges": edges, "stats": stats}


def _edge(tx, hop, loop=False, dst_override=None):
    return {"txn_id": tx["id"], "src": tx["src"], "dst": dst_override or tx["dst"], "amount": tx["amount"],
            "t": tx["t"], "ts": tx["ts"].strftime("%Y-%m-%dT%H:%M:%S"), "channel": tx["channel"],
            "kind": tx["kind"], "hop": hop, "loop": loop}


# --------------------------------------------------------------------------- prioritization
WEIGHTS = {"amount": 0.35, "centrality": 0.25, "recency": 0.25, "confidence": 0.15}
HALF_LIFE_HOURS = 72.0


def prioritize(an: Analysis, trace: dict, complaint_amount: float, filed_at: datetime, as_of: datetime) -> dict:
    """Composite case risk 0-100: amount at risk, network centrality, complaint recency, detection confidence."""
    amount_sig = ramp(math.log10(max(complaint_amount, 1)), math.log10(10_000), math.log10(1_000_000))
    ids = [i for i, n in trace["nodes"].items() if n["role"] in ("mule", "victim")]
    sub = nx.DiGraph()
    for e in trace["edges"]:
        if e["kind"] != "withdrawal":
            sub.add_edge(e["src"], e["dst"])
    cent = 0.0
    if sub.number_of_nodes() > 2:
        btw = nx.betweenness_centrality(sub, normalized=True)
        top = sorted(btw.values(), reverse=True)[:3]
        cent = min(1.0, 2.0 * sum(top) / len(top))
        # broad fan-out networks are inherently harder / more urgent
        cent = min(1.0, cent + 0.15 * ramp(sub.number_of_nodes(), 8, 30))
    hours = max(0.0, (as_of - filed_at).total_seconds() / 3600)
    recency = 0.5 ** (hours / HALF_LIFE_HOURS)
    mule_scores = sorted((an.scores[i]["composite"] for i, n in trace["nodes"].items() if n["role"] == "mule"),
                         reverse=True)
    conf = sum(mule_scores[:5]) / len(mule_scores[:5]) if mule_scores else 0.0
    comps = {"amount": amount_sig, "centrality": cent, "recency": recency, "confidence": conf}
    score = 100 * sum(WEIGHTS[k] * v for k, v in comps.items())
    label = "Critical" if score >= 60 else "High" if score >= 50 else "Medium" if score >= 40 else "Low"
    return {"score": round(score, 1), "label": label,
            "components": {k: round(v, 3) for k, v in comps.items()}, "weights": WEIGHTS}
