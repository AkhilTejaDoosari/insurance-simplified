import { describe, expect, it } from "vitest";
import {
  NO_NAMED_NETWORK,
  summarizeNetworkDisplay,
} from "@/app/lib/extraction/network-display";

describe("summarizeNetworkDisplay", () => {
  it("keeps an explicitly stated carrier + type identity", () => {
    expect(summarizeNetworkDisplay("UnitedHealthcare PPO")).toBe("UnitedHealthcare PPO");
    expect(summarizeNetworkDisplay("Plan uses the Acme Preferred Provider Network.")).toBe(
      "Acme Preferred Provider Network",
    );
  });

  it("returns the honest fallback when no name is stated", () => {
    expect(
      summarizeNetworkDisplay("International and U.S. provider networks include many physicians."),
    ).toBe(NO_NAMED_NETWORK);
    expect(summarizeNetworkDisplay("Access our proprietary IPA network here.")).toBe(
      NO_NAMED_NETWORK,
    );
  });

  it("never invents identity from descriptive prose", () => {
    const out = summarizeNetworkDisplay("U.S. Network: over 1.4M physicians and 6,797 hospitals.");
    expect(out).not.toContain("1.4M");
    expect(out).not.toContain("6,797");
  });
});
