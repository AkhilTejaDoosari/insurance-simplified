// Real-PDF regression for column-scoped table claims.
// Real-document suite: its passages, labels and file names are licensed
// source text, kept in REAL_FIXTURES_DIR/tests/unit/real-table-attribution.test.ts (never committed).
// Without REAL_FIXTURES_DIR this reports SKIPPED, never a pass.
import { realSuite } from "@/tests/real-fixtures";

await realSuite("unit/real-table-attribution.test.ts");
