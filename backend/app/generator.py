"""Synthetic UPI / IMPS / NEFT transaction generator with injectable fraud-ring templates.

Legitimate traffic: P2P between social contacts, merchant purchases, ATM cash,
salary cycles (corporate -> payroll account -> employees), rent, repayments,
merchant settlements and collections. Includes deliberate *hard negatives*
(payroll fan-out, merchants, loan-deposit pass-through, legitimate dormant
reactivation, households sharing an address) so false-positive rates mean something.

Fraud rings (ground truth kept separately, never visible to the detector):
  layering    victim -> Tier-1 -> Tier-2 split -> Tier-3 -> ATM/POS cash-out
  smurfing    victim -> hub -> 10-20 near-equal sub-threshold transfers -> collectors
  circular    victim -> m1 -> m2 -> m3 -> m1 (x2 rounds) -> exit account -> cash-out
  dormant     victim -> long-dormant account -> single burst -> mule -> cash-out
  recruitment cluster of accounts opened together (shared device/address) used by several victims
"""
from __future__ import annotations

import hashlib
import math
import random
from dataclasses import dataclass, field
from datetime import datetime, timedelta

try:  # optional: richer synthetic identities
    from faker import Faker
except Exception:  # pragma: no cover
    Faker = None

FIRST = ["Aarav", "Vivaan", "Aditya", "Rohan", "Karthik", "Arjun", "Imran", "Sanjay", "Manoj", "Deepak",
         "Priya", "Ananya", "Kavya", "Sneha", "Pooja", "Neha", "Farah", "Meera", "Lakshmi", "Ritu",
         "Harpreet", "Gurpreet", "Sandeep", "Vikram", "Suresh", "Ramesh", "Anjali", "Divya", "Isha", "Tanvi"]
LAST = ["Sharma", "Verma", "Iyer", "Nair", "Reddy", "Patel", "Khan", "Singh", "Das", "Chatterjee",
        "Gupta", "Mehta", "Joshi", "Kulkarni", "Banerjee", "Pillai", "Yadav", "Chauhan", "Mishra", "Rao"]
BANKS = ["Bharat National Bank", "Indus Commercial Bank", "Vindhya Bank", "Kaveri Bank",
         "Himalaya Bank", "Malwa Co-operative Bank", "Deccan Bank", "Konkan Small Finance Bank"]
SCAMS = ["KYC-update vishing call", "Fake investment app", "OTP phishing link", "Digital-arrest impersonation",
         "Fake customer-care refund", "Part-time task scam", "Electricity-bill disconnection scam"]
MERCHANT_WORDS = ["Kirana", "Chai Point", "Medico", "Electronics", "Fashion Hub", "Sweets", "Fuel Station",
                  "Mobile Recharge", "Supermart", "Bakery", "Hardware", "Books"]


@dataclass
class GeneratorConfig:
    seed: int = 42
    n_individuals: int = 1200
    n_merchants: int = 30
    n_payroll: int = 5
    days: int = 60
    start: datetime = datetime(2026, 8, 15)
    layering_rings: int = 4
    smurfing_rings: int = 3
    circular_rings: int = 3
    dormant_rings: int = 3
    recruitment_rings: int = 2
    legit_dormant_reactivations: int = 6
    loan_deposit_negatives: int = 3
    households: int = 12


@dataclass
class Dataset:
    config: GeneratorConfig
    accounts: list
    transactions: list
    complaints: list
    ground_truth: dict      # account_id -> {ring_id, ring_type, role, typologies}
    rings: list

    @property
    def end(self) -> datetime:
        return self.config.start + timedelta(days=self.config.days)


def _poisson(rng: random.Random, lam: float) -> int:
    if lam <= 0:
        return 0
    L, k, p = math.exp(-lam), 0, 1.0
    while True:
        p *= rng.random()
        if p <= L:
            return k
        k += 1


