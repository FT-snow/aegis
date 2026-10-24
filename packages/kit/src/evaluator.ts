import { EvaluationContextSchema, IntentSchema, PolicySchema } from "./schemas.js";
import type { Evaluation, EvaluationContext, Intent, Policy, RuleTrace } from "./schemas.js";

const DAY_SECONDS = 86_400n;
const ERC20_TRANSFER = "0xa9059cbb";

function describe(value: string | number | boolean): string {
  return String(value);
}

/**
 * Deterministic policy mirror for gateway preflight and simulation.
 * The account contract remains authoritative; callers must never interpret
 * an `allow` here as a substitute for on-chain validation.
 */
export function evaluatePolicy(
  policyInput: Policy,
  intentInput: Intent,
  contextInput: EvaluationContext,
): Evaluation {
  const policy = PolicySchema.parse(policyInput);
  const intent = IntentSchema.parse(intentInput);
  const context = EvaluationContextSchema.parse(contextInput);
  const trace: RuleTrace[] = [];

  const canRequestApproval =
    policy.approvals.enabled &&
    context.pendingApprovals < policy.approvals.maxPending &&
    context.approvalRequestsToday < policy.approvals.maxRequestsPerDay;

  const check = (rule: {
    id: string;
    passed: boolean;
    severity: "hard" | "approval";
    expected: string;
    observed: string;
    explanation: string;
  }) => {
    const { passed, ...traceRule } = rule;
    let status: RuleTrace["status"];
    if (passed) status = "pass";
    else if (rule.severity === "approval" && canRequestApproval) status = "approval_required";
    else status = "blocked";
    trace.push({ ...traceRule, status });
  };

  const bucket = BigInt(Math.floor(context.chainTimestamp / Number(DAY_SECONDS)));
  const gas = intent.gas;
  const gasUnits =
    BigInt(gas.callGasLimit) +
    BigInt(gas.verificationGasLimit) +
    BigInt(gas.preVerificationGas);
  const maxGasCost = gasUnits * BigInt(gas.maxFeePerGas);

  check({
    id: "chain.allowlist",
    passed: policy.chainIds.includes(intent.chainId),
    severity: "hard",
    expected: `chainId ∈ [${[...policy.chainIds].sort((a, b) => a - b).join(",")}]`,
    observed: String(intent.chainId),
    explanation: "The operation must target an explicitly enabled test chain.",
  });
  check({
    id: "account.paused",
    passed: !context.paused,
    severity: "hard",
    expected: "not paused",
    observed: context.paused ? "paused" : "active",
    explanation: "Pause state is an immediate session-key kill switch.",
  });
  const restriction = context.riskRestriction;
  check({
    id: "risk.frozen",
    passed: !restriction?.frozen,
    severity: "hard",
    expected: "risk controller has not frozen this session key",
    observed: restriction?.frozen ? "frozen" : "not frozen",
    explanation: "A confirmed on-chain risk freeze cannot be overridden by gateway policy or an agent.",
  });
  check({
    id: "risk.suspension",
    passed: !restriction || context.chainTimestamp >= restriction.suspendedUntil,
    severity: "hard",
    expected: "chain timestamp is at or after any temporary risk suspension",
    observed: restriction && context.chainTimestamp < restriction.suspendedUntil
      ? `suspended until ${restriction.suspendedUntil}`
      : "not suspended",
    explanation: "A confirmed temporary suspension is enforced before any session-key action.",
  });
  if (context.advisoryRisk) {
    const level = context.advisoryRisk.level;
    check({
      id: "risk.advisory-assessment",
      passed: level === "low" || level === "moderate",
      severity: level === "critical" ? "hard" : "approval",
      expected: "ARE level is low/moderate for direct execution",
      observed: `${level} (${context.advisoryRisk.score}/100)`,
      explanation: level === "critical"
        ? "Critical ARE findings deny direct execution; a controller restriction remains a separate proposal."
        : level === "high"
          ? "High ARE findings require owner approval and cannot be directly executed."
          : "Low/moderate ARE findings do not independently block execution.",
    });
  }
  check({
    id: "session.active",
    passed: context.sessionKeyActive,
    severity: "hard",
    expected: "active session key",
    observed: context.sessionKeyActive ? "active" : "revoked or unknown",
    explanation: "A revoked or unknown key cannot submit actions or approval requests.",
  });
  check({
    id: "session.validity",
    passed:
      context.chainTimestamp >= context.keyValidAfter &&
      (context.keyValidUntil === 0 || context.chainTimestamp <= context.keyValidUntil),
    severity: "hard",
    expected: `${context.keyValidAfter} ≤ chain time ≤ ${context.keyValidUntil || "∞"}`,
    observed: String(context.chainTimestamp),
    explanation: "The session key must be inside its signed validity interval.",
  });
  check({
    id: "bucket.current-day",
    passed: BigInt(intent.dayBucket) === bucket,
    severity: "hard",
    expected: String(bucket),
    observed: String(intent.dayBucket),
    explanation: "The signed budget bucket must match the chain timestamp's UTC day.",
  });

  const supportedShape =
    intent.callKind === "erc20.transfer" &&
    intent.selector === ERC20_TRANSFER &&
    intent.target === policy.token &&
    intent.token === policy.token;
  check({
    id: "call.shape",
    passed: supportedShape,
    severity: "hard",
    expected: `ERC20 transfer(${ERC20_TRANSFER}) to the configured token`,
    observed: `${intent.callKind} ${intent.target} ${intent.selector} token=${intent.token}`,
    explanation: "Only the explicitly decoded transfer call shape is eligible for session-key execution.",
  });

  const targetPolicy = policy.allowedTargets.find((entry) => entry.target === intent.target);
  check({
    id: "target.allowed",
    passed: targetPolicy !== undefined,
    severity: "approval",
    expected: "target is in the key's allowlist",
    observed: intent.target,
    explanation: "Unknown targets are never executed directly; they can only enter the capped owner-approval queue.",
  });
  check({
    id: "selector.allowed",
    passed: targetPolicy?.selectors.includes(intent.selector) === true,
    severity: "approval",
    expected: "selector is allowed for target",
    observed: intent.selector,
    explanation: "Selectors are scoped to their target, preventing a permitted target from exposing arbitrary methods.",
  });
  check({
    id: "recipient.allowed",
    passed: policy.allowedRecipients.includes(intent.recipient),
    severity: "approval",
    expected: "recipient is in the key's allowlist",
    observed: intent.recipient,
    explanation: "A new payee requires explicit owner review; the LLM cannot whitelist itself.",
  });

  const amount = BigInt(intent.amount);
  const effectivePerTxLimit = restriction?.perTxLimit === null || restriction?.perTxLimit === undefined
    ? BigInt(policy.limits.perTx)
    : BigInt(restriction.perTxLimit) < BigInt(policy.limits.perTx)
      ? BigInt(restriction.perTxLimit)
      : BigInt(policy.limits.perTx);
  const effectiveDailyLimit = restriction?.dailyLimit === null || restriction?.dailyLimit === undefined
    ? BigInt(policy.limits.daily)
    : BigInt(restriction.dailyLimit) < BigInt(policy.limits.daily)
      ? BigInt(restriction.dailyLimit)
      : BigInt(policy.limits.daily);
  check({
    id: "limit.per-tx",
    passed: amount <= effectivePerTxLimit,
    severity: "approval",
    expected: `≤ ${effectivePerTxLimit} effective base units`,
    observed: `${intent.amount} base units`,
    explanation: "An over-limit action is converted to an approval request, never silently rounded or executed.",
  });
  check({
    id: "limit.daily",
    passed: BigInt(context.spentToday) + amount <= effectiveDailyLimit,
    severity: "approval",
    expected: `spent + amount ≤ ${effectiveDailyLimit} effective base units`,
    observed: `${context.spentToday} + ${intent.amount} base units`,
    explanation: "Daily spend uses integer token base units and the chain-derived day bucket.",
  });
  check({
    id: "gas.per-operation",
    passed: gasUnits <= BigInt(policy.limits.maxGasPerOp),
    severity: "hard",
    expected: `≤ ${policy.limits.maxGasPerOp} gas units`,
    observed: `${gasUnits} gas units`,
    explanation: "A single operation above the gas ceiling is rejected, not escalated for approval.",
  });
  check({
    id: "gas.daily-reserve",
    passed: BigInt(context.gasReservedTodayWei) + maxGasCost <= BigInt(policy.limits.dailyGasCapWei),
    severity: "approval",
    expected: `reserved + maxCost ≤ ${policy.limits.dailyGasCapWei} wei`,
    observed: `${context.gasReservedTodayWei} + ${maxGasCost} wei`,
    explanation: "Gas is conservatively reserved at maxFeePerGas during validation; actual execution cost is not known yet.",
  });

  const blocked = trace.some((entry) => entry.status === "blocked");
  const needsApproval = trace.some((entry) => entry.status === "approval_required");
  const result: Evaluation["result"] = blocked ? "deny" : needsApproval ? "needs_approval" : "allow";
  const dispatch: Evaluation["dispatch"] =
    result === "allow" ? "execute" : result === "needs_approval" ? "request_approval" : "reject";

  return {
    result,
    dispatch,
    estimatedGasUnits: gasUnits.toString(),
    estimatedMaxGasCostWei: maxGasCost.toString(),
    trace,
  };
}

export { ERC20_TRANSFER };
