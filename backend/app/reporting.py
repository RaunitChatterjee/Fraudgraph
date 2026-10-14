"""Exportable PDF investigation report for a case (reportlab)."""
from __future__ import annotations

import io
from collections import defaultdict
from datetime import datetime

from reportlab.graphics.shapes import Circle, Drawing, Line, Polygon, Rect, String
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle)

from .db import utcnow
from .typology import BY_CODE

NAVY = colors.HexColor("#0b2545")
ACCENT = colors.HexColor("#1f6feb")
GRID = colors.HexColor("#c9d1d9")
ROLE_COLOR = {"victim": colors.HexColor("#1f6feb"), "mule": colors.HexColor("#d1242f"),
              "boundary": colors.HexColor("#8b949e"), "cash": colors.HexColor("#d4a72c")}


def inr(v) -> str:
    return f"Rs {float(v):,.0f}"


def _short(i: str) -> str:
    return i[-5:] if i.startswith("ACC") else ("ATM" if i.startswith("CASH:") else i[-5:])


def network_drawing(nodes: list, edges: list, width=170 * mm, height=95 * mm) -> Drawing:
    d = Drawing(width, height)
    d.add(Rect(0, 0, width, height, strokeColor=GRID, fillColor=colors.HexColor("#f6f8fa")))
    by_hop = defaultdict(list)
    for n in nodes:
        by_hop[n["hop"]].append(n)
    max_hop = max(by_hop) if by_hop else 0
    pos = {}
    for hop, items in by_hop.items():
        items.sort(key=lambda n: (n["role"] == "cash", n["id"]))
        x = 18 * mm + (width - 36 * mm) * (hop / max(1, max_hop))
        for i, n in enumerate(items):
            y = height - 12 * mm - (height - 24 * mm) * ((i + 0.5) / len(items))
            pos[n["id"]] = (x, y)
    seen = set()
    for e in edges:
        k = (e["src"], e["dst"])
        if k in seen or e["src"] not in pos or e["dst"] not in pos:
            continue
        seen.add(k)
        (x1, y1), (x2, y2) = pos[e["src"]], pos[e["dst"]]
        d.add(Line(x1, y1, x2, y2, strokeColor=colors.HexColor("#b1bac4") if not e.get("loop") else colors.HexColor("#d1242f"),
                   strokeWidth=0.5))
    r = 3.2 if len(nodes) > 25 else 4.5
    for n in nodes:
        x, y = pos[n["id"]]
        d.add(Circle(x, y, r, fillColor=ROLE_COLOR.get(n["role"], colors.grey), strokeColor=colors.white, strokeWidth=0.4))
        if len(nodes) <= 30:
            d.add(String(x, y - r - 7, _short(n["id"]), fontSize=5.5, textAnchor="middle", fillColor=colors.HexColor("#30363d")))
    lx = 4 * mm
    for role, label in (("victim", "Victim"), ("mule", "Traced account"), ("boundary", "Legit hub (boundary)"), ("cash", "Cash-out")):
        d.add(Circle(lx, height - 5 * mm, 3, fillColor=ROLE_COLOR[role], strokeColor=colors.white))
        d.add(String(lx + 5, height - 6.8 * mm, label, fontSize=6.5, fillColor=colors.HexColor("#30363d")))
        lx += 30 * mm
    return d


