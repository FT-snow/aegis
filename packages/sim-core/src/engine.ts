import { buildDemoCase, createPassport, hashJson, type DecisionPassport, type DemoScenario } from "@aegis/kit";

export type SimulationEventKind =
  | "day_started"
  | "cost_burned"
  | "agent_action"
  | "policy_decision"
  | "agent_died"
  | "run_completed";

export interface SimulationEvent {
  seq: number;
  tick: number;
  kind: SimulationEventKind;
  agentId?: string;
  amount?: string;
  balance?: string;
  detail: string;
  passportHash?: `0x${string}`;
}

export interface SimulationConfig {
  seed: number;
  startTimestamp: number;
  days: number;
  startingBalance: string;
  dailyBurn: string;
  profile: "scripted-safe" | "scripted-adaptive";
  attackTicks: number[];
}

export interface SimulationSummary {
  seed: number;
  ticks: number;
  alive: boolean;
  endingBalance: string;
  totalBurned: string;
  decisions: { allow: number; needs_approval: number; deny: number };
  blockedAttacks: number;
  eventHash: `0x${string}`;
  passportHead: `0x${string}` | null;
}

export interface SimulationResult {
  config: SimulationConfig;
  events: SimulationEvent[];
  passports: DecisionPassport[];
  summary: SimulationSummary;
}

const DAY = 86_400;
const MAX_DAYS = 365;
const MAX_BALANCE = (1n << 128n) - 1n;

/** Small, specified xorshift32 generator for cross-runtime deterministic runs. */
class SeededRandom {
  #state: number;

  constructor(seed: number) {
    this.#state = seed >>> 0 || 0x9e3779b9;
  }

  next(): number {
    let value = this.#state;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.#state = value >>> 0;
    return this.#state / 0x1_0000_0000;
  }
}

function assertAmount(name: string, value: string): bigint {
  if (!/^(0|[1-9][0-9]{0,38})$/.test(value)) throw new TypeError(`${name} must be an unsigned integer string`);
  const amount = BigInt(value);
  if (amount > MAX_BALANCE) throw new RangeError(`${name} exceeds simulation uint128 range`);
  return amount;
}

function validateConfig(config: SimulationConfig): SimulationConfig {
  if (!Number.isSafeInteger(config.seed)) throw new RangeError("seed must be a safe integer");
  if (!Number.isSafeInteger(config.startTimestamp) || config.startTimestamp < 0) {
    throw new RangeError("startTimestamp must be nonnegative safe integer seconds");
  }
  if (!Number.isInteger(config.days) || config.days < 1 || config.days > MAX_DAYS) {
    throw new RangeError(`days must be between 1 and ${MAX_DAYS}`);
  }
  if (config.profile !== "scripted-safe" && config.profile !== "scripted-adaptive") {
    throw new TypeError("unknown simulation profile");
  }
  assertAmount("startingBalance", config.startingBalance);
  assertAmount("dailyBurn", config.dailyBurn);
  if (config.attackTicks.some((tick) => !Number.isInteger(tick) || tick < 0 || tick >= config.days)) {
    throw new RangeError("attack tick must identify a day in the run");
  }
  return { ...config, attackTicks: [...new Set(config.attackTicks)].sort((a, b) => a - b) };
}

export function runSimulation(inputConfig: SimulationConfig): SimulationResult {
  const config = validateConfig(inputConfig);
  const random = new SeededRandom(config.seed);
  const events: SimulationEvent[] = [];
  const passports: DecisionPassport[] = [];
  let balance = assertAmount("startingBalance", config.startingBalance);
  const dailyBurn = assertAmount("dailyBurn", config.dailyBurn);
  let totalBurned = 0n;
  let alive = true;
  let blockedAttacks = 0;
  let previousHash: `0x${string}` | null = null;
  let dailySpent = 0n;
  const decisions = { allow: 0, needs_approval: 0, deny: 0 };
  const push = (event: Omit<SimulationEvent, "seq">) => events.push({ seq: events.length + 1, ...event });

  for (let tick = 0; tick < config.days && alive; tick += 1) {
    const timestamp = config.startTimestamp + tick * DAY;
    dailySpent = 0n;
    push({ tick, kind: "day_started", balance: balance.toString(), detail: `UTC day ${Math.floor(timestamp / DAY)}` });

    balance = balance > dailyBurn ? balance - dailyBurn : 0n;
    totalBurned += dailyBurn;
    push({ tick, kind: "cost_burned", amount: dailyBurn.toString(), balance: balance.toString(), detail: "daily survival cost" });
    if (balance === 0n) {
      alive = false;
      push({ tick, kind: "agent_died", balance: "0", detail: "balance exhausted by daily cost" });
      break;
    }

    const isAttackDay = config.attackTicks.includes(tick);
    const randomAttack = config.profile === "scripted-adaptive" && tick > 0 && random.next() < 0.12;
    const scenario: DemoScenario = isAttackDay || randomAttack ? "prompt-injection" : "safe-payment";
    const demo = buildDemoCase(scenario, timestamp + 1);
    demo.input.context.spentToday = dailySpent.toString();
    const passport = createPassport(demo.input, {
      sequence: passports.length + 1,
      previousHash,
    });
    passports.push(passport);
    previousHash = passport.passportHash;
    decisions[passport.evaluation.result] += 1;
    push({
      tick,
      kind: "agent_action",
      agentId: demo.input.intent.agentId,
      amount: demo.input.intent.amount,
      balance: balance.toString(),
      detail: demo.attackLabel,
      passportHash: passport.passportHash,
    });
    push({
      tick,
      kind: "policy_decision",
      agentId: demo.input.intent.agentId,
      balance: balance.toString(),
      detail: `${passport.evaluation.result}; ${passport.evaluation.trace.filter((rule) => rule.status !== "pass").map((rule) => rule.id).join(",") || "all rules pass"}`,
      passportHash: passport.passportHash,
    });
    if (scenario === "prompt-injection" && passport.evaluation.dispatch !== "execute") {
      blockedAttacks += 1;
    }
    if (passport.evaluation.dispatch === "execute") {
      const payment = BigInt(demo.input.intent.amount);
      if (balance < payment) {
        push({ tick, kind: "agent_action", balance: balance.toString(), detail: "payment skipped: insufficient simulated balance" });
      } else {
        balance -= payment;
        dailySpent += payment;
        push({ tick, kind: "agent_action", amount: payment.toString(), balance: balance.toString(), detail: "approved transfer applied to simulated ledger", passportHash: passport.passportHash });
      }
    }
  }

  push({
    tick: config.days - 1,
    kind: "run_completed",
    balance: balance.toString(),
    detail: alive ? "all configured days completed" : "agent died before run completed",
  });
  const passportHead = passports.at(-1)?.passportHash ?? null;
  const eventHash = hashSimulationEvents(events);
  const summary: SimulationSummary = {
    seed: config.seed,
    ticks: events.length === 0 ? 0 : Math.max(...events.map(({ tick }) => tick)) + 1,
    alive,
    endingBalance: balance.toString(),
    totalBurned: totalBurned.toString(),
    decisions,
    blockedAttacks,
    eventHash,
    passportHead,
  };
  return { config, events, passports, summary };
}

export function hashSimulationEvents(events: SimulationEvent[]): `0x${string}` {
  return hashJson(events);
}
