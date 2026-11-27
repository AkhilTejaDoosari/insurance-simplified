"""Single source of truth for the demo: documents, plans, facts, contacts.
Used to generate the demo PDFs and the JSON embedded in the HTML."""

CAT = {
    "ded": [1, "Deductible", "The amount you pay yourself before the plan starts paying its share."],
    "oop": [1, "Most you pay in a year", "The \"out-of-pocket maximum\". Once you have paid this much in a year, the plan pays 100% of covered care."],
    "er": [1, "ER visit", "Emergency room care."],
    "coins": [1, "Coinsurance", "After the deductible, you and the plan split each bill by percentage. \"You pay 20%\" means on a $1,000 bill you pay $200."],
    "pre": [1, "Condition you had before", "A \"pre-existing condition\" is a health problem you had before the plan started."],
    "max": [1, "Overall plan maximum", "The most the plan will pay in total, for the period shown."],
    "doc": [2, "Doctor visit", "A regular visit to a primary care doctor. A \"copay\" is a fixed amount you pay at each visit."],
    "rx": [2, "Generic prescriptions", "Lower-cost versions of brand-name medicines."],
    "evac": [2, "Medical evacuation", "Transport to a hospital that can treat you when local care isn't enough."],
    "mh": [2, "Mental health", "Therapy or counseling visits."],
    "repat": [2, "Repatriation", "Transport back to your home country after a serious illness."],
    "dent": [3, "Dental", "Care for teeth."],
    "chiro": [3, "Chiropractic", "Treatment of joints and spine by a chiropractor."],
    "bedside": [3, "Bedside visit", "Travel costs for a family member to come to you if you're in hospital."],
    "sports": [3, "Sports injury rider", "Extra cover for injuries from school sports."],
}

DOCS = [
    {"id": "globe", "file": "globe-student-care-2026.pdf", "family": "Globe Student Care",
     "type": "International student plan", "pages": 12, "offset": 2,
     "levels": ["Basic", "Gold", "Platinum"], "plans": ["g1", "g2", "g3"], "initial": True,
     "contacts": [["Phone", "+1-800-555-0142", "Customer service", 12], ["Email", "claims@globe.example", "Claims", 12]]},
    {"id": "campus", "file": "campus-care-2026.pdf", "family": "Campus Care",
     "type": "Student health plan", "pages": 12, "offset": 0,
     "levels": ["Standard"], "plans": ["c1"], "initial": True,
     "contacts": [["Phone", "+1-888-555-0199", "Member services", 12]]},
    {"id": "scholar", "file": "scholar-shield-sbc-2026.pdf", "family": "Scholar Shield",
     "type": "Benefits summary (SBC)", "pages": 4, "offset": 0,
     "levels": ["Gold"], "plans": ["s1"], "initial": True,
     "contacts": [["Phone", "+1-877-555-0110", "Customer service", 1], ["Email", "help@scholarshield.example", "Coverage questions", 1]]},
    {"id": "travel", "file": "travel-guard-2026.pdf", "family": "Travel Guard",
     "type": "Travel medical plan", "pages": 5, "offset": 0,
     "levels": ["Standard"], "plans": ["t1"], "initial": False,
     "contacts": [["Phone", "+1-855-555-0123", "24/7 emergency help", 3], ["Email", "service@travelguard.example", "Customer service", 3]]},
]


def V(d, n, b, w, p, pl, look=""):
    return {"s": "v", "d": d, "n": n, "b": b, "w": w, "p": p, "pl": pl, "look": look}


def X(d, w, p, pl, look=""):
    return {"s": "x", "d": d, "n": 0, "b": "", "w": w, "p": p, "pl": pl, "look": look}


def U(w, p, pl, look=""):
    return {"s": "u", "d": "Check page %d" % p, "n": 0, "b": "", "w": w, "p": p, "pl": pl, "look": look}


def K(d, w, p, pl, look=""):
    return {"s": "k", "d": d, "n": 0, "b": "", "w": w, "p": p, "pl": pl, "look": look}


def col(level):
    return "Row: %s · Column: " + level


# Globe Student Care: level-specific values sit in a table with one column per level.
def G(row, level):
    return "Row “%s” · Column “%s”" % (row, level)


