"""Graph construction, per-account signals, typology scoring and composite suspicion score.

Every score is a weighted sum of independently interpretable signals so that the
dashboard can show investigators *why* an account was flagged:

    signals (0..1)  ->  typology score (weighted, optionally gated)  ->  composite

Composite = top typology score + 0.15 * runner-up, then damped by a "legitimacy"
factor (sustained activity / recurring counterparties) that protects merchants and
payroll accounts.
"""
from __future__ import annotations

import statistics
from bisect import bisect_left, bisect_right
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime

import networkx as nx

from . import config
from .typology import TYPOLOGIES

EPOCH = datetime(1970, 1, 1)
HOUR, DAY = 3600.0, 86400.0
THRESHOLDS = (10_000, 25_000, 50_000, 100_000)


def ramp(x: float, lo: float, hi: float) -> float:
    if hi <= lo:
        return 1.0 if x >= hi else 0.0
    return max(0.0, min(1.0, (x - lo) / (hi - lo)))


def epoch(dt: datetime) -> float:
    return (dt - EPOCH).total_seconds()


# --------------------------------------------------------------------------- typology weights
# (signal, weight) parts are summed; gates multiply the result.
FORMULAS = {
    "L1": {"parts": [("inflow_spike", .20), ("age_volume_mismatch", .25),
                     ("burst_concentration", .25), ("pass_through", .30)], "gates": []},
    "L23": {"parts": [("pass_through", .45), ("chain_depth", .35), ("young_account", .20)], "gates": []},
    "SMURF": {"parts": [("split_burst", .65), ("fed_by_single_inflow", .25), ("threshold_hugging", .10)], "gates": []},
    "CIRCULAR": {"parts": [("cycle_member", .85), ("pass_through", .15)], "gates": []},
    "CASHOUT": {"parts": [("withdrawal_ratio", .65), ("withdrawal_concentration", .35)],
                "gates": ["withdrawal_volume"]},
    "DORMANT": {"parts": [("burst_large", .25), ("funds_leave_quickly", .75)], "gates": ["dormancy_gap"]},
    "MULE_CLUSTER": {"parts": [("base", .70), ("cluster_linked", .30)], "gates": ["cluster_size"]},
}

REASONS = {
    "inflow_spike": lambda f: f"Largest inbound Rs {f['peak_in']:,.0f} is {f['spike_ratio']:.0f}x the account's usual inbound size",
    "age_volume_mismatch": lambda f: f"Account only {f['age_at_peak_days']:.0f} days old at peak inflow, Rs {f['inflow']:,.0f} received",
    "burst_concentration": lambda f: f"{f['burst_concentration']:.0%} of all account activity falls in the 25h around the peak inflow",
    "pass_through": lambda f: f"{f['pass_ratio']:.0%} of large inflows forwarded/withdrawn within 6h (median dwell {f['median_dwell_min']:.0f} min)",
    "chain_depth": lambda f: f"Sits on a rapid pass-through chain spanning {f['chain_len']} hop(s)",
    "young_account": lambda f: f"Account opened {f['age_at_peak_days']:.0f} days before peak inflow",
    "split_burst": lambda f: f"{f['split_n']} near-equal transfers (CV {f['split_cv']:.2f}) to distinct recipients within 24h, total Rs {f['split_total']:,.0f}",
    "fed_by_single_inflow": lambda f: "Outflow burst funded by a single large inbound transfer",
    "threshold_hugging": lambda f: "Transfer amounts cluster just under reporting/limit thresholds",
    "cycle_member": lambda f: "Member of a time-ordered, value-preserving transfer cycle",
    "withdrawal_ratio": lambda f: f"{f['wd_ratio_raw']:.0%} of inflow withdrawn as cash (Rs {f['wd_total']:,.0f})",
    "withdrawal_concentration": lambda f: f"{f['wd_conc']:.0%} of withdrawals fall inside a single 6h window",
    "withdrawal_volume": lambda f: f"Cash withdrawn Rs {f['wd_total']:,.0f}",
    "dormancy_gap": lambda f: f"Inactive for {f['gap_days']:.0f} days before the peak inflow",
    "burst_large": lambda f: f"Single burst of Rs {f['peak_in']:,.0f} after long inactivity",
    "funds_leave_quickly": lambda f: "Funds left the account almost immediately",
    "cluster_size": lambda f: f"Opened within 72h of {f['cluster_n'] - 1} other account(s) sharing KYC device/address",
    "cluster_linked": lambda f: "Cluster members transact with each other or share counterparties",
}


