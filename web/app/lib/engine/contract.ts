// Engine contract types for the web app (generated from contracts/openapi.json).
// Never edit contract.gen.ts by hand: run `npm run contract:types` after the
// engine contract changes. Only these aliases are imported elsewhere.
import type { components } from "./contract.gen";

type Schemas = components["schemas"];

export type EngineFact = Schemas["Fact"];
export type EngineFactState = Schemas["FactState"];
export type EngineBasis = Schemas["Basis"];
export type EngineComparison = Schemas["Comparison"];
export type EngineMatchScore = Schemas["MatchScore"];
export type EngineChatAnswer = Schemas["ChatAnswer"];
export type EngineChatRoute = Schemas["ChatRoute"];
export type EngineJob = Schemas["Job"];
export type EngineJobState = Schemas["JobState"];
export type EnginePlanFamily = Schemas["PlanFamily"];
export type EngineContact = Schemas["Contact"];
export type EngineDocument = Schemas["Document"];

/** Plain-words labels for the five states. Exhaustive: tsc fails if the engine adds or drops one. */
export const FACT_STATE_LABEL: Record<EngineFactState, string> = {
  verified: "Verified",
  not_covered: "Not covered",
  not_mentioned: "Not mentioned in this document",
  couldnt_confirm: "Couldn't confirm",
  conflicting: "Conflicting",
};
