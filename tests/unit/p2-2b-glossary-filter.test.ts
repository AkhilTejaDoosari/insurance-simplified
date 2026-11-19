// P2.2-B: glossary / table-of-contents lines are dropped from the final display after Stage E.
// Real-document suite: its passages, labels and file names are licensed
// source text, kept in REAL_FIXTURES_DIR/tests/unit/p2-2b-glossary-filter.test.ts (never committed).
// Without REAL_FIXTURES_DIR this reports SKIPPED, never a pass.
import { realSuite } from "@/tests/real-fixtures";

await realSuite("unit/p2-2b-glossary-filter.test.ts");