@dataclass
class Analysis:
    accounts: dict
    txns: list
    G: nx.DiGraph
    inn: dict
    out: dict
    wd: dict
    features: dict
    scores: dict
    as_of: datetime
    cycles: list = field(default_factory=list)
    clusters: dict = field(default_factory=dict)
    betweenness: dict = field(default_factory=dict)
    pagerank: dict = field(default_factory=dict)

    def flagged(self, threshold: float | None = None):
        th = config.ALERT_THRESHOLD if threshold is None else threshold
        return {a for a, s in self.scores.items() if s["composite"] >= th}


# --------------------------------------------------------------------------- graph
def build_graph(accounts: dict, txns: list) -> nx.DiGraph:
    """Aggregated directed graph: one edge per (src,dst) with count / total / first / last."""
    G = nx.DiGraph()
    for a in accounts.values():
        G.add_node(a["id"], type=a["account_type"])
    for t in txns:
        if t["kind"] != "transfer":
            continue
        u, v = t["src"], t["dst"]
        if G.has_edge(u, v):
            e = G[u][v]
            e["count"] += 1
            e["total"] += t["amount"]
            e["last"] = max(e["last"], t["t"])
            e["first"] = min(e["first"], t["t"])
        else:
            G.add_edge(u, v, count=1, total=t["amount"], first=t["t"], last=t["t"])
    return G


def index_txns(txns: list):
    inn, out, wd = defaultdict(list), defaultdict(list), defaultdict(list)
    for t in txns:
        if "t" not in t:
            t["t"] = epoch(t["ts"])
        if t["kind"] == "withdrawal":
            wd[t["src"]].append(t)
        else:
            out[t["src"]].append(t)
            inn[t["dst"]].append(t)
    for d in (inn, out, wd):
        for k in d:
            d[k].sort(key=lambda x: x["t"])
    return inn, out, wd


# --------------------------------------------------------------------------- signal helpers
def pass_through(ins: list, fwd: list, window=6 * HOUR, min_amt=3_000):
    """FIFO-allocate outflows (transfers + cash) to large inflows inside `window`.

    Returns (amount-weighted forwarded ratio, median dwell minutes, [(inbound txn, fraction forwarded)]).
    """
    times = [x["t"] for x in fwd]
    rem = [x["amount"] for x in fwd]
    big_total = matched = 0.0
    dwell: list[tuple[float, float]] = []
    per_in = []
    for i in ins:
        if i["amount"] < min_amt:
            continue
        need, got = i["amount"], 0.0
        lo, hi = bisect_left(times, i["t"]), bisect_right(times, i["t"] + window)
        for k in range(lo, hi):
            if need <= 0:
                break
            take = min(rem[k], need)
            if take <= 0:
                continue
            rem[k] -= take
            need -= take
            got += take
            dwell.append(((times[k] - i["t"]) / 60.0, take))
        big_total += i["amount"]
        matched += got
        per_in.append((i, got / i["amount"]))
    if big_total == 0:
        return 0.0, 0.0, []
    med = 0.0
    if dwell:
        dwell.sort()
        half, acc = sum(w for _, w in dwell) / 2, 0.0
        for d, w in dwell:
            acc += w
            if acc >= half:
                med = d
                break
    return matched / big_total, med, per_in


def split_burst(outs: list):
    """Best 24h window of outgoing transfers: many distinct recipients, near-equal amounts."""
    best = {"score": 0.0, "n": 0, "cv": 0.0, "total": 0.0, "t0": 0.0, "t1": 0.0, "hug": 0.0}
    n = len(outs)
    if n < 5:
        return best
    r = 0
    for i in range(n):
        r = max(r, i)
        while r + 1 < n and outs[r + 1]["t"] <= outs[i]["t"] + DAY:
            r += 1
        win = outs[i:r + 1]
        if len(win) < 5:
            continue
        dsts = {w["dst"] for w in win}
        amts = [w["amount"] for w in win]
        total, mean = sum(amts), sum(amts) / len(amts)
        cv = statistics.pstdev(amts) / mean if mean else 9
        sc = ramp(len(dsts), 5, 10) * (1 - ramp(cv, 0.10, 0.50)) * ramp(total, 30_000, 100_000)
        if sc > best["score"]:
            hug = sum(1 for a in amts if any(0.90 * th <= a < th for th in THRESHOLDS)) / len(amts)
            best = {"score": sc, "n": len(dsts), "cv": cv, "total": total,
                    "t0": win[0]["t"], "t1": win[-1]["t"], "hug": hug}
    return best


