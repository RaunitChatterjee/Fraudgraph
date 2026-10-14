"""Runtime configuration (environment driven)."""
from __future__ import annotations

import os


def _bool(v, default):
    if v is None:
        return default
    return str(v).strip().lower() in {"1", "true", "yes", "on"}


DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./fraudgraph.db")
AUTO_SEED = _bool(os.getenv("AUTO_SEED"), True)
SEED = int(os.getenv("FG_SEED", "42"))
CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",") if o.strip()]

# Detection thresholds
ALERT_THRESHOLD = float(os.getenv("FG_ALERT_THRESHOLD", "0.50"))        # composite score -> alert
TYPOLOGY_THRESHOLD = float(os.getenv("FG_TYPOLOGY_THRESHOLD", "0.45"))  # per-typology label
