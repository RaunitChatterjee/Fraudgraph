"""Financial-crime typology matrix (FG-Matrix).

An original classification of money-laundering modus operandi observed in
Indian UPI / net-banking fraud casework, organised by *tactic* in the same
spirit as MITRE ATT&CK organises techniques. Each entry names the primary
graph/behavioural signals the detection engine uses to assign it.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class Typology:
    code: str          # stable short code used across the codebase
    tid: str           # matrix id, ATT&CK-style
    name: str
    tactic: str        # Preparation | Placement | Layering | Extraction
    description: str
    signal: str        # primary detection signal (human readable)
    signals: tuple     # machine signal names that feed the score


TACTICS = ["Preparation", "Placement", "Layering", "Extraction"]

TYPOLOGIES: list[Typology] = [
    Typology(
        "MULE_CLUSTER", "FGT-007", "Mule Recruitment Cluster", "Preparation",
        "Group of accounts opened in a short window, structurally linked.",
        "Shared KYC metadata patterns, temporal account-creation clustering",
        ("cluster_size", "cluster_linked"),
    ),
    Typology(
        "DORMANT", "FGT-006", "Dormant Reactivation", "Preparation",
        "Long-inactive account suddenly active for a single large transfer.",
        "Activity gap analysis, single-burst behaviour",
        ("dormancy_gap", "burst_concentration", "funds_leave_quickly"),
    ),
    Typology(
        "L1", "FGT-001", "Layering – Tier 1 Mule", "Placement",
        "First-hop account receiving stolen funds directly from the victim.",
        "Sudden inbound spike, account age vs. transaction volume mismatch",
        ("inflow_spike", "age_volume_mismatch", "burst_concentration", "pass_through"),
    ),
    Typology(
        "L23", "FGT-002", "Layering – Tier 2/3 Mule", "Layering",
        "Downstream accounts receiving split/forwarded funds.",
        "Multi-hop chain depth, rapid pass-through timing",
        ("pass_through", "chain_depth", "young_account"),
    ),
    Typology(
        "SMURF", "FGT-003", "Smurfing", "Layering",
        "Large sum split into many small transfers to evade thresholds.",
        "High out-degree with near-equal transaction amounts",
        ("split_burst", "fed_by_single_inflow", "threshold_hugging"),
    ),
    Typology(
        "CIRCULAR", "FGT-004", "Circular Transfer", "Layering",
        "Funds routed through a loop back toward origin-linked accounts.",
        "Cycle detection in directed transaction graph",
        ("cycle_member", "pass_through"),
    ),
    Typology(
        "CASHOUT", "FGT-005", "Cash-out Point", "Extraction",
        "Terminal account with high withdrawal-to-inflow ratio.",
        "Withdrawal velocity, ATM/merchant cash-out concentration",
        ("withdrawal_ratio", "withdrawal_concentration"),
    ),
]

BY_CODE = {t.code: t for t in TYPOLOGIES}


def matrix() -> list[dict]:
    """JSON-friendly matrix, ordered by tactic then id."""
    order = {t: i for i, t in enumerate(TACTICS)}
    rows = sorted(TYPOLOGIES, key=lambda t: (order[t.tactic], t.tid))
    return [asdict(t) for t in rows]
