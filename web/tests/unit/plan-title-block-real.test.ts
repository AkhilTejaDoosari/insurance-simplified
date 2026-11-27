// P2.1 title-block recognition on real first pages (positive, negative and
// existing-recognizer priority). Real-document suite: its page text and plan
// names are licensed source text, kept in
// REAL_FIXTURES_DIR/tests/unit/plan-title-block-real.test.ts (never committed).
// Without REAL_FIXTURES_DIR this reports SKIPPED, never a pass.
import { realSuite } from "@/tests/real-fixtures";

await realSuite("unit/plan-title-block-real.test.ts");
