// Strict structured-output schemas for the extraction path's model calls
// (EC-9: model output is a proposal; it is schema-checked at the client and
// then re-derived/verified by the extraction boundary). Optional fields are
// required-but-nullable, as strict structured output demands; nulls are
// removed (stripNullProperties) before the output enters the pipeline.
//
// The extraction path owns these; the RAG path must not import them.

import { FACTS } from "@/app/lib/extraction/fact-list";
import { VERDICTS } from "@/app/lib/verdicts";
import type { JsonSchema, NamedJsonSchema } from "@/app/lib/llm/json-schema";

const nullable = (type: "string" | "number" | "integer"): JsonSchema => ({ type: [type, "null"] });

const CITATION: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["documentId", "page", "quote"],
  properties: {
    documentId: { type: "string" },
    page: { type: "integer", minimum: 1 },
    quote: { type: "string" },
  },
};

/** Recognized qualifier keys only (derived-only keys are never model-set). */
const QUALIFIERS: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["networkTier", "period", "ageBand", "conditions", "planTier", "currency", "ageMin", "ageMax", "amount", "frequency"],
  properties: {
    networkTier: nullable("string"),
    period: nullable("string"),
    ageBand: nullable("string"),
    conditions: nullable("string"),
    planTier: nullable("string"),
    currency: nullable("string"),
    ageMin: nullable("integer"),
    ageMax: nullable("integer"),
    amount: nullable("number"),
    frequency: nullable("string"),
  },
};

const VALUE: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["documentId", "planId", "display", "qualifiers", "evidence"],
  properties: {
    documentId: { type: "string" },
    planId: nullable("string"),
    display: { type: "string" },
    qualifiers: QUALIFIERS,
    evidence: { type: "array", items: CITATION },
  },
};

const ROW: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["factName", "verdict", "rationale", "values"],
  properties: {
    factName: { type: "string", enum: FACTS.map((f) => f.name) },
    verdict: { type: "string", enum: [...VERDICTS] },
    rationale: nullable("string"),
    values: { type: "array", items: VALUE },
  },
};

const PLAN: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["planId", "name", "policyIdentifier", "issuer", "sources"],
  properties: {
    planId: { type: "string" },
    name: { type: "string" },
    policyIdentifier: nullable("string"),
    issuer: nullable("string"),
    sources: { type: "array", items: CITATION },
  },
};

export const COMPARISON_TABLE_SCHEMA: NamedJsonSchema = {
  name: "comparison_table_v1",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "factListVersion", "documents", "plans", "rows"],
    properties: {
      schemaVersion: { type: "string", enum: ["v1"] },
      factListVersion: { type: "string" },
      documents: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["documentId", "filename", "pageCount"],
          properties: { documentId: { type: "string" }, filename: { type: "string" }, pageCount: { type: "integer" } },
        },
      },
      plans: { type: ["array", "null"], items: PLAN },
      rows: { type: "array", items: ROW },
    },
  },
};

export const PRESENTATION_GROUPS_SCHEMA: NamedJsonSchema = {
  name: "presentation_groups_v1",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["groups"],
    properties: {
      groups: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "factNames"],
          properties: { title: { type: "string" }, factNames: { type: "array", items: { type: "string" } } },
        },
      },
    },
  },
};
