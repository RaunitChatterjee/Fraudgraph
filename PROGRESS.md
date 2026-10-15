# Progress / hand-off

Session date: 2026-10-14. Built end-to-end in one pass.

## Done and verified (in the authoring sandbox)
- Phase 1–3, 6: schema, DB layer (SQLite), typology matrix, generator, detection, trace, prioritisation, evaluation — 21 unit/integration tests pass.
- Phase 4: FastAPI app and PDF export. Service layer and PDF verified directly; HTTP layer syntax-checked only (fastapi not installable offline).
- Phase 5: React dashboard written (queue, case view with D3 graph, matrix, metrics, intake modal).

## Update 2026-10-14 (after first local run)
- Backend verified by the user on Python 3.9: 22 tests passed, API served requests. Fixes: Python 3.9 type hints in `main.py`, `scipy` dependency, startup now repairs an interrupted seed (`ensure_cases`), event timestamps tagged UTC.
- Frontend redesigned (overview with complaint-lag plot, money-flow timeline, account drawer, matrix heat, evaluation charts). JSX syntax-checked with tsc; not yet run in a browser by the author.

## Not verified
- `npm install && npm run build` (frontend never compiled)
- FastAPI routes under a real server / TestClient (test is written, auto-skips if fastapi/httpx missing)
- PostgreSQL path (`psycopg`), docker-compose, GitHub Actions
- Faker identities path (fallback name lists were used)

## Next steps
1. Run the frontend and fix any build/runtime errors.
2. Run `pytest` with full requirements installed (API test).
3. Add evasive mule behaviour to the generator (slow drip, held funds, mixed activity) and re-tune; report a degradation curve.
4. Roadmap Phase 7 leftovers: demo GIF, hosted deploy (Vercel/Netlify + Render/Railway).
5. Roadmap metric 4: run a real usability timing with a person.
