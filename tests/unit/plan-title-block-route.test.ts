// P2.1 route-level proof: enrollment scope survives validation, Stage E and presentation.
// Real-document suite: its passages, labels and file names are licensed
// source text, kept in REAL_FIXTURES_DIR/tests/unit/plan-title-block-route.test.ts (never committed).
// Without REAL_FIXTURES_DIR this reports SKIPPED, never a pass.
import { realSuite } from "@/tests/real-fixtures";

await realSuite("unit/plan-title-block-route.test.ts");