def withdrawal_conc(wds: list, window=6 * HOUR) -> float:
    if not wds:
        return 0.0
    total = sum(w["amount"] for w in wds)
    best, r = 0.0, 0
    for i in range(len(wds)):
        while r < len(wds) and wds[r]["t"] <= wds[i]["t"] + window:
            r += 1
        best = max(best, sum(w["amount"] for w in wds[i:r]) / total)
    return best


def _valid_cycle(cycle, edges) -> bool:
    n = len(cycle)
    for s in range(n):
        order = [cycle[(s + i) % n] for i in range(n + 1)]
        for first in edges[(order[0], order[1])]:
            t_start = t_prev = first["t"]
            amt, ok = first["amount"], True
            for i in range(1, n):
                nxt = next((tx for tx in edges[(order[i], order[i + 1])]
                            if t_prev <= tx["t"] <= t_prev + DAY and 0.6 * amt <= tx["amount"] <= 1.02 * amt), None)
                if nxt is None:
                    ok = False
                    break
                t_prev, amt = nxt["t"], nxt["amount"]
            if ok and t_prev - t_start <= 72 * HOUR:
                return True
    return False


def find_cycles(txns: list, min_amount=10_000, max_len=6, cap=20_000):
    edges = defaultdict(list)
    Gc = nx.DiGraph()
    for t in txns:
        if t["kind"] == "transfer" and t["amount"] >= min_amount:
            edges[(t["src"], t["dst"])].append(t)
            Gc.add_edge(t["src"], t["dst"])
    found, seen = [], 0
    for cyc in nx.simple_cycles(Gc, length_bound=max_len):
        seen += 1
        if seen > cap:
            break
        if len(cyc) >= 3 and _valid_cycle(cyc, edges):
            found.append(cyc)
    return found


def creation_clusters(accounts: dict, window=72 * HOUR):
    """Union accounts that share a KYC device/address AND were opened within `window` of each other."""
    parent = {a: a for a in accounts}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for key in ("kyc_device", "kyc_address"):
        groups = defaultdict(list)
        for a in accounts.values():
            if a.get(key):
                groups[a[key]].append(a)
        for g in groups.values():
            if len(g) < 2:
                continue
            g.sort(key=lambda a: a["created_at"])
            for x, y in zip(g, g[1:]):
                if epoch(y["created_at"]) - epoch(x["created_at"]) <= window:
                    parent[find(x["id"])] = find(y["id"])
    comps = defaultdict(list)
    for a in accounts:
        comps[find(a)].append(a)
    return {m: comp for comp in comps.values() if len(comp) > 1 for m in comp}