def build_case_report(case: dict) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=15 * mm, rightMargin=15 * mm, topMargin=16 * mm,
                            bottomMargin=16 * mm, title=f"FraudGraph Investigation Report {case['id']}",
                            author="FraudGraph")
    ss = getSampleStyleSheet()
    h1 = ParagraphStyle("h1", parent=ss["Heading1"], textColor=NAVY, fontSize=19, spaceAfter=2)
    h2 = ParagraphStyle("h2", parent=ss["Heading2"], textColor=NAVY, fontSize=12, spaceBefore=10, spaceAfter=4)
    body = ParagraphStyle("b", parent=ss["BodyText"], fontSize=8.8, leading=12)
    small = ParagraphStyle("s", parent=body, fontSize=7.4, leading=9.5, textColor=colors.HexColor("#57606a"))
    cell = ParagraphStyle("c", parent=body, fontSize=7.4, leading=9)

    c, cp, st = case, case["complaint"], case["analysis"]["stats"]
    pr = case["analysis"]["priority"]
    story = [
        Paragraph("FraudGraph - Investigation Report", h1),
        Paragraph(f"Case <b>{c['id']}</b> &nbsp;|&nbsp; Complaint <b>{cp['id']}</b> &nbsp;|&nbsp; Status <b>{c['status'].replace('_', ' ')}</b>"
                  f" &nbsp;|&nbsp; Priority <b>{pr['label']} ({pr['score']:.0f}/100)</b>", body),
        Paragraph(f"Generated {utcnow():%d %b %Y %H:%M} UTC. Synthetic data - demonstration platform.", small),
        Spacer(1, 4),
    ]

    def kv(rows, widths):
        t = Table(rows, colWidths=widths)
        t.setStyle(TableStyle([("FONTSIZE", (0, 0), (-1, -1), 8.3), ("TEXTCOLOR", (0, 0), (0, -1), colors.HexColor("#57606a")),
                               ("GRID", (0, 0), (-1, -1), 0.25, GRID), ("VALIGN", (0, 0), (-1, -1), "TOP"),
                               ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f6f8fa"))]))
        return t

    story += [Paragraph("1. Complaint", h2), kv([
        ["Victim account", cp["victim_account"], "Filed at", str(cp["filed_at"]).replace("T", " ")],
        ["Amount reported", inr(cp["amount"]), "Category", cp.get("category") or "-"],
        ["Origin transaction", cp["origin_txn_id"], "Description", Paragraph(cp.get("description") or "-", cell)],
    ], [32 * mm, 52 * mm, 24 * mm, 70 * mm])]

    story += [Paragraph("2. Trace summary", h2), kv([
        ["Accounts traced", st["accounts_traced"], "Max hop depth", st["max_hop_depth"]],
        ["Gross transfer volume (incl. loops)", inr(st["laundered_volume"]), "Cash-out detected", inr(st["cash_out_total"])],
        ["Est. recoverable (still in accounts)", inr(st["recoverable_amount"]), "Money span", f"{st['money_span_minutes']:.0f} min"],
        ["Loops detected", st["loops_detected"], "Funds frozen so far", inr(case.get("frozen_amount", 0))],
    ], [52 * mm, 36 * mm, 40 * mm, 50 * mm])]

    comp = pr["components"]
    story += [Paragraph("Priority breakdown: " + ", ".join(f"{k} {v:.2f} (w {pr['weights'][k]:.2f})" for k, v in comp.items()), small)]

    nodes = case["analysis"]["nodes"]
    edges = case["analysis"]["edges"]
    story += [Paragraph("3. Traced network (columns = hop distance from victim)", h2),
              network_drawing(nodes, edges)]

    mules = sorted([n for n in nodes if n["role"] == "mule"], key=lambda n: (n["hop"], -n.get("score", 0)))
    rows = [["Account", "Hop", "Typologies", "Score", "Inflow", "Cash out", "Retained", "Status"]]
    for n in mules[:45]:
        labels = ", ".join(BY_CODE[t].tid for t in n.get("typologies", []) if t in BY_CODE) or "-"
        rows.append([n["id"], n["hop"], labels, f"{n.get('score', 0):.2f}", inr(n["inflow"]), inr(n["withdrawn"]),
                     inr(n.get("retained", 0)), n.get("status", "active")])
    t = Table(rows, repeatRows=1, colWidths=[27 * mm, 10 * mm, 36 * mm, 13 * mm, 24 * mm, 24 * mm, 24 * mm, 16 * mm])
    t.setStyle(TableStyle([("FONTSIZE", (0, 0), (-1, -1), 7.2), ("BACKGROUND", (0, 0), (-1, 0), NAVY),
                           ("TEXTCOLOR", (0, 0), (-1, 0), colors.white), ("GRID", (0, 0), (-1, -1), 0.25, GRID),
                           ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f6f8fa")])]))
    story += [Paragraph("4. Accounts under investigation", h2), t]
    if len(mules) > 45:
        story.append(Paragraph(f"... and {len(mules) - 45} more accounts (see dashboard).", small))

    story.append(Paragraph("5. Why accounts were flagged (top evidence)", h2))
    for n in sorted(mules, key=lambda n: -n.get("score", 0))[:6]:
        ev = n.get("evidence", [])
        lines = "<br/>".join(f"- {e}" for e in ev[:4]) or "- no strong signals"
        story.append(KeepTogether([Paragraph(f"<b>{n['id']}</b> - composite {n.get('score', 0):.2f}", body),
                                   Paragraph(lines, small), Spacer(1, 3)]))

    transfers = sorted(edges, key=lambda e: e["ts"])[:28]
    rows = [["Time", "From", "To", "Amount", "Channel"]]
    for e in transfers:
        rows.append([e["ts"].replace("T", " "), _short(e["src"]), "ATM/POS" if e["dst"].startswith("CASH:") else _short(e["dst"]),
                     inr(e["amount"]), e["channel"]])
    t = Table(rows, repeatRows=1, colWidths=[38 * mm, 24 * mm, 24 * mm, 30 * mm, 22 * mm])
    t.setStyle(TableStyle([("FONTSIZE", (0, 0), (-1, -1), 7.2), ("BACKGROUND", (0, 0), (-1, 0), NAVY),
                           ("TEXTCOLOR", (0, 0), (-1, 0), colors.white), ("GRID", (0, 0), (-1, -1), 0.25, GRID)]))
    story += [Paragraph("6. Fund flow (first transactions, chronological)", h2), t]

    if case.get("linked_accounts"):
        rows = [["Account", "Linked via", "Score", "Typologies"]]
        for a in case["linked_accounts"][:15]:
            rows.append([a["id"], a["via"], f"{a['score']:.2f}", ", ".join(a["labels"]) or "-"])
        t = Table(rows, repeatRows=1, colWidths=[30 * mm, 60 * mm, 18 * mm, 50 * mm])
        t.setStyle(TableStyle([("FONTSIZE", (0, 0), (-1, -1), 7.2), ("BACKGROUND", (0, 0), (-1, 0), NAVY),
                               ("TEXTCOLOR", (0, 0), (-1, 0), colors.white), ("GRID", (0, 0), (-1, -1), 0.25, GRID)]))
        story += [Paragraph("7. Linked accounts not on the money trail", h2), t]

    story.append(Paragraph("8. Investigator timeline & notes", h2))
    if not case["events"]:
        story.append(Paragraph("No events recorded.", small))
    for ev in case["events"][:40]:
        p = ev["payload"]
        if ev["kind"] == "note":
            txt = f"Note: {p.get('text', '')}"
        elif ev["kind"] == "freeze":
            txt = f"Simulated freeze of {p.get('account_id')} (est. {inr(p.get('amount_frozen', 0))} held)"
        elif ev["kind"] == "status":
            txt = f"Status {p.get('from')} -> {p.get('to')}"
        else:
            txt = "Case created from complaint; trace and prioritisation run."
        story.append(Paragraph(f"<b>{str(ev['ts']).replace('T', ' ')}</b> ({ev['actor']}) {txt}", body))

    def footer(canvas, doc_):
        canvas.saveState()
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(colors.HexColor("#57606a"))
        canvas.drawString(15 * mm, 9 * mm, f"FraudGraph | {c['id']} | Confidential - simulated investigation")
        canvas.drawRightString(A4[0] - 15 * mm, 9 * mm, f"Page {doc_.page}")
        canvas.restoreState()

    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return buf.getvalue()
