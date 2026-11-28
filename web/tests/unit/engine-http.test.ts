import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { EngineError, ENGINE_LIMIT_S, ENGINE_READ_TIMEOUT_MS, postToEngine } from "@/app/lib/engine/http";

let server: Server | null = null;
afterEach(() => new Promise<void>((done) => (server ? server.close(() => done()) : done())));

function listen(handler: Parameters<typeof createServer>[1]): Promise<string> {
  server = createServer(handler);
  return new Promise((resolve) =>
    server!.listen(0, "127.0.0.1", () => {
      const a = server!.address();
      resolve(`http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`);
    }),
  );
}

describe("web -> engine call", () => {
  it("waits the engine's own limit plus a margin (never fetch's 300 s)", () => {
    expect(ENGINE_LIMIT_S).toBe(900);
    expect(ENGINE_READ_TIMEOUT_MS).toBeGreaterThan(ENGINE_LIMIT_S * 1000);
    expect(ENGINE_READ_TIMEOUT_MS).toBeGreaterThan(300_000);
  });

  it("stops at the deadline with ENGINE_TIMEOUT", async () => {
    const url = await listen(() => undefined); // never answers
    const started = Date.now();
    await expect(
      postToEngine(`${url}/v1/extract`, { headers: {}, body: new Uint8Array([1]), timeoutMs: 150 }),
    ).rejects.toEqual(new EngineError(504, "ENGINE_TIMEOUT"));
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("a slow answer within the deadline is read normally", async () => {
    let got = "";
    const url = await listen((req, res) => {
      req.on("data", (c) => (got += String(c)));
      setTimeout(() => res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}'), 300);
    });
    const res = await postToEngine(`${url}/x`, {
      headers: { authorization: "Bearer t" },
      body: new TextEncoder().encode("%PDF"),
      timeoutMs: 5000,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(got).toBe("%PDF");
  });

  it("an engine that can't be reached is ENGINE_UNREACHABLE", async () => {
    await expect(
      postToEngine("http://127.0.0.1:1/x", { headers: {}, body: new Uint8Array(), timeoutMs: 2000 }),
    ).rejects.toEqual(new EngineError(502, "ENGINE_UNREACHABLE"));
  });
});
