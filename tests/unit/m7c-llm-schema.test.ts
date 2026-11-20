// M7 task 3: strict structured LLM output + runtime validator. The provider
// is a stubbed fetch (no network, no paid call); the env values below are
// placeholders that only satisfy the configuration check.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { completeJson, LlmSchemaError } from "@/app/lib/llm/client";
import { assertSupportedSchema, stripNullProperties, validateJsonSchema, type JsonSchema } from "@/app/lib/llm/json-schema";
import { COMPARISON_TABLE_SCHEMA, PRESENTATION_GROUPS_SCHEMA } from "@/app/lib/extraction/llm-schema";
import { extractViaLlm } from "@/app/lib/extraction/extract";
import { proposeGroups } from "@/app/lib/extraction/presentation-groups";

const QUOTE = "Annual deductible: $500 per policy year.";
const docs = [{ documentId: "doc-1", filename: "a.pdf", pageCount: 1, pages: [QUOTE] }];
const nullQualifiers = {
  networkTier: null, period: null, ageBand: null, conditions: null, planTier: null,
  currency: null, ageMin: null, ageMax: null, amount: null, frequency: null,
};
const validOutput = () => ({
  schemaVersion: "v1",
  factListVersion: "v1",
  documents: [{ documentId: "doc-1", filename: "a.pdf", pageCount: 1 }],
  plans: null,
  rows: [{
    factName: "annual-deductible",
    verdict: "SUPPORTED",
    rationale: null,
    values: [{
      documentId: "doc-1", planId: null, display: "$500 per policy year",
      qualifiers: { ...nullQualifiers }, evidence: [{ documentId: "doc-1", page: 1, quote: QUOTE }],
    }],
  }],
});
const completion = (payload: unknown) =>
  new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) }, finish_reason: "stop" }] }), { status: 200 });

describe("strict structured output (client)", () => {
  const env = { ...process.env };
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    process.env.LLM_BASE_URL = "https://llm.invalid";
    process.env.LLM_API_KEY = "placeholder";
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...env };
  });

  it("extraction requests a strict json_schema response format", async () => {
    fetchMock.mockResolvedValueOnce(completion(validOutput()));
    await extractViaLlm(docs, {});
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.response_format).toEqual({
      type: "json_schema",
      json_schema: { name: COMPARISON_TABLE_SCHEMA.name, strict: true, schema: COMPARISON_TABLE_SCHEMA.schema },
    });
  });

  it("schema-valid output is used (nullable optionals become absent)", async () => {
    fetchMock.mockResolvedValueOnce(completion(validOutput()));
    const table = await extractViaLlm(docs, {});
    const row = table.rows.find((r) => r.factName === "annual-deductible")!;
    expect(row.verdict).toBe("SUPPORTED");
    expect(row.values[0]).not.toHaveProperty("planId");
    expect(row).not.toHaveProperty("rationale");
    expect(table).not.toHaveProperty("plans");
  });

  it.each([
    ["an unknown top-level key", (o: ReturnType<typeof validOutput>) => ({ ...o, note: "x" })],
    ["a verdict outside the closed enum", (o: ReturnType<typeof validOutput>) => ({ ...o, rows: [{ ...o.rows[0], verdict: "YES" }] })],
    ["a fact outside the fact list", (o: ReturnType<typeof validOutput>) => ({ ...o, rows: [{ ...o.rows[0], factName: "free-money" }] })],
    ["a missing required field", (o: ReturnType<typeof validOutput>) => ({ ...o, rows: [{ ...o.rows[0], rationale: undefined }] })],
    ["a string page number", (o: ReturnType<typeof validOutput>) => ({ ...o, rows: [{ ...o.rows[0], values: [{ ...o.rows[0].values[0], evidence: [{ documentId: "doc-1", page: "1", quote: QUOTE }] }] }] })],
    ["a model-asserted derived qualifier", (o: ReturnType<typeof validOutput>) => ({ ...o, rows: [{ ...o.rows[0], values: [{ ...o.rows[0].values[0], qualifiers: { ...nullQualifiers, selectionStatus: "purchased" } }] }] })],
    ["a model-supplied coverage record", (o: ReturnType<typeof validOutput>) => ({ ...o, coverage: { documents: [], absences: [] } })],
  ])("rejects the whole output on %s (fail closed, nothing partially used)", async (_label, mutate) => {
    fetchMock.mockResolvedValueOnce(completion(JSON.parse(JSON.stringify(mutate(validOutput())))));
    await expect(extractViaLlm(docs, {})).rejects.toBeInstanceOf(LlmSchemaError);
  });

  it("the schema error names rule paths only, never output text", async () => {
    const leaked = { ...validOutput(), secretDocumentText: "Member SSN 000-00-0000" };
    fetchMock.mockResolvedValueOnce(completion(leaked));
    const error = (await extractViaLlm(docs, {}).catch((e: unknown) => e)) as Error;
    expect(error).toBeInstanceOf(LlmSchemaError);
    expect(error.message).not.toContain("000-00-0000");
  });

  it("presentation grouping requests and enforces its own schema", async () => {
    fetchMock.mockResolvedValueOnce(completion({ groups: [{ title: "Costs", factNames: ["annual-deductible"], extra: 1 }] }));
    await expect(proposeGroups({ rows: [], filenames: [], userContext: {} })).rejects.toBeInstanceOf(LlmSchemaError);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).response_format.json_schema.name).toBe(PRESENTATION_GROUPS_SCHEMA.name);
  });

  it("a schema-constrained call does not unwrap provider envelopes", async () => {
    fetchMock.mockResolvedValueOnce(completion({ name: "answer", type: "json_object", content: JSON.stringify({ groups: [] }) }));
    await expect(completeJson([{ role: "user", content: "x" }], "m", { schema: PRESENTATION_GROUPS_SCHEMA })).rejects.toBeInstanceOf(LlmSchemaError);
  });
});

