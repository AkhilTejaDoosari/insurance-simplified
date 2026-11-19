// Governing table notes on a real brochure (gold provisions written by hand
// from the source PDF). Real-document suite: kept in
// REAL_FIXTURES_DIR/tests/unit/table-governing-notes-real.test.ts (never
// committed). Without REAL_FIXTURES_DIR this reports SKIPPED.
import { realSuite } from "@/tests/real-fixtures";

await realSuite("unit/table-governing-notes-real.test.ts");
