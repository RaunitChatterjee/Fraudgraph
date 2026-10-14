-- FraudGraph schema. Portable across PostgreSQL and SQLite (timestamps are
-- ISO-8601 strings in SQLite, native TIMESTAMP in PostgreSQL).

CREATE TABLE IF NOT EXISTS accounts (
    id              TEXT PRIMARY KEY,
    holder_name     TEXT NOT NULL,
    bank            TEXT NOT NULL,
    account_type    TEXT NOT NULL,              -- individual | merchant | payroll | corporate
    created_at      TIMESTAMP NOT NULL,
    last_active_at  TIMESTAMP,                  -- last activity before the dataset window (bank record)
    kyc_address     TEXT,                       -- hashed address on KYC
    kyc_device      TEXT,                       -- device / SIM binding id
    status          TEXT NOT NULL DEFAULT 'active'   -- active | frozen
);

CREATE TABLE IF NOT EXISTS transactions (
    id       TEXT PRIMARY KEY,
    src      TEXT NOT NULL,
    dst      TEXT,                              -- NULL for cash withdrawals
    amount   DOUBLE PRECISION NOT NULL,
    ts       TIMESTAMP NOT NULL,
    channel  TEXT NOT NULL,                     -- UPI | IMPS | NEFT | ATM | POS
    kind     TEXT NOT NULL DEFAULT 'transfer'   -- transfer | withdrawal
);
CREATE INDEX IF NOT EXISTS idx_txn_src ON transactions (src, ts);
CREATE INDEX IF NOT EXISTS idx_txn_dst ON transactions (dst, ts);

CREATE TABLE IF NOT EXISTS complaints (
    id              TEXT PRIMARY KEY,
    victim_account  TEXT NOT NULL,
    origin_txn_id   TEXT NOT NULL,
    amount          DOUBLE PRECISION NOT NULL,
    filed_at        TIMESTAMP NOT NULL,
    category        TEXT,
    description     TEXT,
    status          TEXT NOT NULL DEFAULT 'registered'
);

CREATE TABLE IF NOT EXISTS cases (
    id              TEXT PRIMARY KEY,
    complaint_id    TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'open',   -- open | investigating | funds_frozen | closed
    priority_score  DOUBLE PRECISION NOT NULL DEFAULT 0,
    priority_label  TEXT NOT NULL DEFAULT 'Low',
    assigned_to     TEXT,
    created_at      TIMESTAMP NOT NULL,
    updated_at      TIMESTAMP NOT NULL,
    analysis        TEXT NOT NULL                   -- JSON: trace graph, stats, priority components
);

CREATE TABLE IF NOT EXISTS case_accounts (
    case_id     TEXT NOT NULL,
    account_id  TEXT NOT NULL,
    hop         INTEGER NOT NULL,
    score       DOUBLE PRECISION NOT NULL,
    typologies  TEXT NOT NULL,                      -- JSON list of typology codes
    PRIMARY KEY (case_id, account_id)
);

CREATE TABLE IF NOT EXISTS case_events (
    id        TEXT PRIMARY KEY,
    case_id   TEXT NOT NULL,
    ts        TIMESTAMP NOT NULL,
    kind      TEXT NOT NULL,                        -- created | status | note | freeze
    actor     TEXT NOT NULL,
    payload   TEXT NOT NULL                         -- JSON
);
CREATE INDEX IF NOT EXISTS idx_events_case ON case_events (case_id, ts);

-- Evaluation-only: injected fraud-ring labels. Never read by the detector.
CREATE TABLE IF NOT EXISTS ground_truth (
    account_id  TEXT PRIMARY KEY,
    ring_id     TEXT NOT NULL,
    ring_type   TEXT NOT NULL,
    role        TEXT NOT NULL,
    typologies  TEXT NOT NULL                       -- JSON list, primary first
);

CREATE TABLE IF NOT EXISTS meta (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
);
