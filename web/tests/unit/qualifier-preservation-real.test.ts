// A wrapped enrollment-scoped statement on a real brochure page keeps its full
// scope through presentation. Real-document suite: kept in
// REAL_FIXTURES_DIR/tests/unit/qualifier-preservation-real.test.ts (never
// committed). Without REAL_FIXTURES_DIR this reports SKIPPED.
import { realSuite } from "@/tests/real-fixtures";

await realSuite("unit/qualifier-preservation-real.test.ts");
