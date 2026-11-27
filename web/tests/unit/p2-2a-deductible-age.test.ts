// P2.2-A: calendar-year deductible detection and page-number-as-age misclassification.
// Real-document suite: its passages, labels and file names are licensed
// source text, kept in REAL_FIXTURES_DIR/tests/unit/p2-2a-deductible-age.test.ts (never committed).
// Without REAL_FIXTURES_DIR this reports SKIPPED, never a pass.
import { realSuite } from "@/tests/real-fixtures";

await realSuite("unit/p2-2a-deductible-age.test.ts");
