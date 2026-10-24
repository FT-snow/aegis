import { z } from "zod";

const Decimal = z.string().regex(/^(0|[1-9][0-9]{0,77})$/);
const Address = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform((value) => value.toLowerCase());

export const RiskThresholdsSchema = z.object({
  lowMax: z.number().int().min(0).max(98),
  moderateMax: z.number().int().min(1).max(99),
  highMax: z.number().int().min(2).max(100),
}).strict().superRefine((value, context) => {
  if (!(value.lowMax < value.moderateMax && value.moderateMax < value.highMax)) {
    context.addIssue({ code: "custom", message: "Risk thresholds must be strictly increasing" });
  }
});

export const RiskAssessmentInputSchema = z.object({
  now: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  recipient: Address,
  amount: Decimal,
  basePerTxLimit: Decimal,
  baseDailyLimit: Decimal,
  effectivePerTxLimit: Decimal,
  effectiveDailyLimit: Decimal,
  spentToday: Decimal,
  recipientTrust: z.enum(["trusted", "known", "unknown", "malicious"]),
  successfulPaymentsToRecipient: z.number().int().nonnegative().max(100_000),
  recentTransactions: z.array(z.object({
    timestamp: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    recipient: Address,
    amount: Decimal,
    decision: z.enum(["allow", "needs_approval", "deny"]),
  }).strict()).max(500),
  actionsLastHour: z.number().int().nonnegative().max(1_000_000).optional(),
  actionsLastDay: z.number().int().nonnegative().max(1_000_000).optional(),
  rejectedAttempts24h: z.number().int().nonnegative().max(100_000),
  maliciousRecipient: z.boolean(),
  untrustedPageText: z.string().max(4_000).optional(),
  sessionKeyIncidents24h: z.number().int().nonnegative().max(100_000),
  thresholds: RiskThresholdsSchema.default({ lowMax: 29, moderateMax: 59, highMax: 79 }),
}).strict();

export type RiskAssessmentInput = z.input<typeof RiskAssessmentInputSchema>;
export type RiskLevel = "low" | "moderate" | "high" | "critical";
export type RiskAction = "continue" | "monitor" | "request_approval" | "quarantine_and_freeze";

export interface RiskFactor {
  id: string;
  points: number;
  evidence: string;
}

export interface RiskRestrictionProposal {
  perTxLimit: string;
  dailyLimit: string;
  suspendedUntil: number;
  freezeAgent: boolean;
}

export interface EffectiveSessionLimits {
  perTxLimit: string;
  dailyLimit: string;
  frozen: boolean;
  suspendedUntil: number;
}

export function calculateEffectiveSessionLimits(input: {
  basePerTxLimit: string;
  baseDailyLimit: string;
  riskPerTxLimit: string | null;
  riskDailyLimit: string | null;
  frozen: boolean;
  suspendedUntil: number;
}): EffectiveSessionLimits {
  const basePerTx = BigInt(Decimal.parse(input.basePerTxLimit));
  const baseDaily = BigInt(Decimal.parse(input.baseDailyLimit));
  const riskPerTx = input.riskPerTxLimit === null ? basePerTx : BigInt(Decimal.parse(input.riskPerTxLimit));
  const riskDaily = input.riskDailyLimit === null ? baseDaily : BigInt(Decimal.parse(input.riskDailyLimit));
  return {
    perTxLimit: (riskPerTx < basePerTx ? riskPerTx : basePerTx).toString(),
    dailyLimit: (riskDaily < baseDaily ? riskDaily : baseDaily).toString(),
    frozen: input.frozen,
    suspendedUntil: input.suspendedUntil,
  };
}

export interface RiskAssessment {
  schemaVersion: 1;
  score: number;
  level: RiskLevel;
  action: RiskAction;
  factors: RiskFactor[];
  restrictionProposal: RiskRestrictionProposal | null;
  executionAllowedByRisk: boolean;
  advisory: true;
}

const injectionPattern = /\b(ignore|disregard|override|bypass)\b.{0,80}\b(previous|prior|system|policy|rules|instructions)\b|\b(send|pay|transfer)\b.{0,100}\b(attacker|unknown|wallet|funds|usdc)\b/i;

function half(value: bigint): bigint {
  const result = value / 2n;
  return result > 0n ? result : 1n;
}

/**
 * Deterministic advisory scorer. It never authorizes a transaction or changes
 * on-chain state; proposed limits are bounded by the currently effective limits.
 */
