import { canonicalJson, hashJson } from "./canonical.js";
import { evaluatePolicy } from "./evaluator.js";
import {
  EvaluationSchema,
  EvaluationContextSchema,
  IntentSchema,
  PassportInputSchema,
  PassportSchema,
  PolicySchema,
} from "./schemas.js";
import type { DecisionPassport, Evaluation, EvaluationContext, Intent, PassportInput, Policy } from "./schemas.js";

export interface PassportOptions {
  sequence: number;
  previousHash: `0x${string}` | null;
}

export function normalizePolicy(input: Policy): Policy {
  const parsed = PolicySchema.parse(input);
  return {
    ...parsed,
    chainIds: [...parsed.chainIds].sort((a, b) => a - b),
    allowedTargets: parsed.allowedTargets
      .map((target) => ({ ...target, selectors: [...target.selectors].sort() }))
      .sort((left, right) => left.target.localeCompare(right.target)),
    allowedRecipients: [...parsed.allowedRecipients].sort(),
  };
}

export function createPassport(input: PassportInput, options: PassportOptions): DecisionPassport {
  const parsed = PassportInputSchema.parse(input);
  if (!Number.isSafeInteger(options.sequence) || options.sequence < 1) {
    throw new RangeError("Passport sequence must be a positive safe integer");
  }
  if ((options.sequence === 1) !== (options.previousHash === null)) {
    throw new Error("Only sequence 1 may have a null previousHash");
  }

  const policy = normalizePolicy(parsed.policy);
  const intent = IntentSchema.parse(parsed.intent);
  const context = EvaluationContextSchema.parse(parsed.context);
  const evaluation = evaluatePolicy(policy, intent, context);
  const unsigned = {
    schemaVersion: 1 as const,
    evaluatorVersion: "aegis-policy-core/2" as const,
    sequence: options.sequence,
    previousHash: options.previousHash,
    policy,
    policyHash: hashJson(policy),
    intent,
    context,
    evaluation,
    ...(parsed.riskAssessmentHash ? { riskAssessmentHash: parsed.riskAssessmentHash } : {}),
    issuedAt: context.chainTimestamp,
  };
  return { ...unsigned, passportHash: hashJson(unsigned) };
}

export interface PassportVerification {
  valid: boolean;
  checks: {
    schema: boolean;
    policyHash: boolean;
    replayedEvaluation: boolean;
    passportHash: boolean;
    previousHash: boolean;
  };
  errors: string[];
}

export function verifyPassport(
  input: unknown,
  expectedPreviousHash?: `0x${string}` | null,
): PassportVerification {
  const checks = {
    schema: false,
    policyHash: false,
    replayedEvaluation: false,
    passportHash: false,
    previousHash: false,
  };
  const errors: string[] = [];
  const parsed = PassportSchema.safeParse(input);
  if (!parsed.success) {
    errors.push(...parsed.error.issues.map((issue) => `${issue.path.join(".") || "passport"}: ${issue.message}`));
    return { valid: false, checks, errors };
  }
  checks.schema = true;
  const passport = parsed.data;

  checks.previousHash = expectedPreviousHash === undefined || passport.previousHash === expectedPreviousHash;
  if (!checks.previousHash) errors.push("previousHash does not match the trusted journal head");
  if ((passport.sequence === 1) !== (passport.previousHash === null)) {
    checks.previousHash = false;
    errors.push("sequence/previousHash genesis invariant failed");
  }

  const normalizedPolicy = normalizePolicy(passport.policy);
  checks.policyHash = hashJson(normalizedPolicy) === passport.policyHash;
  if (!checks.policyHash) errors.push("policyHash does not match the included policy snapshot");

  const replayed: Evaluation = evaluatePolicy(normalizedPolicy, passport.intent, passport.context);
  const storedEvaluation = EvaluationSchema.parse(passport.evaluation);
  checks.replayedEvaluation = canonicalJson(replayed) === canonicalJson(storedEvaluation);
  if (!checks.replayedEvaluation) errors.push("stored decision or trace differs from deterministic policy replay");

  const { passportHash, ...unsigned } = passport;
  checks.passportHash = hashJson(unsigned) === passportHash;
  if (!checks.passportHash) errors.push("passportHash does not match the receipt body");

  return { valid: Object.values(checks).every(Boolean), checks, errors };
}

export function reEvaluatePassport(passport: DecisionPassport): Evaluation {
  return evaluatePolicy(passport.policy, passport.intent, passport.context);
}

export function passportForIntent(
  policy: Policy,
  intent: Intent,
  context: EvaluationContext,
  options: PassportOptions,
): DecisionPassport {
  return createPassport({ policy, intent, context }, options);
}
