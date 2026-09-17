"use client";

// Shared context inputs for the upload form and the no-documents checklist
// flow. The API contract is unchanged: parents combine the two date inputs
// into the single `coverageDates` string via combineCoverageDates, the
// city/ZIP inputs into `location` via combineLocation, and resolve the visa
// dropdown (plus its "Other" free-text) into `visaOrStatus` via
// resolveVisaOrStatus.

const COUNTRIES = [
  "United States",
  "Australia",
  "Belgium",
  "Brazil",
  "Canada",
  "China",
  "Denmark",
  "Egypt",
  "Finland",
  "France",
  "Germany",
  "Greece",
  "India",
  "Indonesia",
  "Ireland",
  "Israel",
  "Italy",
  "Japan",
  "Kenya",
  "Malaysia",
  "Mexico",
  "Netherlands",
  "New Zealand",
  "Nigeria",
  "Norway",
  "Philippines",
  "Poland",
  "Portugal",
  "Saudi Arabia",
  "Singapore",
  "South Africa",
  "South Korea",
  "Spain",
  "Sweden",
  "Switzerland",
  "Thailand",
  "United Arab Emirates",
  "United Kingdom",
  "Vietnam",
];

export const DEFAULT_COUNTRY = "United States";

export const VISA_NOT_APPLICABLE = "Not applicable";
export const VISA_OTHER = "Other";

const VISA_OPTIONS = [
  VISA_NOT_APPLICABLE,
  "F-1",
  "F-1 OPT",
  "F-1 STEM OPT",
  "J-1",
  "H-1B",
  "Green Card / Permanent Resident",
  "U.S. Citizen",
  VISA_OTHER,
];

// Generous cap: international postal codes can be alphanumeric and up to ~10
// characters (e.g. "SW1A 1AA", "K1A 0B1"), so we don't validate the format.
const ZIP_MAX_LENGTH = 12;

/** Combine the two date inputs into the single coverageDates context string
 *  the extraction path and checklist understand. */
export function combineCoverageDates(context: Record<string, string>): string {
  const start = (context.coverageStart ?? "").trim();
  const end = (context.coverageEnd ?? "").trim();
  if (start && end) return `${start} to ${end}`;
  return start || end;
}

/** Combine the city and ZIP inputs into the single location context string
 *  (e.g. "Cleveland, 44118"). */
export function combineLocation(context: Record<string, string>): string {
  const city = (context.city ?? "").trim();
  const zip = (context.zip ?? "").trim();
  if (city && zip) return `${city}, ${zip}`;
  return city || zip;
}

/** Resolve the visa dropdown into the visaOrStatus context string. "Not
 *  applicable" maps to empty; "Other" uses the free-text value. */
export function resolveVisaOrStatus(context: Record<string, string>): string {
  const selected = context.visaOrStatus ?? VISA_NOT_APPLICABLE;
  if (selected === VISA_NOT_APPLICABLE) return "";
  if (selected === VISA_OTHER) return (context.visaOrStatusOther ?? "").trim();
  return selected;
}

export default function ContextInputs({
  context,
  onChange,
  visaLabel = "Visa / status (if relevant)",
}: {
  context: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  visaLabel?: string;
}) {
  const set = (name: string, value: string) =>
    onChange({ ...context, [name]: value });
  const visaSelected = context.visaOrStatus ?? VISA_NOT_APPLICABLE;

  return (
    <fieldset className="fields">
      <legend>Your context (used only when documents make it relevant)</legend>
      <div className="fields__grid">
        <label className="field">
          Age
          <input
            className="input"
            value={context.age ?? ""}
            onChange={(e) => set("age", e.target.value)}
          />
        </label>
        <label className="field">
          Country / residency
          <select
            className="select"
            value={context.countryOrResidency ?? DEFAULT_COUNTRY}
            onChange={(e) => set("countryOrResidency", e.target.value)}
          >
            {COUNTRIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          {visaLabel}
          <select
            className="select"
            value={visaSelected}
            onChange={(e) => set("visaOrStatus", e.target.value)}
          >
            {VISA_OPTIONS.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
        {visaSelected === VISA_OTHER && (
          <label className="field">
            Please specify
            <input
              className="input"
              value={context.visaOrStatusOther ?? ""}
              onChange={(e) => set("visaOrStatusOther", e.target.value)}
            />
          </label>
        )}
        <label className="field">
          City
          <input
            className="input"
            value={context.city ?? ""}
            onChange={(e) => set("city", e.target.value)}
          />
        </label>
        <label className="field">
          ZIP / postal code
          <input
            className="input"
            maxLength={ZIP_MAX_LENGTH}
            value={context.zip ?? ""}
            onChange={(e) => set("zip", e.target.value)}
          />
        </label>
        <label className="field">
          Coverage start date
          <input
            type="date"
            className="input"
            value={context.coverageStart ?? ""}
            onChange={(e) => set("coverageStart", e.target.value)}
          />
        </label>
        <label className="field">
          Coverage end date
          <input
            type="date"
            className="input"
            value={context.coverageEnd ?? ""}
            onChange={(e) => set("coverageEnd", e.target.value)}
          />
        </label>
      </div>
    </fieldset>
  );
}