export function assessRisk(inputValue: RiskAssessmentInput): RiskAssessment {
  const input = RiskAssessmentInputSchema.parse(inputValue);
  const amount = BigInt(input.amount);
  const basePerTx = BigInt(input.basePerTxLimit);
  const currentPerTx = BigInt(input.effectivePerTxLimit);
  const currentDaily = BigInt(input.effectiveDailyLimit);
  const spentToday = BigInt(input.spentToday);
  const factors: RiskFactor[] = [];
  const add = (id: string, points: number, evidence: string) => {
    if (points > 0) factors.push({ id, points, evidence });
  };

  if (input.maliciousRecipient || input.recipientTrust === "malicious") {
    add("recipient.known_malicious", 100, "Recipient matches the configured malicious-address intelligence source.");
  } else if (input.recipientTrust === "unknown" && input.successfulPaymentsToRecipient === 0) {
    add("recipient.novel", 18, "No successful wallet payment history for this recipient.");
  } else if (input.recipientTrust === "known" && input.successfulPaymentsToRecipient < 3) {
    add("recipient.limited_history", 8, "Recipient has fewer than three successful wallet payments.");
  }

  if (basePerTx > 0n) {
    if (amount * 100n >= basePerTx * 80n) add("amount.near_per_tx_limit", 22, "Proposed amount is at least 80% of the owner-defined per-transaction limit.");
    else if (amount * 100n >= basePerTx * 50n) add("amount.elevated", 10, "Proposed amount is at least 50% of the owner-defined per-transaction limit.");
  }

  const successfulAmounts = input.recentTransactions
    .filter((tx) => tx.decision === "allow")
    .map((tx) => BigInt(tx.amount))
    .sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  if (successfulAmounts.length >= 3) {
    const median = successfulAmounts[Math.floor(successfulAmounts.length / 2)] ?? 0n;
    if (median > 0n && amount > median * 3n) add("amount.anomalous", 20, "Proposed amount exceeds three times the median of recent successful payments.");
  }

  const lastHour = input.actionsLastHour ?? input.recentTransactions.filter((tx) => input.now - tx.timestamp <= 3_600 && input.now >= tx.timestamp).length;
  const lastDay = input.actionsLastDay ?? input.recentTransactions.filter((tx) => input.now - tx.timestamp <= 86_400 && input.now >= tx.timestamp).length;
  if (lastHour >= 5) add("velocity.hourly", 25, `${lastHour} recorded actions in the last hour.`);
  else if (lastHour >= 3) add("velocity.hourly", 12, `${lastHour} recorded actions in the last hour.`);
  if (lastDay >= 12) add("velocity.daily", 18, `${lastDay} recorded actions in the last 24 hours.`);

  if (input.rejectedAttempts24h >= 5) add("rejections.repeated", 25, `${input.rejectedAttempts24h} rejected attempts in the last 24 hours.`);
  else if (input.rejectedAttempts24h >= 2) add("rejections.repeated", 15, `${input.rejectedAttempts24h} rejected attempts in the last 24 hours.`);
  else if (input.rejectedAttempts24h === 1) add("rejections.recent", 7, "One rejected attempt in the last 24 hours.");

  if (input.untrustedPageText && injectionPattern.test(input.untrustedPageText)) {
    add("prompt_injection.indicator", 18, "Untrusted page text contains a prompt-injection or unauthorized payment instruction indicator.");
  }
  if (input.sessionKeyIncidents24h >= 2) add("session_key.incidents", 30, `${input.sessionKeyIncidents24h} session-key security incidents in the last 24 hours.`);
  else if (input.sessionKeyIncidents24h === 1) add("session_key.incidents", 20, "One session-key security incident in the last 24 hours.");

  const prospectiveDailySpend = spentToday + amount;
  if (currentPerTx === 0n || amount > currentPerTx) add("policy.per_tx_pressure", 18, "Intent exceeds the currently effective per-transaction ceiling.");
  if (currentDaily === 0n || prospectiveDailySpend > currentDaily) add("policy.daily_pressure", 18, "Intent would exceed the currently effective daily ceiling.");

  const score = Math.min(100, factors.reduce((total, factor) => total + factor.points, 0));
  const { lowMax, moderateMax, highMax } = input.thresholds;
  const level: RiskLevel = score <= lowMax ? "low" : score <= moderateMax ? "moderate" : score <= highMax ? "high" : "critical";
  const action: RiskAction = level === "low" ? "continue"
    : level === "moderate" ? "monitor"
      : level === "high" ? "request_approval" : "quarantine_and_freeze";

  let restrictionProposal: RiskRestrictionProposal | null = null;
  if (level === "high" || level === "critical") {
    restrictionProposal = {
      perTxLimit: half(currentPerTx).toString(),
      dailyLimit: half(currentDaily).toString(),
      suspendedUntil: level === "critical" ? input.now + 86_400 : input.now + 300,
      freezeAgent: level === "critical",
    };
  }

  return {
    schemaVersion: 1,
    score,
    level,
    action,
    factors,
    restrictionProposal,
    executionAllowedByRisk: level === "low" || level === "moderate",
    advisory: true,
  };
}
