// C6 safety hardening (Option B, abstention-only): a real-document regression
// suite. Its passages are verbatim licensed brochure text, so the cases live
// in REAL_FIXTURES_DIR/tests/unit/c6-safety-hardening.test.ts (never committed)
// and this suite reports SKIPPED without them.
import { realSuite } from "@/tests/real-fixtures";

await realSuite("unit/c6-safety-hardening.test.ts");