GLOBE = {}
for lv, ded, oop, coin, mx in [("Basic", 500, 7500, 20, 100000), ("Gold", 250, 5000, 10, 250000), ("Platinum", 0, 3000, 0, 500000)]:
    pid = {"Basic": "g1", "Gold": "g2", "Platinum": "g3"}[lv]
    f = {}
    f["ded"] = V("$%s per year" % format(ded, ",") if ded else "$0", ded, "year",
                 "Deductible: $%s per Policy Year" % format(ded, ","), 3,
                 ("You pay the first $%s of covered care each year, across all visits. Then the plan starts paying." % format(ded, ",")) if ded else "No deductible: the plan pays from your first visit.",
                 G("Deductible", lv))
    f["oop"] = V("$%s per year" % format(oop, ","), oop, "year", "Out-of-Pocket Maximum: $%s per Policy Year" % format(oop, ","), 3,
                 "In a bad year, the most you pay for covered care is $%s." % format(oop, ","), G("Out-of-Pocket Maximum", lv))
    f["coins"] = V("You pay %d%%" % coin, coin, "", "Coinsurance: Plan pays %d%%" % (100 - coin), 3,
                   ("After your deductible, the plan pays %d%% of each bill and you pay %d%%." % (100 - coin, coin)) if coin else "The plan pays 100% of covered bills.",
                   G("Coinsurance", lv))
    f["max"] = V("$%s per year" % format(mx, ","), mx, "year", "Overall Maximum: $%s per Policy Year" % format(mx, ","), 3,
                 "The plan pays up to $%s in total each policy year." % format(mx, ","), G("Overall Maximum", lv))
    f["er"] = V("$250 per visit, then 100%", 1, "visit", "Emergency Room – Illness or Injury: $250 copay per visit, then 100%", 4,
                "You pay $250 at each ER visit. The plan pays the rest.", G("Emergency Room – Illness or Injury", lv))
    f["doc"] = V("$30 per visit", 30, "visit", "Physician Office Visit: $30 copay per visit", 4,
                 "You pay $30 at each doctor visit.", G("Physician Office Visit", lv))
    if lv == "Basic":
        f["mh"] = X("Not covered", "Outpatient Mental Health: Not covered", 4, "Not covered on this level.", G("Outpatient Mental Health", lv))
        f["pre"] = X("Excluded for first 12 months", "Pre-existing Conditions: Excluded for the first 12 months", 7,
                     "Not covered during your first 12 months on the plan.", G("Pre-existing Conditions", lv))
    else:
        f["mh"] = V("$30 per visit", 30, "visit", "Outpatient Mental Health: $30 copay per visit", 4,
                    "You pay $30 per visit, like a doctor visit.", G("Outpatient Mental Health", lv))
        f["pre"] = V("Covered", 1, "", "Pre-existing Conditions: Covered", 7,
                     "Covered from day one, like any other condition.", G("Pre-existing Conditions", lv))
    f["rx"] = V("$15 per prescription", 15, "", "Generic Drugs: $15 copay per prescription", 5,
                "You pay $15 for each generic prescription.", "Line “Generic Drugs” (all levels)")
    f["evac"] = V("Up to $500,000", 500000, "", "Emergency Medical Evacuation: up to $500,000", 8,
                  "The plan pays up to $500,000 to move you to proper care.", "Line “Emergency Medical Evacuation” (all levels)")
    f["dent"] = V("Accident only, up to $500 per year", 500, "year", "Dental – Accidental Injury: up to $500 per Policy Year", 9,
                  "Only dental care after an accident, up to $500 a year.", "Line “Dental – Accidental Injury” (all levels)")
    f["bedside"] = V("Up to $1,500", 1500, "", "Bedside Visit: up to $1,500", 10,
                     "Up to $1,500 for a family member to travel to you.", "Line “Bedside Visit” (all levels)")
    GLOBE[pid] = f

