"""Progressive, multi-engine document recovery under deterministic verification.

Readers and models *propose* table facts; ``app.reconcile`` alone decides what is
verified, by finding each proposal printed in the PDF's own text layer under its row
label and column header. Agreement between engines, model confidence and vote counts
never count as evidence.

Stages (each runs only where the previous ones left gaps):
1. OpenDataLoader, every page (native Java pass).
2. Docling, through OpenDataLoader's hybrid backend, on gap pages only.
3. pdfplumber's table finder on remaining gap pages (independent text and coordinates
   are always used: they are the verifier's source of truth).
4. Nemotron (text only) proposes facts from the independent page text of gap pages.
5. Claude reads the original gap pages (page-subset PDF) and proposes facts.
6. Reconcile everything; return verified facts and explicit unresolved states.
"""
