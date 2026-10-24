import { z } from "zod";

const addressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "Expected a 20-byte EVM address")
  .transform((value) => value.toLowerCase());

const selectorSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{8}$/, "Expected a 4-byte function selector")
  .transform((value) => value.toLowerCase());

const bytes32Schema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, "Expected a 32-byte hex digest")
  .transform((value) => value.toLowerCase() as `0x${string}`);

const decimalSchema = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,77})$/, "Use an unsigned base-10 integer string")
  .refine((value) => BigInt(value) <= (1n << 256n) - 1n, "Value exceeds uint256");

const unixSecondsSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const PolicySchema = z
  .object({
    schemaVersion: z.literal(1),
    policyId: z.string().min(1).max(96),
    version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    chainIds: z.array(z.number().int().positive().max(0xffff_ffff)).min(1).max(16),
    token: addressSchema,
    allowedTargets: z
      .array(
        z
          .object({
            target: addressSchema,
            selectors: z.array(selectorSchema).min(1).max(32),
          })
          .strict(),
      )
      .max(64),
    allowedRecipients: z.array(addressSchema).max(500),
    limits: z
      .object({
        perTx: decimalSchema,
        daily: decimalSchema,
        maxGasPerOp: decimalSchema,
        dailyGasCapWei: decimalSchema,
      })
      .strict(),
    approvals: z
      .object({
        enabled: z.boolean(),
        maxPending: z.number().int().min(0).max(100),
        maxRequestsPerDay: z.number().int().min(0).max(1_000),
      })
      .strict(),
  })
  .strict()
  .superRefine((policy, context) => {
    if (new Set(policy.chainIds).size !== policy.chainIds.length) {
      context.addIssue({ code: "custom", path: ["chainIds"], message: "Duplicate chain ID" });
    }
    const targets = policy.allowedTargets.map(({ target }) => target);
    if (new Set(targets).size !== targets.length) {
      context.addIssue({ code: "custom", path: ["allowedTargets"], message: "Duplicate target" });
    }
    for (const [index, target] of policy.allowedTargets.entries()) {
      if (new Set(target.selectors).size !== target.selectors.length) {
        context.addIssue({
          code: "custom",
          path: ["allowedTargets", index, "selectors"],
          message: "Duplicate selector",
        });
      }
    }
    if (new Set(policy.allowedRecipients).size !== policy.allowedRecipients.length) {
      context.addIssue({
        code: "custom",
        path: ["allowedRecipients"],
        message: "Duplicate recipient",
      });
    }
    if (!policy.approvals.enabled && (policy.approvals.maxPending !== 0 || policy.approvals.maxRequestsPerDay !== 0)) {
      context.addIssue({
        code: "custom",
        path: ["approvals"],
        message: "Disabled approvals must have zero queue and request budgets",
      });
    }
  });

export const IntentSchema = z
  .object({
    schemaVersion: z.literal(1),
    intentId: z.string().min(1).max(128),
    agentId: z.string().min(1).max(128),
    chainId: z.number().int().positive().max(0xffff_ffff),
    callKind: z.string().min(1).max(48),
    target: addressSchema,
    token: addressSchema,
    selector: selectorSchema,
    recipient: addressSchema,
    amount: decimalSchema,
    callDataHash: bytes32Schema,
    dayBucket: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    gas: z
      .object({
        callGasLimit: decimalSchema,
        verificationGasLimit: decimalSchema,
        preVerificationGas: decimalSchema,
        maxFeePerGas: decimalSchema,
        maxPriorityFeePerGas: decimalSchema,
      })
      .strict(),
    reason: z.string().max(1_024).optional(),
    untrustedContextHash: bytes32Schema.optional(),
  })
  .strict()
  .superRefine((intent, context) => {
    if (BigInt(intent.amount) === 0n) {
      context.addIssue({ code: "custom", path: ["amount"], message: "Transfer amount must be positive" });
    }
    if (BigInt(intent.gas.maxPriorityFeePerGas) > BigInt(intent.gas.maxFeePerGas)) {
      context.addIssue({
        code: "custom",
        path: ["gas", "maxPriorityFeePerGas"],
        message: "Priority fee cannot exceed max fee",
      });
    }
  });

export const EvaluationContextSchema = z
  .object({
    schemaVersion: z.literal(1),
    chainTimestamp: unixSecondsSchema,
    paused: z.boolean(),
    sessionKeyActive: z.boolean(),
    keyValidAfter: unixSecondsSchema,
    keyValidUntil: unixSecondsSchema,
    spentToday: decimalSchema,
    gasReservedTodayWei: decimalSchema,
    pendingApprovals: z.number().int().nonnegative().max(100_000),
    approvalRequestsToday: z.number().int().nonnegative().max(1_000_000),
    riskRestriction: z.object({
      perTxLimit: decimalSchema.nullable(),
      dailyLimit: decimalSchema.nullable(),
      suspendedUntil: unixSecondsSchema,
      frozen: z.boolean(),
    }).strict().optional(),
    advisoryRisk: z.object({
      score: z.number().int().min(0).max(100),
      level: z.enum(["low", "moderate", "high", "critical"]),
    }).strict().optional(),
  })
  .strict();

export const RuleTraceSchema = z
  .object({
    id: z.string().min(1),
    status: z.enum(["pass", "approval_required", "blocked"]),
    severity: z.enum(["hard", "approval"]),
    expected: z.string(),
    observed: z.string(),
    explanation: z.string(),
  })
  .strict();

export const EvaluationSchema = z
  .object({
    result: z.enum(["allow", "needs_approval", "deny"]),
    dispatch: z.enum(["execute", "request_approval", "reject"]),
    estimatedGasUnits: decimalSchema,
    estimatedMaxGasCostWei: decimalSchema,
    trace: z.array(RuleTraceSchema),
  })
  .strict();

export const PassportSchema = z
  .object({
    schemaVersion: z.literal(1),
    evaluatorVersion: z.literal("aegis-policy-core/2"),
    sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    previousHash: bytes32Schema.nullable(),
    policy: PolicySchema,
    policyHash: bytes32Schema,
    intent: IntentSchema,
    context: EvaluationContextSchema,
    evaluation: EvaluationSchema,
    riskAssessmentHash: bytes32Schema.optional(),
    issuedAt: unixSecondsSchema,
    passportHash: bytes32Schema,
  })
  .strict();

export const PassportInputSchema = z
  .object({
    policy: PolicySchema,
    intent: IntentSchema,
    context: EvaluationContextSchema,
    riskAssessmentHash: bytes32Schema.optional(),
  })
  .strict();

export const DemoScenarioSchema = z.enum([
  "safe-payment",
  "prompt-injection",
  "revoked-key",
  "approval-queue-flood",
]);

export type Policy = z.infer<typeof PolicySchema>;
export type Intent = z.infer<typeof IntentSchema>;
export type EvaluationContext = z.infer<typeof EvaluationContextSchema>;
export type RuleTrace = z.infer<typeof RuleTraceSchema>;
export type Evaluation = z.infer<typeof EvaluationSchema>;
export type DecisionPassport = z.infer<typeof PassportSchema>;
export type PassportInput = z.infer<typeof PassportInputSchema>;
export type DemoScenario = z.infer<typeof DemoScenarioSchema>;

export const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
export const DIGEST_PATTERN = /^0x[0-9a-fA-F]{64}$/;
