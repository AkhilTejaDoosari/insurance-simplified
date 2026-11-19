// Plan identity for one insurer-specific product-title shape. The recognizer
// for it is a named-insurer special case in plan-identity.ts, so the case can
// only be stated with the real insurer name; it is kept in
// REAL_FIXTURES_DIR/tests/unit/plan-identity-insurer-title.test.ts (never
// committed). Without REAL_FIXTURES_DIR this reports SKIPPED.
import { realSuite } from "@/tests/real-fixtures";

await realSuite("unit/plan-identity-insurer-title.test.ts");
