// Runtime validator for the JSON-Schema subset used to constrain model output
// (strict structured outputs). The same schema object is sent to the provider
// (`response_format: json_schema`, honoured by OpenAI-compatible endpoints and
// local runtimes such as Ollama) and checked here on every response: a
// provider that ignores the constraint cannot smuggle an off-schema payload
// past the client. No dependency; no coercion; any violation rejects.
//
// Supported keywords: type (one or a list), properties, required,
// additionalProperties (false or a schema), items, enum, minItems, minLength,
// minimum, maximum. Unknown keywords are rejected when the schema is
// compiled, so a schema can never silently validate less than it says.

export type JsonType = "object" | "array" | "string" | "number" | "integer" | "boolean" | "null";

export interface JsonSchema {
  type?: JsonType | JsonType[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
  enum?: readonly (string | number | boolean | null)[];
  minItems?: number;
  minLength?: number;
  minimum?: number;
  maximum?: number;
  description?: string;
}

/** A named schema as sent in `response_format.json_schema`. */
export interface NamedJsonSchema {
  name: string;
  schema: JsonSchema;
}

const KNOWN_KEYWORDS = new Set([
  "type", "properties", "required", "additionalProperties", "items", "enum",
  "minItems", "minLength", "minimum", "maximum", "description",
]);

/** Throws when the schema uses a keyword this validator does not enforce. */
export function assertSupportedSchema(schema: JsonSchema, path = "$"): void {
  for (const key of Object.keys(schema)) {
    if (!KNOWN_KEYWORDS.has(key)) throw new Error(`Unsupported JSON-schema keyword "${key}" at ${path}`);
  }
  for (const [name, child] of Object.entries(schema.properties ?? {})) assertSupportedSchema(child, `${path}.${name}`);
  if (typeof schema.additionalProperties === "object") assertSupportedSchema(schema.additionalProperties, `${path}.*`);
  if (schema.items) assertSupportedSchema(schema.items, `${path}[]`);
}

function typeOf(value: unknown): JsonType | "undefined" | "other" {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  switch (typeof value) {
    case "string": return "string";
    case "boolean": return "boolean";
    case "number": return Number.isFinite(value) ? (Number.isInteger(value) ? "integer" : "number") : "other";
    case "object": return "object";
    case "undefined": return "undefined";
    default: return "other";
  }
}

function typeMatches(actual: ReturnType<typeof typeOf>, expected: JsonType): boolean {
  return actual === expected || (expected === "number" && actual === "integer");
}

/** Every violation of `schema` by `value` (empty when valid). */
export function validateJsonSchema(schema: JsonSchema, value: unknown, path = "$"): string[] {
  const errors: string[] = [];
  const actual = typeOf(value);
  if (schema.type !== undefined) {
    const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!allowed.some((t) => typeMatches(actual, t))) {
      return [`${path}: expected ${allowed.join("|")}, got ${actual}`];
    }
  }
  if (schema.enum && !schema.enum.some((option) => option === value)) {
    errors.push(`${path}: value not in enum`);
  }
  if (actual === "string") {
    if (schema.minLength !== undefined && (value as string).length < schema.minLength) errors.push(`${path}: shorter than ${schema.minLength}`);
  }
  if (actual === "integer" || actual === "number") {
    if (schema.minimum !== undefined && (value as number) < schema.minimum) errors.push(`${path}: below ${schema.minimum}`);
    if (schema.maximum !== undefined && (value as number) > schema.maximum) errors.push(`${path}: above ${schema.maximum}`);
  }
  if (actual === "array") {
    const items = value as unknown[];
    if (schema.minItems !== undefined && items.length < schema.minItems) errors.push(`${path}: fewer than ${schema.minItems} items`);
    if (schema.items) items.forEach((item, i) => errors.push(...validateJsonSchema(schema.items!, item, `${path}[${i}]`)));
  }
  if (actual === "object") {
    const record = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(record, key)) errors.push(`${path}.${key}: required`);
    }
    for (const [key, child] of Object.entries(record)) {
      const declared = schema.properties?.[key];
      if (declared) errors.push(...validateJsonSchema(declared, child, `${path}.${key}`));
      else if (schema.additionalProperties === false) errors.push(`${path}.${key}: not allowed`);
      else if (typeof schema.additionalProperties === "object") errors.push(...validateJsonSchema(schema.additionalProperties, child, `${path}.${key}`));
    }
  }
  return errors;
}

/** Remove properties whose value is null, recursively (strict structured
 *  output expresses an optional field as a required nullable one; the
 *  application's own contracts use absence). Arrays keep their items. */
export function stripNullProperties(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripNullProperties);
  if (typeof value !== "object" || value === null) return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (child === null) continue;
    out[key] = stripNullProperties(child);
  }
  return out;
}
