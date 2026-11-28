// The one HTTP call from the web service to the engine. Server-side only.
//
// Node's built-in fetch gives up waiting for response headers after 300 s (its HTTP
// client's own default), whatever AbortSignal is passed. A document the engine reads with
// models can take longer, so this uses node:http(s) with one explicit deadline instead:
// the engine's own per-document limit plus a margin (ENGINE_READ_TIMEOUT_MS). When it is
// hit the request is cancelled and the caller gets EngineError(504, "ENGINE_TIMEOUT").

import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

/** The engine stops starting new stages after 900 s per document (engine
 *  RunLimits.max_seconds); an in-flight model call may still finish. Wait that long plus
 *  a margin, then stop with a clear message. */
export const ENGINE_LIMIT_S = 900;
export const ENGINE_READ_TIMEOUT_MS = (ENGINE_LIMIT_S + 60) * 1000;

export class EngineError extends Error {
  constructor(public readonly status: number, public readonly code: string) {
    super(`engine ${status} ${code}`);
  }
}

export interface EngineRequest {
  headers: Record<string, string>;
  body: Uint8Array;
  timeoutMs: number;
}

export interface EngineResponse {
  status: number;
  json(): Promise<unknown>;
}

export function postToEngine(url: string, init: EngineRequest): Promise<EngineResponse> {
  const target = new URL(url);
  const send = target.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const req = send(
      target,
      { method: "POST", headers: { ...init.headers, "content-length": String(init.body.byteLength) } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("error", () => finish(() => reject(new EngineError(502, "ENGINE_UNREACHABLE"))));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          finish(() =>
            resolve({
              status: res.statusCode ?? 502,
              json: async () => JSON.parse(text) as unknown,
            }),
          );
        });
      },
    );
    const timer = setTimeout(() => {
      finish(() => reject(new EngineError(504, "ENGINE_TIMEOUT")));
      req.destroy();
    }, init.timeoutMs);
    req.on("error", () => finish(() => reject(new EngineError(502, "ENGINE_UNREACHABLE"))));
    req.end(Buffer.from(init.body));
  });
}
