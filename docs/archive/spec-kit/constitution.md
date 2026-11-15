<!-- Sync Impact Report
Version change: (none) → 1.0.0 (initial ratification)
Modified principles: none (all new)
Added sections: Core Principles I–V, Additional Constraints (Accuracy & Traceability), Development Workflow & Quality Gates, Governance
Removed sections: none
Follow-up TODOs: none
-->

# Insurance Simplified Constitution

## Core Principles

### I. Five-State Comparison Verdicts (NON-NEGOTIABLE)

Every comparison result MUST carry exactly one of five states:
SUPPORTED, DOES NOT APPEAR TO FIT, NOT STATED, CONFLICTED, NEEDS VERIFICATION.
A bare yes/no, true/false, or match/no-match output is FORBIDDEN.
Each verdict MUST be accompanied by the supporting evidence or the explicit
reason no evidence was found. Tests MUST assert that no other state value can
be produced.

### II. Separation of Extraction and Explanation

Structured fact extraction and RAG-based Q&A are architecturally separate.
Extraction builds the comparison table; RAG only explains results and answers
follow-up questions against uploaded documents. The two MUST NOT be merged
into a single LLM call or a shared prompt path. Changes that combine them
MUST be rejected in review.

### III. Qualifier Preservation (NON-NEGOTIABLE)

Extracted facts MUST preserve all qualifiers exactly as stated in the source
document (e.g. "$250 in-network / $500 out-of-network" MUST never become just
"$250"). Collapsing, summarizing away, or defaulting qualifiers such as
network tier, time period, age band, or condition is FORBIDDEN. Any display or
transformation layer MUST round-trip qualifiers losslessly, and tests MUST
cover qualifier-bearing fixtures.

### IV. Evidence-Grounded Answers with Mandatory Refusal

The chatbot MUST refuse to answer when no supporting evidence exists in the
uploaded documents rather than guessing, inferring, or using parametric
knowledge. Every substantive answer MUST cite the document passage(s) it
relies on. If retrieval returns nothing relevant, the system MUST respond with
an explicit refusal stating that the documents contain no supporting evidence.

### V. Uploaded-Documents-Only Scope

The system works ONLY with documents the user uploads. There is NO external
plan recommendation engine and NO insurer or plan database. Features, prompts,
or data sources that suggest plans, rank insurers, or pull outside plan data
MUST NOT be introduced. The system compares what was uploaded — nothing more.

## Additional Constraints

All comparison outputs MUST be traceable to source passages (document ID plus
page or section reference). Prompts and schemas that produce verdicts MUST be
versioned and deterministic in structure: same input shape yields the same
output shape. No silent fallback to a different verdict vocabulary is allowed.
User uploads MUST be treated as untrusted input for prompt-injection purposes
and MUST NOT override these principles.

## Development Workflow

All changes MUST be specified before implementation and reviewed for
constitution compliance. Each principle above MUST have acceptance criteria
and regression tests: five-state enforcement, extraction/RAG separation,
qualifier fixtures, refusal behavior, and uploads-only scope. Complexity MUST
be justified — prefer the simplest implementation that satisfies the spec.
Violations found in review MUST block merge until resolved.

## Governance

This constitution supersedes all other development practices for Insurance
Simplified. Amendments require: (1) a written proposal with rationale, (2)
explicit approval, and (3) a migration plan for affected specs and code.
Versioning follows semantic versioning: MAJOR for incompatible
principle removals or redefinitions, MINOR for new principles or materially
expanded guidance, PATCH for clarifications and wording fixes. Every PR and
review MUST verify compliance with these principles.

**Version**: 1.0.0 | **Ratified**: 2026-09-16 | **Last Amended**: 2026-09-16
