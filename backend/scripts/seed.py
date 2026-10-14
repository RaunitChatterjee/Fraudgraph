"""Generate the synthetic dataset and create cases.

    python -m scripts.seed [--seed 42] [--individuals 1200] [--days 60]
Honours DATABASE_URL (SQLite by default, PostgreSQL in docker-compose).
"""
import argparse

from app import config
from app.db import Database
from app.generator import GeneratorConfig
from app.service import FraudGraphService

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=config.SEED)
    ap.add_argument("--individuals", type=int, default=1200)
    ap.add_argument("--days", type=int, default=60)
    a = ap.parse_args()
    svc = FraudGraphService(Database(config.DATABASE_URL))
    print(svc.seed(GeneratorConfig(seed=a.seed, n_individuals=a.individuals, days=a.days)))
