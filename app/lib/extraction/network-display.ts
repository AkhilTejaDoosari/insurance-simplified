// Concise provider-network cell text. The primary comparison cell shows a
// short identity ("UnitedHealthcare PPO"); the full source line stays in
// evidence. A name is only shown when the source explicitly states one.

/** Explicit network-name shapes: capitalized name + plan/network suffix. */
const NAMED_NETWORK = new RegExp(
  "\\b([A-Z][A-Za-z&.'-]*(?:\\s+[A-Z][A-Za-z&.'-]*)*\\s+" +
    "(?:PPO|HMO|EPO|POS|HDHP|IPA|Provider Network|Provider Networks|Network|Networks|Alliance|Coalition))\\b"
);

export const NO_NAMED_NETWORK = "No named network stated";

/** Derive the concise cell text from a verbatim network display line. */
export function summarizeNetworkDisplay(display: string): string {
  const match = NAMED_NETWORK.exec(display);
  if (match) return match[1].replace(/\s+/g, " ").trim();
  return NO_NAMED_NETWORK;
}
