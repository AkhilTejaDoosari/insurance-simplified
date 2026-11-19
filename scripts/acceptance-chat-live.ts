// Live chat acceptance against two local brochures (paid LLM; owner approval each run).
// The script names and quotes licensed brochures, so its body lives in
// REAL_FIXTURES_DIR/scripts/acceptance-chat-live.ts (never committed); this entry point
// prints SKIP without it.
// Usage: REAL_FIXTURES_DIR=… BASE_URL=http://localhost:3334 npx tsx scripts/acceptance-chat-live.ts
import { runRealScript } from "./real-script";

runRealScript("acceptance-chat-live.ts");