class Generator:
    def __init__(self, cfg: GeneratorConfig):
        self.cfg = cfg
        self.rng = random.Random(cfg.seed)
        self.accounts: dict[str, dict] = {}
        self.txns: list[dict] = []
        self.complaints: list[dict] = []
        self.truth: dict[str, dict] = {}
        self.rings: list[dict] = []
        self._used_victims: set[str] = set()
        self.fake = None
        if Faker is not None:
            try:
                self.fake = Faker("en_IN")
                Faker.seed(cfg.seed)
            except Exception:  # pragma: no cover
                self.fake = None
        self.start = cfg.start
        self.end = cfg.start + timedelta(days=cfg.days)
        self.individuals: list[str] = []
        self.merchants: list[str] = []
        self.payrolls: list[str] = []
        self.contacts: dict[str, list[str]] = {}

    # ------------------------------------------------------------------ primitives
    def _new_id(self) -> str:
        while True:
            i = f"ACC{self.rng.randrange(10_000_000, 99_999_999)}"
            if i not in self.accounts:
                return i

    def _name(self) -> str:
        if self.fake is not None:
            return self.fake.name()
        return f"{self.rng.choice(FIRST)} {self.rng.choice(LAST)}"

    def _hash(self, prefix: str = "") -> str:
        return prefix + hashlib.sha1(str(self.rng.random()).encode()).hexdigest()[:10]

    def add_account(self, acct_type="individual", created=None, last_active=None, name=None,
                    bank=None, address=None, device=None) -> str:
        aid = self._new_id()
        self.accounts[aid] = {
            "id": aid,
            "holder_name": name or self._name(),
            "bank": bank or self.rng.choice(BANKS),
            "account_type": acct_type,
            "created_at": created or self.start - timedelta(days=self.rng.uniform(60, 3000)),
            "last_active_at": last_active,
            "kyc_address": address or self._hash("ADR"),
            "kyc_device": device or self._hash("DEV"),
            "status": "active",
        }
        return aid

    def txn(self, src, dst, amount, ts, channel=None, kind="transfer") -> dict:
        amount = round(float(amount), 2)
        if channel is None:
            channel = "UPI" if amount <= 100_000 else ("IMPS" if amount <= 500_000 else "NEFT")
        t = {"id": None, "src": src, "dst": dst, "amount": amount, "ts": ts, "channel": channel, "kind": kind}
        self.txns.append(t)
        return t

    def withdraw(self, acct, amount, ts):
        return self.txn(acct, None, amount, ts, channel=self.rng.choice(["ATM", "ATM", "POS"]), kind="withdrawal")

    def _tod(self, day_start: datetime) -> datetime:
        h = self.rng.triangular(7, 23.5, 18)
        return day_start + timedelta(hours=h)

    def _legit_amount(self) -> float:
        a = min(40_000, max(20, self.rng.lognormvariate(6.3, 1.0)))
        if self.rng.random() < 0.45:
            a = max(50, round(a / 50) * 50)
        else:
            a = round(a, 2)
        return a

    # ------------------------------------------------------------------ legitimate world
    def build_legit(self):
        cfg, rng = self.cfg, self.rng
        # merchants
        for _ in range(cfg.n_merchants):
            nm = f"{rng.choice(LAST)} {rng.choice(MERCHANT_WORDS)}"
            self.merchants.append(self.add_account("merchant", name=nm,
                                                   created=self.start - timedelta(days=rng.uniform(300, 3000)),
                                                   last_active=self.start - timedelta(days=rng.uniform(0, 3))))
        # corporates + payroll accounts
        corporates = []
        for i in range(cfg.n_payroll):
            corporates.append(self.add_account("corporate", name=f"{rng.choice(LAST)} Industries Pvt Ltd",
                                               created=self.start - timedelta(days=rng.uniform(1500, 4000)),
                                               last_active=self.start - timedelta(days=1)))
            self.payrolls.append(self.add_account("payroll", name=f"{rng.choice(LAST)} Industries Payroll",
                                                  created=self.start - timedelta(days=rng.uniform(1500, 4000)),
                                                  last_active=self.start - timedelta(days=1)))
        # individuals
        inactive = set()
        for i in range(cfg.n_individuals):
            if rng.random() < 0.04:  # opened inside the window
                created = self.start + timedelta(days=rng.uniform(0, cfg.days - 6))
                last = None
            elif rng.random() < 0.035:  # legit inactive account
                created = self.start - timedelta(days=rng.uniform(400, 3000))
                last = self.start - timedelta(days=rng.uniform(150, 800))
            else:
                created = self.start - timedelta(days=rng.uniform(60, 3000))
                last = self.start - timedelta(days=rng.uniform(0, 20))
            aid = self.add_account("individual", created=created, last_active=last)
            self.individuals.append(aid)
            if last is not None and (self.start - last).days >= 150:
                inactive.add(aid)
        # households: 2-3 accounts sharing an address, opened within ~2 days
        pool = [a for a in self.individuals if a not in inactive]
        rng.shuffle(pool)
        k = 0
        for _ in range(cfg.households):
            size = rng.choice([2, 2, 3])
            members = pool[k:k + size]
            k += size
            if len(members) < 2:
                break
            addr = self._hash("ADR")
            base = self.start - timedelta(days=rng.uniform(100, 2500))
            for m in members:
                self.accounts[m]["kyc_address"] = addr
                self.accounts[m]["created_at"] = base + timedelta(days=rng.uniform(0, 2))
        active = [a for a in self.individuals if a not in inactive]
        # contact graph
        for a in active:
            others = rng.sample(active, min(len(active) - 1, rng.randint(3, 8)))
            self.contacts[a] = [o for o in others if o != a][:8]
        merchant_w = [1.0 / (i + 1) ** 0.7 for i in range(len(self.merchants))]
        favs = {a: list({rng.choices(self.merchants, merchant_w)[0] for _ in range(rng.randint(3, 7))}) for a in active}
        # day-by-day everyday traffic
        lam = {a: min(1.5, rng.lognormvariate(math.log(0.28), 0.6)) for a in active}
        for d in range(cfg.days):
            day = self.start + timedelta(days=d)
            for a in active:
                if self.accounts[a]["created_at"] > day + timedelta(days=1):
                    continue
                for _ in range(_poisson(rng, lam[a])):
                    ts = self._tod(day)
                    r = rng.random()
                    if r < 0.55 and self.contacts[a]:
                        self.txn(a, rng.choice(self.contacts[a]), self._legit_amount(), ts)
                    elif r < 0.88:
                        self.txn(a, rng.choice(favs[a]), self._legit_amount(), ts)
                    else:
                        self.withdraw(a, max(500, round(self._legit_amount() / 500) * 500), ts)
        # salary cycles
        employed = [a for a in active if rng.random() < 0.45]
        by_emp: dict[str, list] = {p: [] for p in self.payrolls}
        for a in employed:
            by_emp[rng.choice(self.payrolls)].append(a)
        salary = {a: int(min(120_000, max(15_000, rng.lognormvariate(10.3, 0.5))) // 100 * 100) for a in employed}
        month_starts = []
        m = datetime(self.start.year, self.start.month, 1)
        while m < self.end:
            nxt = (m.replace(day=28) + timedelta(days=4)).replace(day=1)
            if m >= self.start:
                month_starts.append(m)
            m = nxt
        for ms in month_starts:
            for corp, pay in zip(corporates, self.payrolls):
                staff = by_emp[pay]
                if not staff:
                    continue
                total = sum(salary[s] for s in staff)
                t_fund = ms + timedelta(hours=rng.uniform(6, 9))
                self.txn(corp, pay, total, t_fund, channel="NEFT")
                for s in staff:
                    ts = ms + timedelta(hours=rng.uniform(10, 40))
                    if ts < self.end:
                        self.txn(pay, s, salary[s], ts, channel="IMPS" if salary[s] > 100_000 else "UPI")
        # rent, one-off big transfers, repayments, collections
        for a in active:
            if rng.random() < 0.15:
                landlord = rng.choice(self.contacts[a])
                amt = round(rng.uniform(8_000, 35_000) / 500) * 500
                for ms in month_starts:
                    ts = ms + timedelta(days=rng.uniform(3, 7), hours=rng.uniform(8, 20))
                    if ts < self.end:
                        self.txn(a, landlord, amt, ts)
            if rng.random() < 0.012:
                ts = self.start + timedelta(days=rng.uniform(2, cfg.days - 2))
                self.txn(a, rng.choice(self.contacts[a]), round(rng.uniform(50_000, 250_000) / 1000) * 1000, ts)
            if rng.random() < 0.03:
                b = rng.choice(self.contacts[a])
                amt = round(rng.uniform(2_000, 20_000) / 500) * 500
                t0 = self.start + timedelta(days=rng.uniform(1, cfg.days - 20))
                self.txn(a, b, amt, t0)
                self.txn(b, a, amt, t0 + timedelta(days=rng.uniform(3, 15), hours=rng.uniform(0, 6)))
        for _ in range(8):  # festival / society collections (high in-degree, equal amounts)
            collector = rng.choice(active)
            share = rng.choice([500, 1000, 1500, 2000])
            day = self.start + timedelta(days=rng.uniform(1, cfg.days - 1))
            for c in rng.sample(active, rng.randint(6, 15)):
                if c != collector:
                    self.txn(c, collector, share, day + timedelta(hours=rng.uniform(0, 30)))
        # merchant settlements to owner + supplier payments
        for mer in self.merchants:
            owner = rng.choice(active)
            incoming = {}
            for t in self.txns:
                if t["dst"] == mer:
                    wk = int((t["ts"] - self.start).days // 7)
                    incoming[wk] = incoming.get(wk, 0) + t["amount"]
            for wk, tot in incoming.items():
                ts = self.start + timedelta(days=(wk + 1) * 7, hours=rng.uniform(9, 12))
                if ts < self.end and tot > 1000:
                    self.txn(mer, owner, tot * rng.uniform(0.85, 0.95), ts, channel="IMPS")
            if rng.random() < 0.5:
                other = rng.choice(self.merchants)
                if other != mer:
                    self.txn(mer, other, rng.uniform(20_000, 150_000),
                             self.start + timedelta(days=rng.uniform(5, cfg.days - 2)), channel="IMPS")
        # legitimate dormant reactivation (hard negative)
        dormant_pool = [a for a in inactive][: cfg.legit_dormant_reactivations]
        for j, a in enumerate(dormant_pool):
            src = rng.choice(active)
            ts = self.start + timedelta(days=rng.uniform(5, cfg.days - 5))
            if j < max(1, len(dormant_pool) - 2):
                self.txn(src, a, rng.uniform(1_000, 8_000), ts)          # small gift / refund
                if rng.random() < 0.5:
                    self.withdraw(a, 2000, ts + timedelta(days=rng.uniform(1, 5)))
            else:
                self.txn(src, a, rng.uniform(80_000, 180_000), ts)       # property-sale proceeds, held
                self.txn(a, rng.choice(self.merchants), rng.uniform(2_000, 9_000), ts + timedelta(days=3))
        # loan disbursement then deposit to a vendor within hours (hard negative)
        for _ in range(self.cfg.loan_deposit_negatives):
            a = rng.choice(active)
            lender = rng.choice(corporates)
            ts = self.start + timedelta(days=rng.uniform(8, cfg.days - 6), hours=rng.uniform(1, 10))
            amt = rng.randint(150_000, 400_000)
            self.txn(lender, a, amt, ts, channel="NEFT")
            self.txn(a, rng.choice(active), amt * rng.uniform(0.93, 0.99), ts + timedelta(hours=rng.uniform(1, 4)), channel="NEFT")
        return self

    # ------------------------------------------------------------------ fraud helpers
    def _victim(self) -> str:
        cands = [a for a in self.individuals
                 if a not in self._used_victims and self.accounts[a]["created_at"] < self.start
                 and self.accounts[a].get("last_active_at") and (self.start - self.accounts[a]["last_active_at"]).days < 60]
        v = self.rng.choice(cands)
        self._used_victims.add(v)
        return v

    def _mule(self, t0, device=None, address=None, age_days=None) -> str:
        age = age_days if age_days is not None else self.rng.uniform(2, 40)
        created = t0 - timedelta(days=age)
        mid = self.add_account("individual", created=created, last_active=None, device=device, address=address)
        # light camouflage: a few small everyday txns before the incident
        lo = max(created, self.start)
        if t0 > lo + timedelta(hours=6):
            for _ in range(self.rng.randint(0, 4)):
                ts = lo + (t0 - lo) * self.rng.random()
                other = self.rng.choice(self.individuals)
                amt = self.rng.uniform(100, 2000)
                if self.rng.random() < 0.5:
                    self.txn(other, mid, amt, ts)
                else:
                    self.txn(mid, other, amt, ts)
        return mid

    def _t0(self, lo_days=14, hi_days=2.5):
        d = self.rng.uniform(self.cfg.days - lo_days, self.cfg.days - hi_days)
        return self.start + timedelta(days=d)

    def _cashout(self, acct, arrival, amount, label_keep=None):
        """ATM/POS chunk withdrawals of ~all funds within a few hours."""
        rng = self.rng
        left = amount
        t = arrival + timedelta(minutes=rng.uniform(10, 60))
        total_wd = 0.0
        while left > 6_000:
            chunk = min(left - rng.uniform(0, 4_000), rng.uniform(25_000, 40_000))
            chunk = max(500, round(chunk / 500) * 500)
            self.withdraw(acct, chunk, t)
            left -= chunk
            total_wd += chunk
            t += timedelta(minutes=rng.uniform(8, 40))
        return total_wd

    def _complaint(self, victim, origin_txn, t_fraud, ring_id):
        filed = t_fraud + timedelta(hours=self.rng.uniform(1.5, 40))
        self.complaints.append({
            "victim": victim, "origin": origin_txn, "filed_at": filed, "ring_id": ring_id,
            "category": self.rng.choice(SCAMS),
        })

    def _register(self, ring_id, rtype, members: dict):
        for acct, (role, typs) in members.items():
            self.truth[acct] = {"ring_id": ring_id, "ring_type": rtype, "role": role, "typologies": typs}
        self.rings.append({"ring_id": ring_id, "type": rtype, "accounts": sorted(members)})

    def _amount0(self, lo=25_000, med=90_000, hi=600_000):
        return int(min(hi, max(lo, self.rng.lognormvariate(math.log(med), 0.55))))

    # ------------------------------------------------------------------ ring templates
    def ring_layering(self, idx):
        rng = self.rng
        rid = f"RING-LAY-{idx + 1}"
        t0 = self._t0()
        victim = self._victim()
        a0 = self._amount0()
        m1 = self._mule(t0)
        origin = self.txn(victim, m1, a0, t0)
        members = {m1: ("tier1_mule", ["L1"])}
        k2 = rng.choice([2, 3])
        retain = rng.uniform(0, 0.03)
        parts = [rng.uniform(0.5, 1.5) for _ in range(k2)]
        s = sum(parts)
        t2s = [self._mule(t0) for _ in range(k2)]
        t3_count = 2 if k2 == 3 else k2
        t3s = [self._mule(t0) for _ in range(t3_count)]
        t_arr1 = t0 + timedelta(minutes=rng.uniform(1, 3))
        t_split = t_arr1 + timedelta(minutes=rng.uniform(3, 25))
        inflow3 = {t: 0.0 for t in t3s}
        last_arr3 = {t: t_split for t in t3s}
        for i, t2 in enumerate(t2s):
            amt = a0 * (1 - retain) * parts[i] / s
            ts = t_split + timedelta(minutes=rng.uniform(0, 4))
            self.txn(m1, t2, amt, ts)
            members[t2] = ("tier2_mule", ["L23"])
            t3 = t3s[i if k2 == 2 else (0 if i < 2 else 1)]
            fts = ts + timedelta(minutes=rng.uniform(5, 40))
            famt = amt * rng.uniform(0.96, 0.985)
            self.txn(t2, t3, famt, fts)
            inflow3[t3] += famt
            last_arr3[t3] = max(last_arr3[t3], fts)
        for t3 in t3s:
            members[t3] = ("tier3_cashout", ["CASHOUT", "L23"])
            self._cashout(t3, last_arr3[t3], inflow3[t3])
        self._complaint(victim, origin, t0, rid)
        self._register(rid, "layering", members)

    def ring_smurfing(self, idx):
        rng = self.rng
        rid = f"RING-SMU-{idx + 1}"
        t0 = self._t0()
        victim = self._victim()
        thr = rng.choice([10_000, 25_000, 50_000])
        base = thr * rng.uniform(0.95, 0.99)
        n = rng.randint(10, 20)
        amounts = [int(base * rng.uniform(0.985, 1.015)) for _ in range(n)]
        a0 = int(sum(amounts) * rng.uniform(1.0, 1.01))
        hub = self._mule(t0)
        origin = self.txn(victim, hub, a0, t0)
        members = {hub: ("smurf_hub", ["SMURF", "L1"])}
        collectors = [self._mule(t0) for _ in range(2)]
        coll_in = {c: 0.0 for c in collectors}
        coll_last = {c: t0 for c in collectors}
        t = t0 + timedelta(minutes=rng.uniform(4, 20))
        for amt in amounts:
            sm = self._mule(t0)
            members[sm] = ("smurf_mule", ["L23"])
            self.txn(hub, sm, amt, t)
            t += timedelta(minutes=rng.uniform(0.3, 3))
            fts = t + timedelta(minutes=rng.uniform(20, 110))
            c = rng.choice(collectors)
            famt = amt * rng.uniform(0.96, 0.98)
            self.txn(sm, c, famt, fts)
            coll_in[c] += famt
            coll_last[c] = max(coll_last[c], fts)
        for c in collectors:
            members[c] = ("collector", ["CASHOUT", "L23"])
            self._cashout(c, coll_last[c], coll_in[c])
        self._complaint(victim, origin, t0, rid)
        self._register(rid, "smurfing", members)

    def ring_circular(self, idx):
        rng = self.rng
        rid = f"RING-CIR-{idx + 1}"
        t0 = self._t0()
        victim = self._victim()
        a0 = self._amount0(lo=40_000, med=120_000)
        L = rng.choice([3, 4])
        seq = [self._mule(t0) for _ in range(L)]
        exit_acct = self._mule(t0)
        origin = self.txn(victim, seq[0], a0, t0)
        members = {seq[0]: ("loop_entry", ["L1", "CIRCULAR"])}
        for m in seq[1:]:
            members[m] = ("loop_member", ["CIRCULAR", "L23"])
        members[exit_acct] = ("exit_cashout", ["CASHOUT", "L23"])
        amount, t = a0, t0 + timedelta(minutes=rng.uniform(2, 15))
        for _r in range(2):
            for i in range(L):
                amount *= rng.uniform(0.965, 0.985)
                self.txn(seq[i], seq[(i + 1) % L], amount, t)
                t += timedelta(minutes=rng.uniform(10, 60))
        amount *= 0.97
        self.txn(seq[0], exit_acct, amount, t)
        self._cashout(exit_acct, t, amount)
        self._complaint(victim, origin, t0, rid)
        self._register(rid, "circular", members)

    def ring_dormant(self, idx):
        rng = self.rng
        rid = f"RING-DOR-{idx + 1}"
        t0 = self._t0()
        victim = self._victim()
        a0 = self._amount0(lo=80_000, med=180_000, hi=450_000)
        d = self.add_account("individual",
                             created=self.start - timedelta(days=rng.uniform(730, 1800)),
                             last_active=self.start - timedelta(days=rng.uniform(250, 900)))
        origin = self.txn(victim, d, a0, t0)
        t1 = t0 + timedelta(minutes=rng.uniform(10, 70))
        if rng.random() < 0.5:
            m2 = self._mule(t0)
            amt = a0 * rng.uniform(0.95, 0.98)
            self.txn(d, m2, amt, t1, channel="IMPS")
            members = {d: ("dormant_account", ["DORMANT", "L1"]), m2: ("cashout_mule", ["CASHOUT", "L23"])}
            self._cashout(m2, t1, amt)
        else:
            members = {d: ("dormant_cashout", ["DORMANT", "CASHOUT", "L1"])}
            self._cashout(d, t0 + timedelta(minutes=rng.uniform(5, 30)), a0)
        self._complaint(victim, origin, t0, rid)
        self._register(rid, "dormant", members)

    def ring_recruitment(self, idx):
        rng = self.rng
        rid = f"RING-REC-{idx + 1}"
        t0 = self._t0(lo_days=14, hi_days=8)
        size = rng.randint(6, 9)
        base = t0 - timedelta(days=rng.uniform(10, 25))
        devices = [self._hash("DEV") for _ in range(2)]
        address = self._hash("ADR")
        accts = []
        for _ in range(size):
            created = base + timedelta(hours=rng.uniform(0, 40))
            aid = self.add_account("individual", created=created, last_active=None,
                                   device=rng.choice(devices), address=address)
            accts.append(aid)
        collector = accts[0]
        members = {a: ("idle_cluster_member", ["MULE_CLUSTER"]) for a in accts}
        members[collector] = ("cluster_collector", ["MULE_CLUSTER", "CASHOUT", "L23"])
        used = rng.sample(accts[1:], rng.randint(2, 3))
        coll_in, coll_last = 0.0, t0
        for u in used:
            victim = self._victim()
            ti = t0 + timedelta(days=rng.uniform(0, 5), hours=rng.uniform(0, 10))
            amt = rng.randint(30_000, 90_000)
            origin = self.txn(victim, u, amt, ti)
            fts = ti + timedelta(minutes=rng.uniform(3, 40))
            famt = amt * rng.uniform(0.95, 0.98)
            self.txn(u, collector, famt, fts)
            coll_in += famt
            coll_last = max(coll_last, fts)
            members[u] = ("cluster_tier1", ["MULE_CLUSTER", "L1"])
            self._complaint(victim, origin, ti, rid)
        self._cashout(collector, coll_last, coll_in)
        self._register(rid, "recruitment", members)

    # ------------------------------------------------------------------ build
    def build(self) -> Dataset:
        self.build_legit()
        for i in range(self.cfg.layering_rings):
            self.ring_layering(i)
        for i in range(self.cfg.smurfing_rings):
            self.ring_smurfing(i)
        for i in range(self.cfg.circular_rings):
            self.ring_circular(i)
        for i in range(self.cfg.dormant_rings):
            self.ring_dormant(i)
        for i in range(self.cfg.recruitment_rings):
            self.ring_recruitment(i)
        # finalise: drop out-of-window txns, order, assign opaque sequential ids
        for t in self.txns:
            t["ts"] = t["ts"].replace(microsecond=0)
        for c in self.complaints:
            c["filed_at"] = c["filed_at"].replace(microsecond=0)
        for a in self.accounts.values():
            a["created_at"] = a["created_at"].replace(microsecond=0)
            if a["last_active_at"]:
                a["last_active_at"] = a["last_active_at"].replace(microsecond=0)
        txns = [t for t in self.txns if t["ts"] < self.end]
        txns.sort(key=lambda t: (t["ts"], t["src"]))
        for i, t in enumerate(txns):
            t["id"] = f"TXN{i + 1:09d}"
        complaints = []
        keep = {id(t) for t in txns}
        for i, c in enumerate(sorted(self.complaints, key=lambda c: c["filed_at"])):
            if id(c["origin"]) not in keep:
                continue
            complaints.append({
                "id": f"CMP-{i + 1:04d}", "victim_account": c["victim"], "origin_txn_id": c["origin"]["id"],
                "amount": c["origin"]["amount"], "filed_at": c["filed_at"], "category": c["category"],
                "description": f"Victim reports Rs {c['origin']['amount']:,.0f} debited after a {c['category'].lower()}.",
                "ring_id": c["ring_id"],
            })
        return Dataset(self.cfg, list(self.accounts.values()), txns, complaints, self.truth, self.rings)


def generate(cfg: GeneratorConfig | None = None) -> Dataset:
    return Generator(cfg or GeneratorConfig()).build()
