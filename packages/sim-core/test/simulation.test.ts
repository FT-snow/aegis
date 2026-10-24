import assert from "node:assert/strict";
import test from "node:test";
import { hashSimulationEvents, runSimulation, type SimulationConfig } from "../src/index.js";

const config: SimulationConfig = {
  seed: 42017,
  startTimestamp: 1_800_000_000,
  days: 10,
  startingBalance: "15000000",
  dailyBurn: "1000000",
  profile: "scripted-safe",
  attackTicks: [2, 7],
};

test("same seed and schedule create byte-identical deterministic run", () => {
  const first = runSimulation(config);
  const second = runSimulation(config);
  assert.equal(first.summary.eventHash, second.summary.eventHash);
  assert.deepEqual(first.events, second.events);
  assert.deepEqual(first.passports.map((p) => p.passportHash), second.passports.map((p) => p.passportHash));
});

test("scheduled injection attempts produce passports and never transfer attacker funds", () => {
  const result = runSimulation(config);
  assert.equal(result.passports.length, config.days);
  assert.equal(result.summary.blockedAttacks, 2);
  assert.equal(result.summary.decisions.needs_approval, 2);
  assert.ok(result.events.some((event) => event.detail.includes("recipient.allowed") && event.kind === "policy_decision"));
});

test("deterministic event hash matches complete stream", () => {
  const result = runSimulation(config);
  assert.equal(hashSimulationEvents(result.events), result.summary.eventHash);
});

test("survival cost stops run at zero and marks death", () => {
  const result = runSimulation({ ...config, days: 5, startingBalance: "2000000", attackTicks: [2] });
  assert.equal(result.summary.alive, false);
  assert.ok(result.events.some(({ kind }) => kind === "agent_died"));
  assert.equal(result.passports.length, 1);
});

test("invalid run dimensions fail fast", () => {
  assert.throws(() => runSimulation({ ...config, days: 366 }));
  assert.throws(() => runSimulation({ ...config, startingBalance: "-5" }));
});
