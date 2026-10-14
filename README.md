# FraudGraph

**Mule account network detection and investigation platform** — simulates how a cyber-crime cell's financial fraud unit traces stolen UPI / bank-transfer money through layered mule accounts after a complaint.

Synthetic transaction graph (legitimate traffic + injected fraud rings) → graph-based detection → classification against an original typology matrix (**FG-Matrix**) → SOC-style investigation dashboard with case triage, simulated account freezes and PDF reports.

> All data is synthetic. Nothing here touches real accounts or real banking systems.

## Quick start

```bash
# Backend (SQLite, zero setup)
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m pytest tests -q                 # 22 tests (API tests need fastapi+httpx)
python -m scripts.evaluate                # precision / recall / FP rate / trace metrics
uvicorn app.main:create_app --factory --reload   # http://localhost:8000/docs  (auto-seeds on first start)

# Frontend
cd ../frontend
npm install
npm run dev                               # http://localhost:5173 (proxies /api -> :8000)

# Everything with PostgreSQL
docker compose up --build                 # dashboard http://localhost:8080, API :8000
```

`DATABASE_URL` selects the store (`sqlite:///./fraudgraph.db` default, `postgresql://…` for Postgres). `AUTO_SEED=false` disables first-start seeding.

## How it works

| Layer | Module | Notes |
|---|---|---|
| Data | `schema.sql`, `app/db.py`, `app/generator.py` | accounts, transactions, complaints, cases, case_events, ground_truth. Generator mixes salary cycles, rent, merchants, collections, loan deposits, dormant-but-legit accounts with 5 injected ring templates |
| Detection | `app/detection.py`, `app/typology.py` | per-account signals → typology scores → composite, with explanations |
| Trace | `app/trace.py` | time-respecting forward trace from a complaint's origin transaction; legit hubs become boundary nodes |
| Prioritisation | `app/trace.py::prioritize` | amount at risk .35, network centrality .25, complaint recency .25 (72h half-life), detection confidence .15 |
| API | `app/main.py`, `app/service.py` | FastAPI: complaint intake, graph queries, scores, case CRUD, freeze, PDF export, metrics |
| Dashboard | `frontend/` | React + Tailwind + D3 force graph; dark/light |

### FG-Matrix (typologies)

| ID | Typology | Tactic | Primary signal |
|---|---|---|---|
| FGT-007 | Mule Recruitment Cluster | Preparation | accounts opened together sharing KYC device/address |
| FGT-006 | Dormant Reactivation | Preparation | long inactivity then a single burst that leaves fast |
| FGT-001 | Layering – Tier 1 Mule | Placement | inbound spike, age/volume mismatch, quick pass-through |
| FGT-002 | Layering – Tier 2/3 Mule | Layering | rapid pass-through on a multi-hop chain |
| FGT-003 | Smurfing | Layering | many near-equal sub-threshold transfers in 24h |
| FGT-004 | Circular Transfer | Layering | time-ordered, value-preserving cycle (length 3–6) |
| FGT-005 | Cash-out Point | Extraction | high withdrawal/inflow ratio, concentrated ATM/POS |

Scores are weighted sums of named signals (weights in `FORMULAS`, `app/detection.py`). A legitimacy dampener (sustained activity, recurring counterparties) protects merchants and payroll accounts. Every alert carries human-readable evidence strings.

## Evaluation (default seed 42, 1,355 accounts, ~25k transactions, 15 rings, 115 mule accounts)

| Metric | Result |
|---|---|
| Account detection @0.5 | precision 1.00, recall 1.00 (0 FP in 1,240 legitimate accounts, incl. 30 merchants, 5 payroll) |
| Primary-typology accuracy | 96.5% |
| Trace precision / recall | 1.00 / 1.00 over 17 complaints, mean depth 2.6 hops, <1 ms per trace |
| Alert → case → PDF (scripted) | ~18 ms system latency |

**Read these honestly.** The generator is much cleaner than real transaction data and the detector was tuned against it, so these numbers are a regression harness, not evidence of real-world accuracy. Known gaps: no adversarial/evasive mules (slow drip, held funds, mixed with real activity); Tier-1 label precision is low because downstream mules inherit it as a secondary tag; recruitment-cluster tracing from a single complaint only reaches the used members (idle cluster accounts surface via the linked-accounts panel and alerts). A human-usability study (roadmap metric 4) was not run — only the scripted click-path latency is measured.

## Project status vs roadmap

| Phase | Status |
|---|---|
| 1 Schema + typology matrix | done |
| 2 Synthetic generator | done |
| 3 Graph + detection (+ tests on ground truth) | done |
| 4 FastAPI backend | done (API tests need fastapi/httpx installed) |
| 5 React dashboard | written; **not built or run** in the authoring environment (no npm access) — run `npm install && npm run dev` and expect small fixes |
| 6 Case prioritisation | done |
| 7 Docs / demo / deploy | README + architecture done; PostgreSQL path, Docker files and CI written but **not executed**; demo GIF and hosted deployment still to do |

See `PROGRESS.md` for the exact stop point and next steps, and `docs/ARCHITECTURE.md` for diagrams.

## Layout

```
backend/   app/ (generator, detection, trace, service, api, reporting, evaluation)  tests/  scripts/  schema.sql
frontend/  Vite + React + Tailwind + D3
docs/      ARCHITECTURE.md
```
