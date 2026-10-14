"""Core pipeline tests (stdlib unittest; also runnable with pytest)."""
import os
import tempfile
import unittest
from datetime import datetime, timedelta

from app import config
from app.db import Database
from app.detection import (analyze, creation_clusters, find_cycles, pass_through, ramp, split_burst, epoch)
from app.generator import GeneratorConfig, generate
from app.service import FraudGraphService, NotFound
from app.trace import WEIGHTS, prioritize, trace_origin
from app.typology import TYPOLOGIES, matrix
from app.detection import FORMULAS

SMALL = GeneratorConfig(seed=7, n_individuals=450, n_merchants=12, n_payroll=3, days=50)


def tx(i, src, dst, amount, minutes, kind="transfer", base=datetime(2026, 9, 1)):
    ts = base + timedelta(minutes=minutes)
    return {"id": f"T{i}", "src": src, "dst": dst, "amount": amount, "ts": ts, "t": epoch(ts),
            "channel": "UPI", "kind": kind}


class TestGenerator(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ds = generate(SMALL)

    def test_deterministic(self):
        again = generate(SMALL)
        self.assertEqual(len(again.transactions), len(self.ds.transactions))
        self.assertEqual([t["amount"] for t in again.transactions[:50]], [t["amount"] for t in self.ds.transactions[:50]])

    def test_integrity(self):
        ids = {a["id"] for a in self.ds.accounts}
        for t in self.ds.transactions:
            self.assertIn(t["src"], ids)
            self.assertTrue(t["dst"] is None or t["dst"] in ids)
            self.assertLess(t["ts"], self.ds.end)
            self.assertEqual(t["dst"] is None, t["kind"] == "withdrawal")
        self.assertTrue(self.ds.complaints and self.ds.ground_truth)

    def test_every_complaint_origin_exists(self):
        by_id = {t["id"]: t for t in self.ds.transactions}
        for c in self.ds.complaints:
            self.assertEqual(by_id[c["origin_txn_id"]]["src"], c["victim_account"])


class TestMatrix(unittest.TestCase):
    def test_matrix(self):
        self.assertEqual(len(TYPOLOGIES), 7)
        self.assertEqual(len({t.tid for t in TYPOLOGIES}), 7)
        for t in TYPOLOGIES:
            self.assertIn(t.code, FORMULAS)
        self.assertEqual(len(matrix()), 7)


class TestSignals(unittest.TestCase):
    def test_ramp(self):
        self.assertEqual(ramp(0, 1, 2), 0.0)
        self.assertEqual(ramp(3, 1, 2), 1.0)
        self.assertAlmostEqual(ramp(1.5, 1, 2), 0.5)

    def test_pass_through_fifo(self):
        ins = [tx(1, "A", "M", 10_000, 0)]
        fwd = [tx(2, "M", "B", 4_000, 10), tx(3, "M", "C", 5_000, 20)]
        ratio, med, per = pass_through(ins, fwd)
        self.assertAlmostEqual(ratio, 0.9)
        self.assertGreater(med, 0)
        self.assertAlmostEqual(per[0][1], 0.9)
        late = [tx(4, "M", "B", 10_000, 60 * 24)]
        self.assertEqual(pass_through(ins, late)[0], 0.0)

    def test_split_burst_flags_equal_amounts_not_varied(self):
        eq = [tx(i, "H", f"D{i}", 9_800 + i, i) for i in range(12)]
        varied = [tx(i, "P", f"D{i}", 5_000 + i * 4_000, i) for i in range(12)]
        self.assertGreater(split_burst(eq)["score"], 0.9)
        self.assertLess(split_burst(varied)["score"], 0.5)

    def test_cycle_detection_requires_time_order_and_value(self):
        loop = [tx(1, "A", "B", 50_000, 0), tx(2, "B", "C", 48_000, 30), tx(3, "C", "A", 46_000, 60)]
        self.assertEqual(len(find_cycles(loop)), 1)
        wrong_order = [tx(1, "A", "B", 50_000, 120), tx(2, "B", "C", 48_000, 30), tx(3, "C", "A", 46_000, 0)]
        self.assertEqual(find_cycles(wrong_order), [])
        value_drop = [tx(1, "A", "B", 50_000, 0), tx(2, "B", "C", 10_000, 30), tx(3, "C", "A", 9_000, 60)]
        self.assertEqual(find_cycles(value_drop), [])

    def test_clusters_need_shared_kyc_and_tight_window(self):
        base = datetime(2026, 1, 1)
        mk = lambda i, dev, d: {"id": f"A{i}", "created_at": base + timedelta(hours=d), "kyc_device": dev, "kyc_address": f"adr{i}"}
        accts = {a["id"]: a for a in [mk(1, "D", 0), mk(2, "D", 10), mk(3, "D", 20), mk(4, "D", 2000), mk(5, "Z", 5)]}
        cl = creation_clusters(accts)
        self.assertEqual(set(cl), {"A1", "A2", "A3"})


class TestDetectionAndTrace(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ds = generate(SMALL)
        cls.accts = {a["id"]: a for a in cls.ds.accounts}
        cls.an = analyze(cls.accts, cls.ds.transactions)
        cls.truth = set(cls.ds.ground_truth)

    def test_detection_precision_recall(self):
        flagged = self.an.flagged()
        tp = len(flagged & self.truth)
        self.assertGreaterEqual(tp / len(self.truth), 0.9, "recall")
        self.assertGreaterEqual(tp / max(1, len(flagged)), 0.9, "precision")

    def test_no_false_positives_on_hubs(self):
        flagged = self.an.flagged()
        for a, x in self.accts.items():
            if x["account_type"] in ("merchant", "payroll", "corporate"):
                self.assertNotIn(a, flagged, x["account_type"])

    def test_scores_are_explainable(self):
        a = next(iter(self.truth & self.an.flagged()))
        s = self.an.scores[a]
        self.assertTrue(s["labels"])
        ev = s["typologies"][s["primary"]]["evidence"]
        self.assertTrue(ev and all("text" in e for e in ev))

    def test_trace_quality(self):
        tx_by = {t["id"]: t for t in self.ds.transactions}
        for c in self.ds.complaints:
            tr = trace_origin(self.an, tx_by[c["origin_txn_id"]])
            mules = {i for i, n in tr["nodes"].items() if n["role"] == "mule"}
            self.assertTrue(mules)
            self.assertGreaterEqual(len(mules & self.truth) / len(mules), 0.95, c["id"])
            self.assertGreaterEqual(tr["stats"]["max_hop_depth"], 1)
            for i in mules:
                self.assertNotEqual(self.accts[i]["account_type"], "merchant")

    def test_prioritization_monotonic(self):
        tx_by = {t["id"]: t for t in self.ds.transactions}
        c = self.ds.complaints[0]
        tr = trace_origin(self.an, tx_by[c["origin_txn_id"]])
        now = c["filed_at"]
        hi = prioritize(self.an, tr, 900_000, now, now)["score"]
        lo = prioritize(self.an, tr, 20_000, now, now)["score"]
        stale = prioritize(self.an, tr, 900_000, now, now + timedelta(days=10))["score"]
        self.assertGreater(hi, lo)
        self.assertGreater(hi, stale)
        self.assertAlmostEqual(sum(WEIGHTS.values()), 1.0)


class TestService(unittest.TestCase):
    @staticmethod
    def fresh():
        svc = FraudGraphService(Database(f"sqlite:///{os.path.join(tempfile.mkdtemp(), 't.db')}"))
        return svc, svc.seed(SMALL)

    @classmethod
    def setUpClass(cls):
        # read-only tests share this instance; mutating tests build their own via fresh()
        cls.svc, cls.summary = cls.fresh()

    def test_seed_creates_cases_ranked(self):
        cases = self.svc.list_cases()
        self.assertEqual(len(cases), self.summary["complaints"])
        scores = [c["priority_score"] for c in cases]
        self.assertEqual(scores, sorted(scores, reverse=True))

    def test_filters(self):
        some = self.svc.list_cases()[0]
        t = next(iter(some["typology_counts"]))
        self.assertTrue(all(t in c["typology_counts"] for c in self.svc.list_cases(typology=t)))
        self.assertEqual(self.svc.list_cases(status="closed"), [])

    def test_case_workflow(self):
        svc, _ = self.fresh()
        case = svc.get_case(svc.list_cases()[0]["id"])
        cid = case["id"]
        mule = next(n for n in case["analysis"]["nodes"] if n["role"] == "mule")
        svc.add_note(cid, "Called bank nodal officer.")
        after = svc.freeze_account(cid, mule["id"])
        self.assertEqual(after["status"], "funds_frozen")
        self.assertAlmostEqual(after["frozen_amount"], mule["retained"], places=1)
        with self.assertRaises(ValueError):
            svc.freeze_account(cid, mule["id"])
        with self.assertRaises(ValueError):
            svc.freeze_account(cid, case["complaint"]["victim_account"])
        svc.update_case(cid, status="closed")
        kinds = [e["kind"] for e in svc.get_case(cid)["events"]]
        for k in ("created", "note", "freeze", "status"):
            self.assertIn(k, kinds)
        with self.assertRaises(ValueError):
            svc.update_case(cid, status="bogus")
        with self.assertRaises(NotFound):
            svc.get_case("CASE-9999")

    def test_intake_by_amount(self):
        svc, _ = self.fresh()
        c = svc.db.query("SELECT * FROM complaints")[0]
        r = svc.intake_complaint(c["victim_account"], amount=c["amount"])
        self.assertTrue(r["case_id"].startswith("CASE-"))
        self.assertEqual(len(svc.list_cases()), len(svc.db.query("SELECT id FROM complaints")))
        with self.assertRaises(ValueError):
            svc.intake_complaint("ACC00000000", amount=100)
        with self.assertRaises(ValueError):
            svc.intake_complaint(c["victim_account"], amount=1.23)

    def test_report_pdf(self):
        pdf = self.svc.report_pdf(self.svc.list_cases()[0]["id"])
        self.assertTrue(pdf.startswith(b"%PDF"))
        self.assertGreater(len(pdf), 3000)

    def test_alerts_and_account(self):
        al = self.svc.alerts(limit=5)
        self.assertEqual(len(al["items"]), 5)
        acc = self.svc.account(al["items"][0]["account_id"])
        self.assertIn("score", acc)
        nb = self.svc.neighborhood(al["items"][0]["account_id"])
        self.assertTrue(nb["nodes"] and nb["edges"])

    def test_metrics(self):
        m = self.svc.metrics()
        self.assertTrue(m["available"])
        self.assertGreaterEqual(m["detection"]["recall"], 0.9)
        self.assertLessEqual(m["false_positive_rate"]["merchants"]["rate"], 0.05)
        self.assertGreaterEqual(m["trace"]["mean_precision"], 0.95)


@unittest.skipUnless(__import__("importlib").util.find_spec("fastapi") and __import__("importlib").util.find_spec("httpx"),
                     "fastapi/httpx not installed")
class TestAPI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from fastapi.testclient import TestClient
        from app.main import create_app
        cls.tmp = tempfile.mkdtemp()
        app = create_app(f"sqlite:///{os.path.join(cls.tmp, 'api.db')}", auto_seed=False)
        app.state.service.seed(SMALL)
        cls.client = TestClient(app)

    def test_endpoints(self):
        c = self.client
        self.assertEqual(c.get("/api/health").json()["status"], "ok")
        self.assertEqual(len(c.get("/api/typologies").json()), 7)
        cases = c.get("/api/cases").json()
        cid = cases[0]["id"]
        detail = c.get(f"/api/cases/{cid}").json()
        self.assertIn("analysis", detail)
        self.assertEqual(c.post(f"/api/cases/{cid}/notes", json={"text": "hello"}).status_code, 201)
        mule = next(n for n in detail["analysis"]["nodes"] if n["role"] == "mule")["id"]
        self.assertEqual(c.post(f"/api/cases/{cid}/freeze", json={"account_id": mule}).status_code, 200)
        self.assertEqual(c.post(f"/api/cases/{cid}/freeze", json={"account_id": mule}).status_code, 422)
        r = c.get(f"/api/cases/{cid}/report.pdf")
        self.assertEqual(r.headers["content-type"], "application/pdf")
        self.assertEqual(c.get("/api/cases/NOPE").status_code, 404)
        self.assertGreater(len(c.get("/api/alerts?limit=3").json()["items"]), 0)
        self.assertTrue(c.get("/api/metrics").json()["available"])


if __name__ == "__main__":
    unittest.main()
