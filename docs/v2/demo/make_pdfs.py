import json, os, base64
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor
from data import DOCS, FACTS, PLANS, CAT

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "pdfs")
os.makedirs(OUT, exist_ok=True)
W, H = letter
RED = HexColor("#cf3043")
BLUE = HexColor("#315edb")
INK = HexColor("#171b24")
MUTED = HexColor("#596477")
LINE = HexColor("#b7c2d2")
TINT = HexColor("#fbe5e2")

GLOBE_TABLES = {
    3: ("Schedule of Benefits — Costs", ["Deductible", "Out-of-Pocket Maximum", "Coinsurance", "Overall Maximum"]),
    4: ("Schedule of Benefits — Services", ["Emergency Room – Illness or Injury", "Physician Office Visit", "Outpatient Mental Health"]),
    7: ("Pre-existing Conditions", ["Pre-existing Conditions"]),
}
GLOBE_ROWKEY = {"Deductible": "ded", "Out-of-Pocket Maximum": "oop", "Coinsurance": "coins", "Overall Maximum": "max",
                "Emergency Room – Illness or Injury": "er", "Physician Office Visit": "doc",
                "Outpatient Mental Health": "mh", "Pre-existing Conditions": "pre"}


def cell_text(f):
    w = f["w"]
    return w.split(": ", 1)[1] if ": " in w else w


def banner(c, doc, p):
    c.setFillColor(TINT)
    c.rect(36, H - 78, W - 72, 46, stroke=0, fill=1)
    c.setFillColor(RED)
    c.setFont("Helvetica-Bold", 12)
    c.drawString(48, H - 52, "DEMO PDF — not a real insurance document")
    c.setFont("Helvetica", 9)
    c.setFillColor(INK)
    c.drawString(48, H - 67, "Invented for the Insurance Simplified demo, to show that every fact on screen links back to its page.")
    c.setFillColor(MUTED)
    c.setFont("Helvetica", 9)
    c.drawString(36, H - 96, "%s  |  %s  |  %s" % (doc["family"], doc["type"], doc["file"]))


def footer(c, doc, p):
    printed = p - doc["offset"] if p > doc["offset"] else None
    c.setFillColor(MUTED)
    c.setFont("Helvetica", 9)
    if printed:
        c.drawCentredString(W / 2, 30, "Page %d" % printed)
    c.drawRightString(W - 36, 30, "PDF page %d of %d" % (p, doc["pages"]))


def write_lines(c, lines, y):
    for ln in lines:
        c.setFillColor(INK)
        c.setFont("Helvetica", 11)
        c.drawString(56, y, ln)
        c.setStrokeColor(LINE)
        c.setLineWidth(0.4)
        c.line(56, y - 7, W - 56, y - 7)
        y -= 26
    return y


def make(doc):
    path = os.path.join(OUT, doc["file"])
    c = canvas.Canvas(path, pagesize=letter)
    c.setTitle("DEMO — " + doc["family"])
    plans = doc["plans"]
    # collect single-line facts per page (dedupe)
    pages = {}
    for pid in plans:
        for k, f in FACTS[pid].items():
            if doc["id"] == "globe" and f["p"] in GLOBE_TABLES and k in GLOBE_ROWKEY.values():
                continue
            if f["s"] == "k":
                pages.setdefault(2, []).append("Lifetime limit: None")
                pages.setdefault(4, []).append("Maximum benefit: $1,000,000 per Insured Person")
                continue
            pages.setdefault(f["p"], []).append(f["w"] if f["s"] != "u" else "Rx Tier 1 .................................. $15   |   $40")
    for ct in doc["contacts"]:
        pages.setdefault(ct[3], []).append("%s (%s): %s" % (ct[2], ct[0], ct[1]))
    for p in range(1, doc["pages"] + 1):
        banner(c, doc, p)
        y = H - 140
        if p == 1 and doc["id"] != "scholar":
            c.setFillColor(INK)
            c.setFont("Helvetica-Bold", 26)
            c.drawString(56, y - 40, doc["family"])
            c.setFont("Helvetica", 14)
            c.setFillColor(MUTED)
            c.drawString(56, y - 66, "%s  |  Plan year 2026-2027  |  Levels: %s" % (doc["type"], ", ".join(doc["levels"])))
            y -= 110
        if p == 1 and doc["id"] == "scholar":
            c.setFillColor(INK)
            c.setFont("Helvetica-Bold", 16)
            c.drawString(56, y, "Summary of Benefits and Coverage — Important Questions")
            y -= 30
        if doc["id"] == "globe" and p in GLOBE_TABLES:
            title, rows = GLOBE_TABLES[p]
            c.setFillColor(INK)
            c.setFont("Helvetica-Bold", 15)
            c.drawString(56, y, title)
            y -= 30
            x0, cw = 56, [190, 110, 110, 110]
            heads = ["Benefit"] + doc["levels"]
            c.setFillColor(HexColor("#eff4ff"))
            c.rect(x0, y - 8, sum(cw), 24, stroke=0, fill=1)
            c.setFillColor(BLUE)
            c.setFont("Helvetica-Bold", 11)
            x = x0
            for i, hd in enumerate(heads):
                c.drawString(x + 6, y, hd)
                x += cw[i]
            y -= 30
            for row in rows:
                key = GLOBE_ROWKEY[row]
                vals = [cell_text(FACTS[pid][key]) for pid in plans]
                c.setFillColor(INK)
                c.setFont("Helvetica-Bold", 10)
                c.drawString(x0 + 6, y, row[:34])
                c.setFont("Helvetica", 9.5)
                x = x0 + cw[0]
                for i, v in enumerate(vals):
                    t = c.beginText(x + 6, y)
                    words, line = v.split(), ""
                    out = []
                    for wd in words:
                        if c.stringWidth(line + " " + wd, "Helvetica", 9.5) > cw[i + 1] - 12:
                            out.append(line.strip()); line = wd
                        else:
                            line += " " + wd
                    out.append(line.strip())
                    for o in out:
                        t.textLine(o)
                    c.drawText(t)
                    x += cw[i + 1]
                c.setStrokeColor(LINE)
                c.setLineWidth(0.4)
                c.line(x0, y - 26, x0 + sum(cw), y - 26)
                y -= 40
            y -= 10
        lines = pages.get(p, [])
        if lines:
            c.setFillColor(INK)
            c.setFont("Helvetica-Bold", 13)
            c.drawString(56, y, "Contact us" if any("(Phone)" in l or "(Email)" in l for l in lines) and len(lines) <= 3 else "Benefits on this page")
            y -= 26
            y = write_lines(c, lines, y)
        if not lines and not (doc["id"] == "globe" and p in GLOBE_TABLES) and p != 1:
            c.setFillColor(MUTED)
            c.setFont("Helvetica-Oblique", 11)
            c.drawString(56, y, "Demo filler page: definitions, claims process and legal text would appear here.")
        footer(c, doc, p)
        c.showPage()
    c.save()
    return path


out = {}
for d in DOCS:
    p = make(d)
    out[d["id"]] = base64.b64encode(open(p, "rb").read()).decode()
    print(d["file"], os.path.getsize(p))

data = {"CAT": CAT, "DOCS": DOCS, "FACTS": FACTS, "PLANS": PLANS}
json.dump({"data": data, "pdfs": out}, open(os.path.join(os.path.dirname(OUT), "bundle.json"), "w"))
print("bundle", os.path.getsize(os.path.join(os.path.dirname(OUT), "bundle.json")))
