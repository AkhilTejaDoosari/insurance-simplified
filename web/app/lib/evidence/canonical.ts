// Canonical content encoding + keyed seals for the evidence core
// (evidence-core.md §4: sealed provisions, issued resolutions, AT-PERSIST).
//
// A seal is an HMAC-SHA256 over the canonical JSON of an object's content,
// keyed by an `EvidenceAuthority`. A plain hash would detect accidental change
// but not deliberate forgery (anyone can recompute it), so the authority key
// is what makes a seal mean "issued here, unchanged since".
//
// Authority is in-process and request-scoped: construct one per request (or
// per pipeline run) — never as a module global. Anything read back from the
// database under a different key fails `verify` and must be re-derived
// (AT-PERSIST); it never silently regains authority.

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Deterministic JSON: object keys sorted, `undefined` properties omitted
 *  (JSON semantics). Rejects values JSON cannot represent faithfully, so two
 *  different contents can never share an encoding. */
export function canonicalJson(value: unknown): string {
  return encode(value);
}

function encode(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) throw new Error("canonicalJson: non-finite number");
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? "null" : encode(v))).join(",")}]`;
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) throw new Error("canonicalJson: only plain objects");
      const entries = Object.keys(value as Record<string, unknown>)
        .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
        .sort()
        .map((k) => `${JSON.stringify(k)}:${encode((value as Record<string, unknown>)[k])}`);
      return `{${entries.join(",")}}`;
    }
    default:
      throw new Error(`canonicalJson: unsupported ${typeof value}`);
  }
}

/** Hex sha256 of canonical content. A content digest, not an authority. */
export function contentDigest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

/** Hex sha256 of raw bytes (registered document identity). */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export interface Seal {
  /** Seal format version. */
  v: 1;
  /** Domain separation: what kind of object this seal covers. */
  purpose: SealPurpose;
  /** sha256 over the canonical content (diagnostic; not the authority). */
  digest: string;
  /** HMAC-SHA256(authority key, purpose ‖ canonical content). */
  mac: string;
}

export type SealPurpose = "provision" | "resolution";

/** Holder of the sealing key. Seals verify only under the authority that
 *  issued them. Construct per request; pass an explicit key only when a
 *  durable server-side secret is configured (store-side seal, AT-PERSIST). */
export class EvidenceAuthority {
  readonly #key: Buffer;

  constructor(key?: Uint8Array) {
    if (key !== undefined && key.byteLength < 32) throw new Error("EvidenceAuthority: key must be >= 32 bytes");
    this.#key = key ? Buffer.from(key) : randomBytes(32);
  }

  seal(purpose: SealPurpose, content: unknown): Seal {
    const canonical = canonicalJson(content);
    return {
      v: 1,
      purpose,
      digest: createHash("sha256").update(canonical, "utf8").digest("hex"),
      mac: this.#mac(purpose, canonical),
    };
  }

  /** True only when `seal` was produced by this authority for exactly this
   *  purpose and content. Any malformed seal is false (fail closed). */
  verify(purpose: SealPurpose, content: unknown, seal: unknown): boolean {
    if (!seal || typeof seal !== "object") return false;
    const s = seal as Partial<Seal>;
    if (s.v !== 1 || s.purpose !== purpose || typeof s.mac !== "string" || typeof s.digest !== "string") return false;
    let canonical: string;
    try {
      canonical = canonicalJson(content);
    } catch {
      return false;
    }
    const expected = Buffer.from(this.#mac(purpose, canonical), "hex");
    const presented = Buffer.from(s.mac, "hex");
    if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) return false;
    return s.digest === createHash("sha256").update(canonical, "utf8").digest("hex");
  }

  #mac(purpose: SealPurpose, canonical: string): string {
    return createHmac("sha256", this.#key).update(`${purpose}\u0000${canonical}`, "utf8").digest("hex");
  }
}

/** Recursively freeze a plain value (returned store objects are read-only). */
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  }
  return value;
}

/** Structured clone of plain JSON-like data (no shared references). */
export function clonePlain<T>(value: T): T {
  return JSON.parse(canonicalJson(value)) as T;
}
