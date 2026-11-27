// Real-document regression for ellipsis repair (also needs REAL_PDFS_DIR).
// Real-document suite: its passages, labels and file names are licensed
// source text, kept in REAL_FIXTURES_DIR/tests/integration/real-pdf-evidence.test.ts (never committed).
// Without REAL_FIXTURES_DIR this reports SKIPPED, never a pass.
import { realSuite } from "@/tests/real-fixtures";

await realSuite("integration/real-pdf-evidence.test.ts");
