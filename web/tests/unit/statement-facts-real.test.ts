// Enrollment-scoped statements on a real brochure page (p17): scope,
// citation and section rules. Real-document suite: its page text is licensed
// source text, kept in REAL_FIXTURES_DIR/tests/unit/statement-facts-real.test.ts
// (never committed). Without REAL_FIXTURES_DIR this reports SKIPPED.
import { realSuite } from "@/tests/real-fixtures";

await realSuite("unit/statement-facts-real.test.ts");
