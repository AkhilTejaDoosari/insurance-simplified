import { describe, expect, it } from "vitest";
import { VERDICTS, assertVerdict, isVerdict } from "@/app/lib/verdicts";

describe("closed five-state verdict enum (constitution principle I)", () => {
  it("accepts exactly the five allowed states", () => {
    expect(VERDICTS).toEqual([
      "SUPPORTED",
      "DOES NOT APPEAR TO FIT",
      "NOT STATED",
      "CONFLICTED",
      "NEEDS VERIFICATION",
    ]);
    for (const v of VERDICTS) {
      expect(isVerdict(v)).toBe(true);
      expect(assertVerdict(v)).toBe(v);
    }
  });

  it("rejects bare yes/no and boolean-style verdicts", () => {
    for (const bad of [
      "yes",
      "no",
      "true",
      "false",
      "match",
      "no-match",
      "YES",
      "supported",
      "",
      null,
      undefined,
      0,
      1,
    ]) {
      expect(isVerdict(bad)).toBe(false);
      expect(() => assertVerdict(bad)).toThrow();
    }
  });
});
