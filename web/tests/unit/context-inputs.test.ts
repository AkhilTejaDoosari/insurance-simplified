import { describe, expect, it } from "vitest";
import {
  combineLocation,
  resolveVisaOrStatus,
  VISA_NOT_APPLICABLE,
  VISA_OTHER,
} from "@/app/components/ContextInputs";

describe("combineLocation", () => {
  it("joins city and ZIP with a comma", () => {
    expect(combineLocation({ city: "Cleveland", zip: "44118" })).toBe("Cleveland, 44118");
  });
  it("returns whichever part is present when the other is blank", () => {
    expect(combineLocation({ city: "Cleveland", zip: "  " })).toBe("Cleveland");
    expect(combineLocation({ zip: "44118" })).toBe("44118");
    expect(combineLocation({})).toBe("");
  });
  it("trims surrounding whitespace", () => {
    expect(combineLocation({ city: " Cleveland ", zip: " 44118 " })).toBe("Cleveland, 44118");
  });
});

describe("resolveVisaOrStatus", () => {
  it("returns the selected category", () => {
    expect(resolveVisaOrStatus({ visaOrStatus: "F-1 OPT" })).toBe("F-1 OPT");
  });
  it("treats 'Not applicable' and unset as empty", () => {
    expect(resolveVisaOrStatus({ visaOrStatus: VISA_NOT_APPLICABLE })).toBe("");
    expect(resolveVisaOrStatus({})).toBe("");
  });
  it("uses the free-text value when 'Other' is selected", () => {
    expect(
      resolveVisaOrStatus({ visaOrStatus: VISA_OTHER, visaOrStatusOther: " TN " }),
    ).toBe("TN");
    expect(resolveVisaOrStatus({ visaOrStatus: VISA_OTHER })).toBe("");
  });
});
