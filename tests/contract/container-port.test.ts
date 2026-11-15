import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("container listener contract", () => {
  it("routes the published port and health probe to the npm start listener", () => {
    const { scripts } = JSON.parse(readFileSync("package.json", "utf8"));
    const listener = Number(scripts.start.match(/(?:-p|--port)\s+(\d+)/)?.[1]);
    expect(listener).toBeGreaterThan(0);

    const dockerfile = readFileSync("Dockerfile", "utf8");
    const exposed = Number(dockerfile.match(/^EXPOSE\s+(\d+)$/m)?.[1]);
    expect(exposed).toBe(listener);

    const compose = readFileSync("docker-compose.yml", "utf8");
    const published = compose.match(/"127\.0\.0\.1:(\d+):(\d+)"/);
    expect(published).not.toBeNull();
    expect(Number(published?.[1])).toBe(listener);
    expect(Number(published?.[2])).toBe(listener);
    const healthUrl = compose.match(/"(http:\/\/localhost:\d+\/api\/health)"/)?.[1];
    expect(healthUrl).toBeDefined();
    expect(Number(new URL(healthUrl!).port)).toBe(listener);
  });
});