FACTS = dict(GLOBE)
FACTS["c1"] = {
    "ded": V("$250 per illness or injury", 250, "incident", "Deductible: $250 per Injury or Sickness", 2,
             "You pay $250 for each new illness or injury. A second, separate illness means another $250."),
    "coins": V("You pay 20%", 20, "", "Coinsurance: 80% after Deductible", 3, "After your deductible, the plan pays 80% and you pay 20%."),
    "oop": V("$6,350 per year", 6350, "year", "Out of Pocket Maximum (PPO): $6,350 per Policy Year", 4,
             "In a bad year, the most you pay for covered care in-network is $6,350."),
    "doc": V("$40 per visit", 40, "visit", "Office Visit – PCP: $40 copay", 5, "You pay $40 at each doctor visit."),
    "mh": V("$40 per visit", 40, "visit", "Behavioral Health – Office: $40 copay", 5, "You pay $40 per visit."),
    "er": V("Plan pays up to $500 per visit", 0, "visit", "Emergency Room: Covered up to $500 per visit", 6,
            "The plan pays at most $500 each ER visit. Anything above that is yours to pay."),
    "rx": U("Rx Tier 1 … $15 | $40 (columns not labelled)", 7,
            "We found an amount on page 7 but could not tell which column it belongs to.", "Line “Rx Tier 1” — two amounts, no column headers"),
    "pre": X("Excluded for first 12 months", "Pre-existing conditions are excluded for the first 12 months of coverage.", 9,
             "Not covered during your first 12 months on the plan."),
    "sports": V("Up to $5,000", 5000, "", "Intercollegiate Sports Rider: covered up to $5,000", 12,
                "Injuries from school sports covered up to $5,000."),
}
FACTS["s1"] = {
    "ded": V("$250 per year", 250, "year", "What is the overall deductible? $250 per year", 1,
             "You pay the first $250 of covered care each year, across all visits. Then the plan starts paying.", "Important Questions table"),
    "oop": V("$3,000 per year", 3000, "year", "What is the out-of-pocket limit for this plan? $3,000 per year", 1,
             "In a bad year, the most you pay for covered care in-network is $3,000.", "Important Questions table"),
    "er": V("$150 per visit, then you pay 20%", 1, "visit", "Emergency room care: $150 copay, then 20% coinsurance", 2,
            "You pay $150 at each ER visit. After your deductible, you also pay 20% of the rest."),
    "coins": V("You pay 20%", 20, "", "Coinsurance: 20%", 2, "After your deductible, the plan pays 80% and you pay 20%."),
    "doc": V("$25 per visit", 25, "visit", "Primary care visit: $25 copay", 2, "You pay $25 at each doctor visit."),
    "rx": V("$10 per prescription", 10, "", "Generic drugs (Tier 1): $10 copay", 2, "You pay $10 for each generic prescription."),
    "mh": V("$25 per visit", 25, "visit", "Outpatient mental health: $25 copay", 2, "You pay $25 per visit."),
    "max": K("Unlimited (p.2) vs $1,000,000 (p.4)", "p.2: Lifetime limit: None · p.4: Maximum benefit $1,000,000", 2,
             "The document says two different things. Check pages 2 and 4.", "Compare page 2 with page 4"),
    "pre": V("Covered", 1, "", "Pre-existing condition exclusion: None", 3, "Covered from day one."),
    "chiro": V("$25 per visit, up to 20 visits per year", 25, "visit", "Chiropractic care: $25 copay, 20 visits per year", 3,
               "You pay $25 per visit, up to 20 visits a year."),
}
FACTS["t1"] = {
    "ded": V("$100 per trip", 100, "trip", "Deductible per Period of Coverage: $100", 2,
             "You pay $100 once for the whole trip, however many illnesses."),
    "er": V("Plan pays 100% after deductible", 1, "", "Emergency Room: 100% after Deductible", 2,
            "After your $100 deductible, the plan pays the full ER bill."),
    "max": V("$250,000 per trip", 250000, "trip", "Overall Maximum Limit: $250,000 per Period of Coverage", 2,
             "The plan pays up to $250,000 in total for the trip."),
    "doc": V("Plan pays 100% after deductible", 0, "", "Physician Visits: 100% after Deductible", 2,
             "After your deductible, the plan pays the full doctor bill."),
    "evac": V("Up to $1,000,000", 1000000, "", "Emergency Evacuation: up to $1,000,000", 3,
              "The plan pays up to $1,000,000 to move you to proper care."),
    "repat": V("Up to $50,000", 50000, "", "Return of Remains / Return Home: up to $50,000", 3,
               "Up to $50,000 to bring you home after a serious illness."),
    "dent": V("Pain relief, up to $250", 250, "", "Emergency Dental: pain relief up to $250", 3,
              "Only emergency pain relief, up to $250."),
    "pre": X("Not covered", "Exclusions: pre-existing conditions", 5, "Conditions you had before the trip are not covered."),
    "mh": X("Not covered", "Exclusions: mental health care", 5, "Mental health care is not covered."),
}

PLANS = {"g1": ("globe", "Basic"), "g2": ("globe", "Gold"), "g3": ("globe", "Platinum"),
         "c1": ("campus", "Standard"), "s1": ("scholar", "Gold"), "t1": ("travel", "Standard")}
