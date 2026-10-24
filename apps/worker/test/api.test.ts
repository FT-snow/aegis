import assert from "node:assert/strict";
import test from "node:test";
import { buildDemoCase, createPassport } from "@aegis/kit";
import { app } from "../src/index.js";
import type { Env } from "../src/env.js";

function env(overrides: Partial<Env> = {}): Env {
  return {
    APP_ENV: "local",
    LAB_ENABLED: "false",
    ALLOWED_CHAIN_IDS: "84532",
    PASSPORT_LEDGER: {} as DurableObjectNamespace,
    SIM_RUNS: {} as DurableObjectNamespace,
    RATE_LIMITER: {} as DurableObjectNamespace,
    WALLET_ROOMS: {} as DurableObjectNamespace,
    ...overrides,
  } as Env;
}

test("health response never claims chain submission is ready without config", async () => {
  const response = await app.request("/api/health", {}, env());
  const result = await response.json() as { services: { openrouter: boolean }; chain: { submission: string; configured: boolean } };
  assert.equal(response.status, 200);
  assert.equal(result.chain.submission, "disabled-until-rpc-bundler-and-factory-are-configured");
  assert.equal(result.chain.configured, false);
  assert.equal(result.services.openrouter, false);
});

test("lab routes are disabled by default", async () => {
  const response = await app.request("/api/lab/evil-page", {}, env());
  assert.equal(response.status, 404);
});

test("self-contained passport verify endpoint reports tampering", async () => {
  const passport = createPassport(buildDemoCase("safe-payment", 1_800_000_000).input, {
    sequence: 1,
    previousHash: null,
  });
  const valid = await app.request("/api/passports/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ passport }),
  }, env());
  assert.equal(valid.status, 200);

  const tampered = structuredClone(passport);
  tampered.intent.amount = "500001";
  const invalid = await app.request("/api/passports/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ passport: tampered }),
  }, env());
  assert.equal(invalid.status, 422);
});

test("mock paid API fails closed without configured payee", async () => {
  const response = await app.request("/api/x402/food", {}, env());
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "X402_RECEIVER_NOT_CONFIGURED" });
});

test("CORS preflight allows the local dashboard origin", async () => {
  const response = await app.request("/api/health", {
    method: "OPTIONS",
    headers: { Origin: "http://localhost:5173" },
  }, env());
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "http://localhost:5173");
  assert.equal(response.headers.get("Access-Control-Allow-Credentials"), "true");
  assert.equal(response.headers.get("Access-Control-Allow-Headers"), "Content-Type,X-CSRF-Token");
});

test("CORS preflight withholds credentials for unknown origins", async () => {
  const response = await app.request("/api/health", {
    method: "OPTIONS",
    headers: { Origin: "https://evil.example" },
  }, env());
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
  assert.equal(response.headers.get("Access-Control-Allow-Credentials"), null);
});

test("gateway requires an authenticated agent before chain evaluation", async () => {
  const response = await app.request("/api/gateway/intent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      intentId: "test-intent-1",
      recipient: "0x0000000000000000000000000000000000000011",
      amount: "1",
    }),
  }, env({
    RATE_LIMITER: {
      idFromName: () => "rate-id",
      get: () => ({ fetch: async () => Response.json({ allowed: true }) }),
    } as unknown as DurableObjectNamespace,
  }));
  assert.equal(response.status, 401);
  assert.equal((await response.json() as { error: string }).error, "AGENT_AUTH_REQUIRED");
});

test("simulation endpoint is rate limited per IP", async () => {
  let allowed = false;
  const limiterStub = {
    idFromName: () => "rate-id",
    get: () => ({ fetch: async () => Response.json({ allowed }) }),
  } as unknown as DurableObjectNamespace;
  const simStub = {
    newUniqueId: () => "sim-id",
    get: () => ({ fetch: async () => Response.json({ ok: true }, { status: 201 }) }),
  } as unknown as DurableObjectNamespace;
  const response = await app.request("/api/sim/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ seed: 1, days: 2 }),
  }, env({ RATE_LIMITER: limiterStub, SIM_RUNS: simStub }));
  assert.equal(response.status, 429);
  allowed = true;
  const allowedResponse = await app.request("/api/sim/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ seed: 1, days: 2 }),
  }, env({ RATE_LIMITER: limiterStub, SIM_RUNS: simStub }));
  assert.equal(allowedResponse.status, 201);
});

test("simulation rejects attack ticks beyond the run horizon", async () => {
  const response = await app.request("/api/sim/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ seed: 1, days: 2, attackTicks: [5] }),
  }, env());
  assert.equal(response.status, 400);
});

test("agent UserOperation relay requires its agent credential", async () => {
  const response = await app.request("/api/gateway/intent/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      intentId: "intent-01",
      userOperation: {
        sender: "0x0000000000000000000000000000000000000001",
        nonce: "0x0",
        callData: "0x",
        callGasLimit: "0x1",
        verificationGasLimit: "0x1",
        preVerificationGas: "0x1",
        maxFeePerGas: "0x1",
        maxPriorityFeePerGas: "0x1",
        signature: "0x",
      },
    }),
  }, env());
  assert.equal(response.status, 401);
  assert.equal((await response.json() as { error: string }).error, "AGENT_AUTH_REQUIRED");
});

test("receipt sync requires an authenticated wallet owner", async () => {
  const response = await app.request(`/api/userops/0x${"1".repeat(64)}/sync`, { method: "POST" }, env());
  assert.equal(response.status, 401);
  assert.equal((await response.json() as { error: string }).error, "AUTH_REQUIRED");
});
