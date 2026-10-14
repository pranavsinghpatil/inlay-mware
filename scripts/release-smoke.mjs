import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";

// Exercise the shipped CLI without credentials or a provider connection.
const reservation = createServer();
reservation.listen(0, "127.0.0.1");
await once(reservation, "listening");
const { port } = reservation.address();
await new Promise((resolve, reject) => reservation.close((error) => error ? reject(error) : resolve()));
const env = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith("INLAY_")) delete env[key];
Object.assign(env, { INLAY_HOST: "127.0.0.1", INLAY_PORT: String(port), INLAY_OBSERVATION: "off" });
const child = spawn(process.execPath, ["--experimental-strip-types", "src/server.ts"], {
  cwd: process.cwd(), env, stdio: "ignore", windowsHide: true,
});
const closed = new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("close", (code, signal) => resolve({ code, signal }));
});
const base = "http://127.0.0.1:" + port;
const read = async (path) => {
  const response = await fetch(base + path, { signal: AbortSignal.timeout(1_000) });
  return { status: response.status, value: await response.json() };
};
try {
  const deadline = performance.now() + 10_000;
  let health;
  while (performance.now() < deadline) {
    if (child.exitCode !== null) throw new Error("Release CLI exited before readiness.");
    try { health = await read("/health"); break; }
    catch { await new Promise((resolve) => setTimeout(resolve, 25)); }
  }
  assert.ok(health, "Release CLI startup watchdog expired.");
  assert.equal(health.status, 200);
  assert.deepEqual(health.value, { status: "ok", upstreamConfigured: false, mode: "transparent" });
  const dashboard = await fetch(base + "/dashboard", { signal: AbortSignal.timeout(1_000) });
  assert.equal(dashboard.status, 200);
  assert.match(await dashboard.text(), /Local observation/);
  const asset = await fetch(base + "/dashboard/app.js", { signal: AbortSignal.timeout(1_000) });
  assert.equal(asset.status, 200);
  assert.match(await asset.text(), /\/dashboard\/data/);
  const view = await read("/dashboard/data");
  assert.equal(view.value.current.totals.outcomes, 0);
  assert.equal(view.value.current.totals.usage.inputTokens.sum, null);
  assert.equal(view.value.history.status, "off");
  const idle = await read("/metrics");
  assert.equal(idle.status, 200);
  assert.equal(idle.value.totalRequests, 0);
  assert.deepEqual(idle.value.exchangeLifecycle, {
    admitted: 0, active: 0, forwarding: 0, finalized: 0,
    availability: "AVAILABLE", incomplete: false, unavailableReason: null,
  });
  const response = await fetch(base + "/v1/responses", {
    method: "POST", body: "{}", signal: AbortSignal.timeout(1_000),
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "inlay_upstream_not_configured");
  const settled = await read("/metrics");
  assert.equal(settled.value.totalRequests, 0);
  assert.deepEqual(settled.value.exchangeLifecycle, {
    admitted: 1, active: 0, forwarding: 0, finalized: 1,
    availability: "AVAILABLE", incomplete: false, unavailableReason: null,
  });
} finally {
  child.kill();
  await closed;
}
console.log(JSON.stringify({ releaseStartup: "PASS", observation: "off", providerRequests: 0 }));