describe("runtime JSON-schema validator", () => {
  const schema: JsonSchema = {
    type: "object", additionalProperties: false, required: ["a", "b"],
    properties: { a: { type: "integer", minimum: 1 }, b: { type: ["string", "null"], enum: ["x", null] }, c: { type: "array", items: { type: "string" }, minItems: 1 } },
  };
  it.each([
    [{ a: 1, b: "x" }, 0],
    [{ a: 1, b: null, c: ["y"] }, 0],
    [{ a: 0, b: "x" }, 1],
    [{ a: 1.5, b: "x" }, 1],
    [{ a: 1 }, 1],
    [{ a: 1, b: "z" }, 1],
    [{ a: 1, b: "x", d: true }, 1],
    [{ a: 1, b: "x", c: [] }, 1],
    [{ a: 1, b: "x", c: [2] }, 1],
    [[], 1],
    [null, 1],
  ])("%j → %i violation(s)", (value, count) => {
    expect(validateJsonSchema(schema, value)).toHaveLength(count);
  });

  it("refuses a schema keyword it does not enforce", () => {
    expect(() => assertSupportedSchema({ type: "string", pattern: "^x$" } as unknown as JsonSchema)).toThrow(/Unsupported/);
    expect(() => assertSupportedSchema(COMPARISON_TABLE_SCHEMA.schema)).not.toThrow();
  });

  it.each([
    ['{"a":1,"b":"x","__proto__":{"polluted":1}}'],
    ['{"a":1,"b":"x","constructor":{"prototype":{}}}'],
    ['{"a":1,"b":"x","toString":"y"}'],
    ['{"a":1,"b":"x","prototype":1}'],
  ])("rejects prototype-named or inherited keys in model output: %s", (json) => {
    expect(validateJsonSchema(schema, JSON.parse(json)).length).toBeGreaterThan(0);
  });

  it("rejects a prototype-named key even where additional properties are allowed", () => {
    const open: JsonSchema = { type: "object", additionalProperties: { type: "object" } };
    expect(validateJsonSchema(open, JSON.parse('{"__proto__":{"x":1}}')).length).toBeGreaterThan(0);
    expect(validateJsonSchema(open, JSON.parse('{"constructor":{}}')).length).toBeGreaterThan(0);
  });

  it("a copied output never gains a prototype or inherited fields", () => {
    const copy = stripNullProperties(JSON.parse('{"__proto__":{"polluted":1},"a":{"__proto__":{"x":2}}}')) as Record<string, unknown>;
    expect(Object.getPrototypeOf(copy)).toBe(Object.prototype);
    expect((copy as { polluted?: unknown }).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(copy.a)).toBe(Object.prototype);
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
  });

  it("strips null properties only", () => {
    expect(stripNullProperties({ a: null, b: [null, { c: null, d: 1 }] })).toEqual({ b: [null, { d: 1 }] });
  });
});
