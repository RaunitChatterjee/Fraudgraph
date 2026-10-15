"""Application service: dataset lifecycle, detection cache, complaint intake, cases, alerts."""
from __future__ import annotations

import json
import threading
from collections import defaultdict
from datetime import datetime, timedelta

from . import config
from .db import Database, iso, new_id, to_dt, utcnow
from .detection import Analysis, analyze, epoch
from .generator import GeneratorConfig, generate
from .reporting import build_case_report
from .trace import prioritize, trace_origin
from .typology import BY_CODE, matrix

CASE_STATUSES = ["open", "investigating", "funds_frozen", "closed"]


class NotFound(Exception):
    pass


class FraudGraphService:
    def __init__(self, db: Database):
        self.db = db
        self.lock = threading.RLock()
        self.an: Analysis | None = None
        self.tx_by_id: dict = {}
        self._by_device: dict = defaultdict(list)
        self._by_address: dict = defaultdict(list)
        self._metrics_cache = None

    # ------------------------------------------------------------------ lifecycle
    def is_empty(self) -> bool:
        return self.db.one("SELECT COUNT(*) AS n FROM accounts")["n"] == 0

    def seed(self, cfg: GeneratorConfig | None = None, with_cases: bool = True) -> dict:
        cfg = cfg or GeneratorConfig(seed=config.SEED)
        ds = generate(cfg)
        with self.lock:
            self.db.clear_all()
            self.db.executemany(
                "INSERT INTO accounts (id, holder_name, bank, account_type, created_at, last_active_at, kyc_address, kyc_device, status) "
                "VALUES (?,?,?,?,?,?,?,?,?)",
                [(a["id"], a["holder_name"], a["bank"], a["account_type"], iso(a["created_at"]), iso(a["last_active_at"]),
                  a["kyc_address"], a["kyc_device"], a["status"]) for a in ds.accounts])
            self.db.executemany(
                "INSERT INTO transactions (id, src, dst, amount, ts, channel, kind) VALUES (?,?,?,?,?,?,?)",
                [(t["id"], t["src"], t["dst"], t["amount"], iso(t["ts"]), t["channel"], t["kind"]) for t in ds.transactions])
            self.db.executemany(
                "INSERT INTO complaints (id, victim_account, origin_txn_id, amount, filed_at, category, description, status) "
                "VALUES (?,?,?,?,?,?,?,?)",
                [(c["id"], c["victim_account"], c["origin_txn_id"], c["amount"], iso(c["filed_at"]), c["category"],
                  c["description"], "registered") for c in ds.complaints])
            self.db.executemany(
                "INSERT INTO ground_truth (account_id, ring_id, ring_type, role, typologies) VALUES (?,?,?,?,?)",
                [(a, g["ring_id"], g["ring_type"], g["role"], json.dumps(g["typologies"])) for a, g in ds.ground_truth.items()])
            self.db.set_meta("as_of", iso(ds.end))
            self.db.set_meta("seed", cfg.seed)
            self.load()
            created = 0
            if with_cases:
                for c in self.db.query("SELECT * FROM complaints ORDER BY filed_at"):
                    self._create_case(c)
                    created += 1
        return {"accounts": len(ds.accounts), "transactions": len(ds.transactions),
                "complaints": len(ds.complaints), "cases": created, "injected_rings": len(ds.rings)}

    def load(self):
        """(Re)build graph, signals and scores from the database."""
        with self.lock:
            accts = {}
            for r in self.db.query("SELECT * FROM accounts"):
                r["created_at"] = to_dt(r["created_at"])
                r["last_active_at"] = to_dt(r["last_active_at"])
                accts[r["id"]] = r
            txns = []
            for r in self.db.query("SELECT * FROM transactions ORDER BY ts"):
                r["ts"] = to_dt(r["ts"])
                txns.append(r)
            self.an = analyze(accts, txns)
            self.tx_by_id = {t["id"]: t for t in txns}
            self._by_device, self._by_address = defaultdict(list), defaultdict(list)
            for a in accts.values():
                self._by_device[a["kyc_device"]].append(a["id"])
                self._by_address[a["kyc_address"]].append(a["id"])
            self._metrics_cache = None

    def ensure_cases(self) -> int:
        """Create cases for any complaint that has none (repairs an interrupted seed)."""
        with self.lock:
            have = {r["complaint_id"] for r in self.db.query("SELECT complaint_id FROM cases")}
            made = 0
            for c in self.db.query("SELECT * FROM complaints ORDER BY filed_at"):
                if c["id"] not in have and c["origin_txn_id"] in self.tx_by_id:
                    self._create_case(c)
                    made += 1
            return made

    @property
    def as_of(self) -> datetime:
        v = self.db.get_meta("as_of")
        return to_dt(v) if v else self.an.as_of

    # ------------------------------------------------------------------ stats
    def stats(self) -> dict:
        d = self.db
        cases = d.query("SELECT status, priority_label, COUNT(*) AS n FROM cases GROUP BY status, priority_label")
        by_status, by_label = defaultdict(int), defaultdict(int)
        for r in cases:
            by_status[r["status"]] += r["n"]
            by_label[r["priority_label"]] += r["n"]
        amt = d.one("SELECT COALESCE(SUM(amount),0) AS s FROM complaints")["s"]
        frozen = sum(json.loads(e["payload"]).get("amount_frozen", 0) for e in
                     d.query("SELECT payload FROM case_events WHERE kind = 'freeze'"))
        return {
            "accounts": len(self.an.accounts), "transactions": len(self.an.txns),
            "flagged_accounts": len(self.an.flagged()), "complaints": d.one("SELECT COUNT(*) AS n FROM complaints")["n"],
            "cases_by_status": dict(by_status), "cases_by_priority": dict(by_label),
            "amount_reported": float(amt), "amount_frozen": float(frozen),
            "frozen_accounts": d.one("SELECT COUNT(*) AS n FROM accounts WHERE status = 'frozen'")["n"],
            "as_of": iso(self.as_of), "window_days": round((self.an.as_of - min(t["ts"] for t in self.an.txns)).days) if self.an.txns else 0,
        }

    def overview(self) -> dict:
        cases = self.list_cases()
        end = self.as_of.date()
        by_day = defaultdict(lambda: {"count": 0, "amount": 0.0})
        for c in cases:
            d = c["filed_at"][:10]
            by_day[d]["count"] += 1
            by_day[d]["amount"] += c["amount"]
        vol = defaultdict(lambda: {"count": 0, "amount": 0.0})
        for t in self.an.txns:
            if t["kind"] == "transfer":
                d = t["ts"].date().isoformat()
                vol[d]["count"] += 1
                vol[d]["amount"] += t["amount"]
        days = [(end - timedelta(days=i)).isoformat() for i in range(20, -1, -1)]
        prio = defaultdict(int)
        for c in cases:
            prio[c["priority_label"]] += 1
        lag = [{"case_id": c["id"], "priority": c["priority_label"], "amount": c["amount"],
                "report_delay_min": c["report_delay_min"], "money_span_minutes": c["money_span_minutes"],
                "gone_before_filing": (c["report_delay_min"] or 0) > c["money_span_minutes"]} for c in cases]
        gone = sum(1 for x in lag if x["gone_before_filing"])
        return {
            "complaints_by_day": [{"day": d, **by_day.get(d, {"count": 0, "amount": 0.0})} for d in days],
            "volume_by_day": [{"day": d, **vol.get(d, {"count": 0, "amount": 0.0})} for d in days],
            "priority": {k: prio.get(k, 0) for k in ("Critical", "High", "Medium", "Low")},
            "typologies": [{"code": t["code"], "tid": t["tid"], "name": t["name"], "tactic": t["tactic"],
                            "flagged": t["flagged_accounts"]} for t in self.typologies()],
            "lag": lag,
            "gone_before_filing": gone,
            "total_cases": len(cases),
            "totals": {"reported": sum(c["amount"] for c in cases),
                       "cash_out": sum(c["cash_out_total"] for c in cases),
                       "recoverable": sum(c["recoverable_amount"] for c in cases)},
            "top_cases": cases[:5],
        }

    def typologies(self) -> list:
        counts = defaultdict(int)
        for a, s in self.an.scores.items():
            if s["composite"] >= config.ALERT_THRESHOLD:
                for lab in s["labels"]:
                    counts[lab] += 1
        rows = matrix()
        for r in rows:
            r["flagged_accounts"] = counts.get(r["code"], 0)
        return rows

    # ------------------------------------------------------------------ alerts / accounts
    def _case_index(self) -> dict:
        idx = defaultdict(list)
        for r in self.db.query("SELECT case_id, account_id FROM case_accounts"):
            idx[r["account_id"]].append(r["case_id"])
        return idx

    def alerts(self, typology=None, min_score=None, q=None, limit=100, offset=0) -> dict:
        th = config.ALERT_THRESHOLD if min_score is None else float(min_score)
        idx = self._case_index()
        rows = []
        for a, s in self.an.scores.items():
            if s["composite"] < th:
                continue
            if typology and typology not in s["labels"]:
                continue
            acct = self.an.accounts[a]
            if q and q.lower() not in (a + " " + acct["holder_name"]).lower():
                continue
            top = s["typologies"][s["primary"]]["evidence"] if s["primary"] else []
            rows.append({
                "account_id": a, "holder_name": acct["holder_name"], "bank": acct["bank"],
                "account_type": acct["account_type"], "status": acct["status"], "score": s["composite"],
                "labels": s["labels"], "primary": s["primary"],
                "reason": next((e["text"] for e in top if e["weight"] != "gate"), ""),
                "case_ids": idx.get(a, []),
            })
        rows.sort(key=lambda r: -r["score"])
        return {"total": len(rows), "items": rows[offset: offset + limit]}

    def account(self, account_id: str) -> dict:
        acct = self.an.accounts.get(account_id)
        if not acct:
            raise NotFound(account_id)
        f = {k: v for k, v in self.an.features[account_id].items() if not k.startswith("_")}
        s = self.an.scores[account_id]
        txs = sorted(self.an.inn.get(account_id, []) + self.an.out.get(account_id, []) + self.an.wd.get(account_id, []),
                     key=lambda t: -t["t"])[:60]
        cps = defaultdict(lambda: {"in": 0.0, "out": 0.0, "n": 0})
        for t in self.an.inn.get(account_id, []):
            cps[t["src"]]["in"] += t["amount"]
            cps[t["src"]]["n"] += 1
        for t in self.an.out.get(account_id, []):
            cps[t["dst"]]["out"] += t["amount"]
            cps[t["dst"]]["n"] += 1
        top_cp = sorted(cps.items(), key=lambda kv: -(kv[1]["in"] + kv[1]["out"]))[:10]
        return {
            "account": {**acct, "created_at": iso(acct["created_at"]), "last_active_at": iso(acct["last_active_at"])},
            "score": s, "features": {k: (round(v, 4) if isinstance(v, float) else v) for k, v in f.items()},
            "recent_transactions": [{"id": t["id"], "src": t["src"], "dst": t["dst"], "amount": t["amount"],
                                     "ts": iso(t["ts"]), "channel": t["channel"], "kind": t["kind"]} for t in txs],
            "top_counterparties": [{"account_id": k, **v} for k, v in top_cp],
            "cases": self._case_index().get(account_id, []),
        }

    def neighborhood(self, account_id: str, depth: int = 1, limit: int = 80) -> dict:
        if account_id not in self.an.accounts:
            raise NotFound(account_id)
        G = self.an.G
        depth = max(1, min(int(depth), 2))
        keep, frontier = {account_id}, {account_id}
        for _ in range(depth):
            nxt = set()
            for u in frontier:
                nb = sorted(set(G.successors(u)) | set(G.predecessors(u)),
                            key=lambda v: -((G[u][v]["total"] if G.has_edge(u, v) else 0)
                                            + (G[v][u]["total"] if G.has_edge(v, u) else 0)))
                nxt.update(nb[: max(10, limit // (3 * depth))])
            keep |= nxt
            frontier = nxt
            if len(keep) >= limit:
                break
        keep = set(list(keep)[: limit]) | {account_id}
        nodes = [self._graph_node(a) for a in keep]
        edges = [{"src": u, "dst": v, "total": d["total"], "count": d["count"]}
                 for u, v, d in G.subgraph(keep).edges(data=True)]
        return {"center": account_id, "nodes": nodes, "edges": edges}

    def _graph_node(self, a: str) -> dict:
        acct, s = self.an.accounts[a], self.an.scores[a]
        return {"id": a, "label": acct["holder_name"], "type": acct["account_type"], "status": acct["status"],
                "score": s["composite"], "labels": s["labels"], "role": "account"}

    # ------------------------------------------------------------------ complaints & cases
    def _find_origin(self, victim, amount, filed_at):
        cands = [t for t in self.an.out.get(victim, []) if t["kind"] == "transfer"]
        if filed_at:
            cands = [t for t in cands if t["ts"] <= filed_at]
        if amount is not None:
            cands = [t for t in cands if abs(t["amount"] - amount) <= max(1.0, 0.01 * amount)]
        if not cands:
            raise ValueError("No matching outbound transaction found for the victim account.")
        return max(cands, key=lambda t: t["t"])

    def intake_complaint(self, victim_account, origin_txn_id=None, amount=None, filed_at=None,
                         category=None, description=None) -> dict:
        with self.lock:
            if victim_account not in self.an.accounts:
                raise ValueError(f"Unknown victim account {victim_account}")
            filed = to_dt(filed_at) if filed_at else self.as_of
            if origin_txn_id:
                origin = self.tx_by_id.get(origin_txn_id)
                if not origin or origin["src"] != victim_account or origin["kind"] != "transfer":
                    raise ValueError("origin_txn_id must be a transfer sent by the victim account.")
            else:
                origin = self._find_origin(victim_account, amount, filed)
            n = self.db.one("SELECT COUNT(*) AS n FROM complaints")["n"]
            cid = f"CMP-{n + 1:04d}"
            while self.db.one("SELECT id FROM complaints WHERE id = ?", (cid,)):
                n += 1
                cid = f"CMP-{n + 1:04d}"
            self.db.execute(
                "INSERT INTO complaints (id, victim_account, origin_txn_id, amount, filed_at, category, description, status) "
                "VALUES (?,?,?,?,?,?,?,?)",
                (cid, victim_account, origin["id"], origin["amount"], iso(filed), category,
                 description or f"Victim reports Rs {origin['amount']:,.0f} debited fraudulently.", "registered"))
            complaint = self.db.one("SELECT * FROM complaints WHERE id = ?", (cid,))
            case_id = self._create_case(complaint)
            return {"complaint_id": cid, "case_id": case_id}

    def _node_payload(self, n: dict) -> dict:
        out = {"id": n["id"], "hop": n["hop"], "role": n["role"], "inflow": round(n["inflow"], 2),
               "outflow": round(n["outflow"], 2), "withdrawn": round(n["withdrawn"], 2),
               "retained": round(n.get("retained", 0.0), 2), "first_in": n.get("first_in")}
        if n["id"] in self.an.accounts:
            acct, s = self.an.accounts[n["id"]], self.an.scores[n["id"]]
            ev = []
            if s["primary"]:
                ev = [e["text"] for e in s["typologies"][s["primary"]]["evidence"] if e["weight"] != "gate"][:4]
            out.update(holder_name=acct["holder_name"], bank=acct["bank"], account_type=acct["account_type"],
                       score=s["composite"], typologies=s["labels"], primary=s["primary"], evidence=ev)
        else:
            out.update(holder_name="Cash withdrawal (ATM/POS)", score=0.0, typologies=[], evidence=[])
        return out

    def _linked_accounts(self, traced_ids: set) -> list:
        linked = {}
        for a in traced_ids:
            acct = self.an.accounts[a]
            for key, idx, lab in (("kyc_device", self._by_device, "shared KYC device"),
                                  ("kyc_address", self._by_address, "shared KYC address")):
                for b in idx.get(acct[key], []):
                    if b not in traced_ids and b != a:
                        other = self.an.accounts[b]
                        if abs((other["created_at"] - acct["created_at"]).total_seconds()) <= 72 * 3600:
                            s = self.an.scores[b]
                            linked.setdefault(b, {"id": b, "via": f"{lab} with {a}", "score": s["composite"],
                                                  "labels": s["labels"]})
        return sorted(linked.values(), key=lambda x: -x["score"])

    def _create_case(self, complaint: dict) -> str:
        origin = self.tx_by_id[complaint["origin_txn_id"]]
        tr = trace_origin(self.an, origin)
        filed = to_dt(complaint["filed_at"])
        pr = prioritize(self.an, tr, complaint["amount"], filed, self.as_of)
        nodes = [self._node_payload(n) for n in tr["nodes"].values()]
        mule_ids = {n["id"] for n in nodes if n["role"] == "mule"}
        typ_counts = defaultdict(int)
        for n in nodes:
            if n["role"] == "mule":
                for t in n["typologies"]:
                    typ_counts[t] += 1
        analysis = {"nodes": nodes, "edges": [{k: v for k, v in e.items() if k != "t"} for e in tr["edges"]],
                    "stats": tr["stats"], "priority": pr, "linked_accounts": self._linked_accounts(mule_ids),
                    "typology_counts": dict(typ_counts)}
        n = self.db.one("SELECT COUNT(*) AS n FROM cases")["n"]
        cid = f"CASE-{n + 1:04d}"
        now = iso(self.as_of)
        self.db.execute(
            "INSERT INTO cases (id, complaint_id, status, priority_score, priority_label, assigned_to, created_at, updated_at, analysis) "
            "VALUES (?,?,?,?,?,?,?,?,?)",
            (cid, complaint["id"], "open", pr["score"], pr["label"], None, now, now, json.dumps(analysis, default=str)))
        self.db.executemany(
            "INSERT INTO case_accounts (case_id, account_id, hop, score, typologies) VALUES (?,?,?,?,?)",
            [(cid, x["id"], x["hop"], x["score"], json.dumps(x["typologies"])) for x in nodes if x["role"] == "mule"])
        self._event(cid, "created", "system", {"complaint_id": complaint["id"]})
        return cid

    def _event(self, case_id, kind, actor, payload):
        self.db.execute("INSERT INTO case_events (id, case_id, ts, kind, actor, payload) VALUES (?,?,?,?,?,?)",
                        (new_id(), case_id, iso(utcnow()), kind, actor, json.dumps(payload)))

    def list_cases(self, status=None, typology=None, label=None, q=None) -> list:
        sql = ("SELECT c.id, c.complaint_id, c.status, c.priority_score, c.priority_label, c.assigned_to, c.created_at, "
               "c.analysis, p.victim_account, p.amount, p.filed_at, p.category, p.origin_txn_id FROM cases c JOIN complaints p ON p.id = c.complaint_id")
        rows = self.db.query(sql)
        out = []
        for r in rows:
            a = json.loads(r["analysis"])
            if status and r["status"] != status:
                continue
            if label and r["priority_label"] != label:
                continue
            if typology and typology not in a["typology_counts"]:
                continue
            if q and q.lower() not in f"{r['id']} {r['complaint_id']} {r['victim_account']} {r['category']}".lower():
                continue
            origin = self.tx_by_id.get(r["origin_txn_id"])
            delay = ((to_dt(r["filed_at"]) - origin["ts"]).total_seconds() / 60.0) if origin else None
            out.append({
                "report_delay_min": round(delay, 1) if delay is not None else None,
                "money_span_minutes": a["stats"]["money_span_minutes"],
                "id": r["id"], "complaint_id": r["complaint_id"], "status": r["status"], "priority_score": r["priority_score"],
                "priority_label": r["priority_label"], "victim_account": r["victim_account"], "amount": r["amount"],
                "filed_at": iso(r["filed_at"]), "category": r["category"], "assigned_to": r["assigned_to"],
                "accounts_traced": a["stats"]["accounts_traced"], "max_hop_depth": a["stats"]["max_hop_depth"],
                "recoverable_amount": a["stats"]["recoverable_amount"], "cash_out_total": a["stats"]["cash_out_total"],
                "typology_counts": a["typology_counts"],
            })
        closed_last = {"closed": 1}
        out.sort(key=lambda c: (closed_last.get(c["status"], 0), -c["priority_score"]))
        return out

    def get_case(self, case_id: str) -> dict:
        r = self.db.one("SELECT * FROM cases WHERE id = ?", (case_id,))
        if not r:
            raise NotFound(case_id)
        analysis = json.loads(r["analysis"])
        for n in analysis["nodes"]:
            if n["id"] in self.an.accounts:
                n["status"] = self.an.accounts[n["id"]]["status"]
        comp = self.db.one("SELECT * FROM complaints WHERE id = ?", (r["complaint_id"],))
        comp["filed_at"] = iso(comp["filed_at"])
        events = self.db.query("SELECT * FROM case_events WHERE case_id = ? ORDER BY ts, id", (case_id,))
        frozen = 0.0
        for e in events:
            e["payload"] = json.loads(e["payload"])
            e["ts"] = iso(e["ts"]) + "Z"   # events are recorded in real UTC; synthetic data times stay naive
            if e["kind"] == "freeze":
                frozen += e["payload"].get("amount_frozen", 0.0)
        origin = self.tx_by_id.get(comp["origin_txn_id"])
        origin_ts = iso(origin["ts"]) if origin else None
        delay = ((to_dt(comp["filed_at"]) - origin["ts"]).total_seconds() / 60.0) if origin else None
        return {"id": r["id"], "status": r["status"], "priority_score": r["priority_score"],
                "origin_ts": origin_ts, "report_delay_min": round(delay, 1) if delay is not None else None,
                "priority_label": r["priority_label"], "assigned_to": r["assigned_to"],
                "created_at": iso(r["created_at"]), "updated_at": iso(r["updated_at"]),
                "complaint": comp, "analysis": analysis, "linked_accounts": analysis.get("linked_accounts", []),
                "events": events, "frozen_amount": round(frozen, 2)}

    def update_case(self, case_id, status=None, assigned_to=None, actor="investigator") -> dict:
        with self.lock:
            case = self.get_case(case_id)
            if status is not None:
                if status not in CASE_STATUSES:
                    raise ValueError(f"status must be one of {CASE_STATUSES}")
                if status != case["status"]:
                    self.db.execute("UPDATE cases SET status = ?, updated_at = ? WHERE id = ?",
                                    (status, iso(utcnow()), case_id))
                    self._event(case_id, "status", actor, {"from": case["status"], "to": status})
            if assigned_to is not None:
                self.db.execute("UPDATE cases SET assigned_to = ?, updated_at = ? WHERE id = ?",
                                (assigned_to, iso(utcnow()), case_id))
            return self.get_case(case_id)

    def add_note(self, case_id, text, actor="investigator") -> dict:
        self.get_case(case_id)
        text = (text or "").strip()
        if not text:
            raise ValueError("Note text is empty.")
        self._event(case_id, "note", actor, {"text": text})
        return self.get_case(case_id)

    def freeze_account(self, case_id, account_id, actor="investigator") -> dict:
        """Simulated freeze: marks the account frozen and records estimated funds held."""
        with self.lock:
            case = self.get_case(case_id)
            node = next((n for n in case["analysis"]["nodes"] if n["id"] == account_id and n["role"] == "mule"), None)
            if node is None:
                raise ValueError("Account is not a traced mule account in this case.")
            if self.an.accounts[account_id]["status"] == "frozen":
                raise ValueError("Account already frozen.")
            self.db.execute("UPDATE accounts SET status = 'frozen' WHERE id = ?", (account_id,))
            self.an.accounts[account_id]["status"] = "frozen"
            self._event(case_id, "freeze", actor, {"account_id": account_id, "amount_frozen": node.get("retained", 0.0)})
            if case["status"] in ("open", "investigating"):
                self.update_case(case_id, status="funds_frozen", actor=actor)
            return self.get_case(case_id)

    def report_pdf(self, case_id: str) -> bytes:
        return build_case_report(self.get_case(case_id))

    # ------------------------------------------------------------------ evaluation
    def metrics(self) -> dict:
        from .evaluation import evaluate
        with self.lock:
            if self._metrics_cache is None:
                self._metrics_cache = evaluate(self)
            return self._metrics_cache
