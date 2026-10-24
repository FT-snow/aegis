import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDemoCase,
  createPassport,
  demoAddresses,
  verifyPassport,
  type DecisionPassport,
} from "../src/index.js";

const NOW = 1_800_000_000;

test("known payment passes all rules and creates reproducible passport", () => {
  const input = buildDemoCase("safe-payment", NOW).input;
  const first = createPassport(input, { sequence: 1, previousHash: null });
  const second = createPassport(input, { sequence: 1, previousHash: null });
  assert.equal(first.evaluation.result, "allow");
  assert.equal(first.evaluation.dispatch, "execute");
  assert.equal(first.passportHash, second.passportHash);
  assert.equal(verifyPassport(first).valid, true);
});

test("injected recipient and inflated amount cannot become direct payment", () => {
  const input = buildDemoCase("prompt-injection", NOW).input;
  const receipt = createPassport(input, { sequence: 1, previousHash: null });
  assert.equal(input.intent.recipient, demoAddresses.attacker);
  assert.equal(receipt.evaluation.result, "needs_approval");
  assert.equal(receipt.evaluation.dispatch, "request_approval");
  assert.ok(receipt.evaluation.trace.some(({ id, status }) => id === "recipient.allowed" && status === "approval_required"));
});

test("hard failures cannot be elevated to approval", () => {
  const input = buildDemoCase("safe-payment", NOW).input;
  input.context.paused = true;
  const receipt = createPassport(input, { sequence: 1, previousHash: null });
  assert.equal(receipt.evaluation.result, "deny");
  assert.equal(receipt.evaluation.dispatch, "reject");
});

test("ARE risk is included in the final passport decision", () => {
  const highRiskInput = buildDemoCase("safe-payment", NOW).input;
  highRiskInput.context.advisoryRisk = { score: 70, level: "high" };
  const highRisk = createPassport(highRiskInput, { sequence: 1, previousHash: null });
  assert.equal(highRisk.evaluation.result, "needs_approval");
  assert.equal(highRisk.evaluation.dispatch, "request_approval");
  assert.ok(highRisk.evaluation.trace.some(({ id, status }) => id === "risk.advisory-assessment" && status === "approval_required"));

  const criticalInput = buildDemoCase("safe-payment", NOW).input;
  criticalInput.context.advisoryRisk = { score: 90, level: "critical" };
  const critical = createPassport(criticalInput, { sequence: 1, previousHash: null });
  assert.equal(critical.evaluation.result, "deny");
  assert.equal(critical.evaluation.dispatch, "reject");
});

test("full approval queue blocks instead of emitting unbounded requests", () => {
  const input = buildDemoCase("approval-queue-flood", NOW).input;
  const receipt = createPassport(input, { sequence: 1, previousHash: null });
  assert.equal(receipt.evaluation.result, "deny");
  assert.equal(receipt.evaluation.dispatch, "reject");
});

test("passport tampering and broken chain links are detected", () => {
  const receipt = createPassport(buildDemoCase("safe-payment", NOW).input, { sequence: 1, previousHash: null });
  const tampered = structuredClone(receipt) as DecisionPassport;
  tampered.intent.reason = "altered after signing";
  const invalid = verifyPassport(tampered);
  assert.equal(invalid.valid, false);
  assert.equal(invalid.checks.passportHash, false);
  assert.equal(invalid.checks.replayedEvaluation, true);

  const invalidGenesis = createPassport(buildDemoCase("safe-payment", NOW).input, {
    sequence: 1,
    previousHash: null,
  });
  assert.equal(verifyPassport(invalidGenesis, `0x${"1".repeat(64)}`).checks.previousHash, false);
});

test("unknown keys in policy input fail closed", () => {
  const input = buildDemoCase("safe-payment", NOW).input;
  assert.throws(() => createPassport({ ...input, policy: { ...input.policy, surprise: true } } as never, {
    sequence: 1,
    previousHash: null,
  }));
});
