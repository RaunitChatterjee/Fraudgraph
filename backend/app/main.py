"""FastAPI application: complaint intake, graph queries, scoring, cases, reports."""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from . import __version__, config
from .db import Database
from .generator import GeneratorConfig
from .schemas import CaseUpdate, ComplaintIn, FreezeIn, NoteIn, ReseedIn
from .service import FraudGraphService, NotFound


def create_app(database_url: str | None = None, auto_seed: bool | None = None) -> FastAPI:
    db = Database(database_url or config.DATABASE_URL)
    svc = FraudGraphService(db)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if svc.is_empty():
            if config.AUTO_SEED if auto_seed is None else auto_seed:
                svc.seed()
        else:
            svc.load()
        yield

    app = FastAPI(title="FraudGraph API", version=__version__, lifespan=lifespan,
                  description="Mule-account network detection & investigation platform (synthetic data).")
    app.add_middleware(CORSMiddleware, allow_origins=config.CORS_ORIGINS, allow_methods=["*"], allow_headers=["*"],
                       expose_headers=["Content-Disposition"])
    app.state.service = svc

    def guard(fn, *a, **kw):
        if svc.an is None:
            raise HTTPException(503, "Dataset not loaded. POST /api/admin/reseed to generate one.")
        try:
            return fn(*a, **kw)
        except NotFound as e:
            raise HTTPException(404, f"Not found: {e}")
        except ValueError as e:
            raise HTTPException(422, str(e))

    @app.get("/api/health")
    def health():
        return {"status": "ok", "version": __version__, "loaded": svc.an is not None}

    @app.get("/api/stats")
    def stats():
        return guard(svc.stats)

    @app.get("/api/typologies")
    def typologies():
        return guard(svc.typologies)

    @app.get("/api/alerts")
    def alerts(typology: str | None = None, min_score: float | None = Query(None, ge=0, le=1), q: str | None = None,
               limit: int = Query(100, ge=1, le=500), offset: int = Query(0, ge=0)):
        return guard(svc.alerts, typology, min_score, q, limit, offset)

    @app.get("/api/accounts/{account_id}")
    def account(account_id: str):
        return guard(svc.account, account_id)

    @app.get("/api/accounts/{account_id}/neighborhood")
    def neighborhood(account_id: str, depth: int = Query(1, ge=1, le=2), limit: int = Query(80, ge=10, le=200)):
        return guard(svc.neighborhood, account_id, depth, limit)

    @app.post("/api/complaints", status_code=201)
    def create_complaint(body: ComplaintIn):
        return guard(svc.intake_complaint, body.victim_account, body.origin_txn_id, body.amount, body.filed_at,
                     body.category, body.description)

    @app.get("/api/cases")
    def cases(status: str | None = None, typology: str | None = None, priority: str | None = None, q: str | None = None):
        return guard(svc.list_cases, status, typology, priority, q)

    @app.get("/api/cases/{case_id}")
    def case(case_id: str):
        return guard(svc.get_case, case_id)

    @app.patch("/api/cases/{case_id}")
    def update_case(case_id: str, body: CaseUpdate):
        return guard(svc.update_case, case_id, body.status, body.assigned_to, body.actor)

    @app.post("/api/cases/{case_id}/notes", status_code=201)
    def add_note(case_id: str, body: NoteIn):
        return guard(svc.add_note, case_id, body.text, body.actor)

    @app.post("/api/cases/{case_id}/freeze")
    def freeze(case_id: str, body: FreezeIn):
        return guard(svc.freeze_account, case_id, body.account_id, body.actor)

    @app.get("/api/cases/{case_id}/report.pdf")
    def report(case_id: str):
        pdf = guard(svc.report_pdf, case_id)
        return Response(pdf, media_type="application/pdf",
                        headers={"Content-Disposition": f'attachment; filename="FraudGraph_{case_id}.pdf"'})

    @app.get("/api/metrics")
    def metrics():
        return guard(svc.metrics)

    @app.post("/api/admin/reseed")
    def reseed(body: ReseedIn):
        return svc.seed(GeneratorConfig(seed=body.seed, n_individuals=body.n_individuals, days=body.days))

    return app