# --------------------------------------------------------------------------- per-account features
def account_features(a: str, acct: dict, inn, out, wd, H_depth, in_cycle, cluster_of, G) -> dict:
    ins, outs, wds = inn.get(a, []), out.get(a, []), wd.get(a, [])
    f: dict = {"base": 1.0}
    events = sorted(x["t"] for x in ins + outs + wds)
    created_t = epoch(acct["created_at"])
    inflow = sum(x["amount"] for x in ins)
    wd_total = sum(x["amount"] for x in wds)
    f.update(n_in=len(ins), n_out=len(outs), n_wd=len(wds), inflow=inflow,
             outflow=sum(x["amount"] for x in outs), wd_total=wd_total,
             in_degree=G.in_degree(a) if a in G else 0, out_degree=G.out_degree(a) if a in G else 0)

    # ---- inbound spike / age / dormancy / burst
    f.update(inflow_spike=0.0, age_volume_mismatch=0.0, young_account=0.0, burst_concentration=0.0,
             dormancy_gap=0.0, burst_large=0.0, peak_in=0.0, spike_ratio=0.0, age_at_peak_days=0.0, gap_days=0.0)
    if ins:
        peak = max(ins, key=lambda x: x["amount"])
        others = [x["amount"] for x in ins if x is not peak]
        baseline = max(statistics.median(others), 1000.0) if others else 2000.0
        ratio = peak["amount"] / baseline
        age_days = (peak["t"] - created_t) / DAY
        young = 1 - ramp(age_days, 30, 180)
        in_burst = sum(1 for e in events if peak["t"] - HOUR <= e <= peak["t"] + DAY + HOUR)
        prev = [e for e in events if e < peak["t"]]
        if prev:
            prev_t = max(prev)
        elif acct.get("last_active_at"):
            prev_t = epoch(acct["last_active_at"])
        else:
            prev_t = created_t
        gap = (peak["t"] - prev_t) / DAY
        f.update(peak_in=peak["amount"], spike_ratio=ratio, age_at_peak_days=age_days, gap_days=gap,
                 inflow_spike=ramp(ratio, 5, 30) * ramp(peak["amount"], 15_000, 60_000),
                 young_account=young,
                 age_volume_mismatch=young * ramp(inflow, 30_000, 150_000),
                 burst_concentration=in_burst / max(1, len(events)),
                 dormancy_gap=ramp(gap, 90, 270),
                 burst_large=ramp(peak["amount"], 10_000, 50_000) * (in_burst / max(1, len(events))))

    # ---- pass-through
    fwd = sorted(outs + wds, key=lambda x: x["t"])
    ratio, med, per_in = pass_through(ins, fwd)
    fast = 1 - ramp(med, 30, 360)
    pt = ratio * (0.5 + 0.5 * fast)
    f.update(pass_ratio=ratio, median_dwell_min=med, pass_through=pt, _per_in=per_in)
    f["chain_len"] = H_depth.get(a, 0)
    f["chain_depth"] = ramp(f["chain_len"], 1, 3) if per_in and ratio > 0.5 else 0.0

    # ---- splitting
    sb = split_burst(outs)
    fed = 0.0
    if sb["score"] > 0:
        feeders = [x["amount"] for x in ins if sb["t0"] - 6 * HOUR <= x["t"] <= sb["t1"]]
        if feeders:
            fed = ramp(min(1.0, max(feeders) / sb["total"]), 0.6, 1.0)
    f.update(split_burst=sb["score"], split_n=sb["n"], split_cv=sb["cv"], split_total=sb["total"],
             fed_by_single_inflow=fed, threshold_hugging=sb["hug"])
    big_out = [x["amount"] for x in outs + wds if x["amount"] >= 1000]
    f["round_bias"] = (sum(1 for x in big_out if x % 500 == 0) / len(big_out)) if big_out else 0.0

    # ---- cash-out
    raw = min(1.0, wd_total / inflow) if inflow > 0 else (1.0 if wd_total > 0 else 0.0)
    f.update(wd_ratio_raw=raw, withdrawal_ratio=ramp(raw, 0.4, 0.9), wd_conc=withdrawal_conc(wds),
             withdrawal_volume=ramp(wd_total, 15_000, 50_000))
    f["withdrawal_concentration"] = ramp(f["wd_conc"], 0.5, 0.9)
    f["funds_leave_quickly"] = max(pt, raw * ramp(wd_total, 10_000, 30_000))

    # ---- cycle & cluster
    f["cycle_member"] = 1.0 if a in in_cycle else 0.0
    comp = cluster_of.get(a)
    f.update(cluster_n=len(comp) if comp else 1, cluster_size=ramp(len(comp), 2, 5) if comp else 0.0,
             cluster_linked=0.0)
    if comp:
        cs = set(comp)
        nbrs = {m: (set(G.successors(m)) | set(G.predecessors(m))) if m in G else set() for m in comp}
        linked = any((nbrs[m] & cs) for m in comp)
        if not linked:
            ms = list(comp)
            linked = any(nbrs[ms[i]] & nbrs[ms[j]] for i in range(len(ms)) for j in range(i + 1, len(ms)))
        f["cluster_linked"] = 1.0 if linked else 0.0

    # ---- legitimacy dampener: sustained activity or recurring counterparties
    active_days = len({int(e // DAY) for e in events})
    cp_times, cp_amt = defaultdict(list), defaultdict(float)
    for x in ins:
        cp_times[x["src"]].append(x["t"])
        cp_amt[x["src"]] += x["amount"]
    for x in outs:
        cp_times[x["dst"]].append(x["t"])
        cp_amt[x["dst"]] += x["amount"]
    tot = sum(cp_amt.values())
    rec_amt = sum(cp_amt[c] for c, ts in cp_times.items() if max(ts) - min(ts) >= 14 * DAY)
    recurrence = rec_amt / tot if tot else 0.0
    f.update(active_days=active_days, recurrence=recurrence,
             legitimacy=max(ramp(active_days, 12, 30), ramp(recurrence, 0.4, 0.8)))
    return f


def pass_through_depth(features_pt: dict, inn, out, wd) -> dict:
    """Longest rapid pass-through chain (hops) passing through each account.

    H has an edge u->v when v forwards >=70% of a >=5k inbound from u within 6h.
    """
    H = nx.DiGraph()
    for a, per_in in features_pt.items():
        for tx, frac in per_in:
            if frac >= 0.7 and tx["amount"] >= 5_000:
                H.add_edge(tx["src"], a)
    depth = {}

    def reach(v, rev):
        seen, frontier, lvl = {v}, [v], 0
        while frontier and lvl < 6:
            nxt = []
            for x in frontier:
                for y in (H.predecessors(x) if rev else H.successors(x)):
                    if y not in seen:
                        seen.add(y)
                        nxt.append(y)
            if nxt:
                lvl += 1
            frontier = nxt
        return lvl

    targets = {v for _, v in H.edges()}
    for v in targets:
        depth[v] = reach(v, True) + reach(v, False)
    return depth


# --------------------------------------------------------------------------- scoring
def score_account(f: dict, typology_threshold: float | None = None) -> dict:
    th = config.TYPOLOGY_THRESHOLD if typology_threshold is None else typology_threshold
    damp = 1 - 0.85 * f["legitimacy"]
    typs = {}
    for t in TYPOLOGIES:
        spec = FORMULAS[t.code]
        s, ev = 0.0, []
        for sig, w in spec["parts"]:
            v = f.get(sig, 0.0)
            s += w * v
            if v > 0 and sig != "base":
                ev.append({"signal": sig, "value": round(v, 3), "weight": w, "contribution": round(w * v, 3),
                           "text": REASONS[sig](f) if sig in REASONS else sig})
        for g in spec["gates"]:
            v = f.get(g, 0.0)
            s *= v
            ev.append({"signal": g, "value": round(v, 3), "weight": "gate", "contribution": None,
                       "text": REASONS[g](f) if g in REASONS else g})
        raw = min(1.0, s)
        ev.sort(key=lambda e: -(e["contribution"] or 0))
        typs[t.code] = {"score": round(raw * damp, 4), "raw": round(raw, 4), "evidence": ev}
    ranked = sorted(typs.items(), key=lambda kv: -kv[1]["score"])
    comp = ranked[0][1]["score"] + 0.15 * ranked[1][1]["score"]
    comp = min(1.0, comp)
    labels = [c for c, v in ranked if v["score"] >= th]
    return {"composite": round(comp, 4), "typologies": typs, "labels": labels,
            "primary": ranked[0][0] if ranked[0][1]["score"] > 0 else None,
            "legitimacy": round(f["legitimacy"], 3)}


def analyze(accounts: list | dict, txns: list, typology_threshold: float | None = None) -> Analysis:
    accts = accounts if isinstance(accounts, dict) else {a["id"]: a for a in accounts}
    inn, out, wd = index_txns(txns)
    G = build_graph(accts, txns)
    # phase A: pass-through for every account (needed for chain depth)
    pt_cache = {}
    for a in accts:
        ins = inn.get(a, [])
        if ins:
            fwd = sorted(out.get(a, []) + wd.get(a, []), key=lambda x: x["t"])
            pt_cache[a] = pass_through(ins, fwd)[2]
    H_depth = pass_through_depth(pt_cache, inn, out, wd)
    cycles = find_cycles(txns)
    in_cycle = {n for c in cycles for n in c}
    clusters = creation_clusters(accts)
    feats, scores = {}, {}
    for a, acct in accts.items():
        feats[a] = account_features(a, acct, inn, out, wd, H_depth, in_cycle, clusters, G)
        scores[a] = score_account(feats[a], typology_threshold)
    # structural context (for dashboard / prioritisation)
    n = G.number_of_nodes()
    btw = nx.betweenness_centrality(G, k=min(150, n), seed=7, normalized=True) if n else {}
    pr = nx.pagerank(G, weight="total") if n else {}
    for a in accts:
        feats[a]["betweenness"] = btw.get(a, 0.0)
        feats[a]["pagerank"] = pr.get(a, 0.0)
        feats[a].pop("_per_in", None)
    as_of = max(t["ts"] for t in txns) if txns else EPOCH
    return Analysis(accts, txns, G, inn, out, wd, feats, scores, as_of, cycles, clusters, btw, pr)
