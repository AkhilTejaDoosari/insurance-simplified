// PDF export acceptance against two local brochures.
// The script names and quotes licensed brochures, so its body lives in
// REAL_FIXTURES_DIR/scripts/acceptance-pdf-export.ts (never committed); this entry point
// prints SKIP without it.
// Usage: REAL_FIXTURES_DIR=… BASE_URL=http://localhost:3334 npx tsx scripts/acceptance-pdf-export.ts
import { runRealScript } from "./real-script";

runRealScript("acceptance-pdf-export.ts");
