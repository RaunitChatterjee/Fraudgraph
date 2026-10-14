"""Pydantic request models."""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class ComplaintIn(BaseModel):
    victim_account: str = Field(..., examples=["ACC12345678"])
    origin_txn_id: Optional[str] = Field(None, description="Transaction id from the victim's statement (preferred).")
    amount: Optional[float] = Field(None, gt=0, description="Used to locate the origin txn if no id is given.")
    filed_at: Optional[datetime] = None
    category: Optional[str] = None
    description: Optional[str] = None


class CaseUpdate(BaseModel):
    status: Optional[str] = None
    assigned_to: Optional[str] = None
    actor: str = "investigator"


class NoteIn(BaseModel):
    text: str = Field(..., min_length=1, max_length=4000)
    actor: str = "investigator"


class FreezeIn(BaseModel):
    account_id: str
    actor: str = "investigator"


class ReseedIn(BaseModel):
    seed: int = 42
    n_individuals: int = Field(1200, ge=100, le=5000)
    days: int = Field(60, ge=30, le=120)
