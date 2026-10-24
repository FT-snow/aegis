import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Link, useSearchParams } from "react-router-dom";
import { ChartFrame } from "../components/ChartFrame";

type Strictness = "lenient" | "balanced" | "strict";
type Rule = "limit" | "recipient" | "contract" | "expiry";
type Cause = Rule | "reserve";

interface AgentProfile {
  id: string;
  name: string;
  exposure: number;
  reserve: number;
  spend: number;
}

interface AgentResult extends AgentProfile {
  daysSurvived: number;
  deathDay: number | null;
  cause: Cause | null;
}

interface Snapshot {
  day: number;
  balances: Record<string, number>;
  blocked: Record<Rule, number>;
}

interface Simulation {
  duration: number;
  agents: AgentResult[];
  history: Snapshot[];
}

const SEED = 202501;
const TOTAL_DAYS = 30;
const RULES: Array<{ id: Rule; label: string; chance: number }> = [
  { id: "limit", label: "Limit", chance: 0.13 },
  { id: "recipient", label: "Recipient", chance: 0.075 },
  { id: "contract", label: "Contract", chance: 0.045 },
  { id: "expiry", label: "Expiry", chance: 0.025 },
];
const PROFILES: AgentProfile[] = [
  { id: "strict", name: "strict-policy bot", exposure: 0.58, reserve: 720, spend: 17 },
  { id: "loose", name: "loose-policy bot", exposure: 1.04, reserve: 820, spend: 25 },
  { id: "llm", name: "LLM agent", exposure: 0.92, reserve: 760, spend: 21 },
  { id: "leaked", name: "leaked-key agent", exposure: 1.48, reserve: 850, spend: 20 },
  { id: "injected", name: "prompt-injected agent", exposure: 1.28, reserve: 780, spend: 22 },
];
const STRICTNESS: Array<{
  id: Strictness;
  label: string;
  blockChance: number;
  spendFactor: number;
}> = [
  { id: "lenient", label: "Lenient", blockChance: 0.64, spendFactor: 1.12 },
  { id: "balanced", label: "Balanced", blockChance: 0.82, spendFactor: 1 },
  { id: "strict", label: "Strict", blockChance: 0.95, spendFactor: 0.9 },
];
const SPEEDS = [
  { label: "0.5x", interval: 1600 },
  { label: "1x", interval: 900 },
  { label: "2x", interval: 450 },
  { label: "4x", interval: 225 },
];
const RULE_LABELS: Record<Rule, string> = {
  limit: "Limit",
  recipient: "Recipient",
  contract: "Contract",
  expiry: "Expiry",
};
const CAUSE_LABELS: Record<Cause, string> = {
  limit: "Limit breach",
  recipient: "Recipient violation",
  contract: "Contract call",
  expiry: "Expired permission",
  reserve: "Reserve exhausted",
};
const PROFILE_COLORS: Record<string, string> = {
  strict: "var(--ink)",
  loose: "var(--muted)",
  llm: "var(--ink)",
  leaked: "var(--muted)",
  injected: "var(--ink)",
};
const PROFILE_DASHES: Record<string, string> = {
  strict: "",
  loose: "5 3",
  llm: "2 2",
  leaked: "8 3",
  injected: "3 3 1 3",
};

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function simulate(seed: number, strictness: Strictness): Simulation {
  const policy = STRICTNESS.find((option) => option.id === strictness)!;
  const balances = Object.fromEntries(PROFILES.map((profile) => [profile.id, profile.reserve]));
  const blocked = Object.fromEntries(RULES.map((rule) => [rule.id, 0])) as Record<Rule, number>;
  const active = new Set(PROFILES.map((profile) => profile.id));
  const random = new Map(
    PROFILES.map((profile, index) => [profile.id, seededRandom(seed + index * 104729)] as const),
  );
  const deaths = new Map<string, { day: number; cause: Cause }>();
  const history: Snapshot[] = [{ day: 0, balances: { ...balances }, blocked: { ...blocked } }];

  for (let day = 1; day <= TOTAL_DAYS; day += 1) {
    for (const profile of PROFILES) {
      if (!active.has(profile.id)) continue;
      const nextRandom = random.get(profile.id)!;
      balances[profile.id] = Math.max(
        0,
        balances[profile.id] -
          (profile.spend * policy.spendFactor + nextRandom() * profile.spend * 0.45),
      );

      let cause: Cause | null = balances[profile.id] === 0 ? "reserve" : null;
      for (const rule of RULES) {
        if (cause) break;
        if (nextRandom() >= rule.chance * profile.exposure) continue;
        if (nextRandom() < policy.blockChance) {
          blocked[rule.id] += 1;
        } else {
          cause = rule.id;
        }
      }

      if (cause) {
        active.delete(profile.id);
        deaths.set(profile.id, { day, cause });
      }
    }

    history.push({ day, balances: { ...balances }, blocked: { ...blocked } });
    if (active.size === 0) break;
  }

  const duration = history[history.length - 1].day;
  const agents = PROFILES.map((profile): AgentResult => {
    const death = deaths.get(profile.id);
    return {
      ...profile,
      daysSurvived: death ? death.day - 1 : duration,
      deathDay: death?.day ?? null,
      cause: death?.cause ?? null,
    };
  });

  return { duration, agents, history };
}

function DirectEndLabel({
  x,
  y,
  index,
  name,
  color,
  lastIndex,
}: {
  x?: number;
  y?: number;
  index?: number;
  name: string;
  color: string;
  lastIndex: number;
}) {
  if (index !== lastIndex || x === undefined || y === undefined) return null;
  return (
    <text dominantBaseline="middle" fill={color} textAnchor="end" x={x - 8} y={y}>
      {name}
    </text>
  );
}

export function ArenaRoute() {
  const [searchParams, setSearchParams] = useSearchParams();
  const readSeedParam = () => {
    const raw = searchParams.get("seed") ?? "";
    const parsed = /^[1-9]\d*$/.test(raw) ? Number(raw) : NaN;
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : SEED;
  };
  const readStrictnessParam = (): Strictness => {
    const raw = searchParams.get("strictness");
    return STRICTNESS.some((option) => option.id === raw) ? (raw as Strictness) : "balanced";
  };
  const readSpeedParam = () => {
    const raw = searchParams.get("speed") ?? "";
    const parsed = /^(0|[1-9]\d*)$/.test(raw) ? Number(raw) : NaN;
    return Number.isInteger(parsed) && parsed >= 0 && parsed < SPEEDS.length ? parsed : 1;
  };
  const seed = readSeedParam();
  const strictness = readStrictnessParam();
  const speedIndex = readSpeedParam();
  const [simulation, setSimulation] = useState(() => simulate(seed, strictness));
  const [day, setDay] = useState(0);
  const [running, setRunning] = useState(false);

  function updateQuery(patch: Record<string, string>) {
    const nextParams = new URLSearchParams(searchParams);
    const config = {
      seed: String(seed),
      speed: String(speedIndex),
      strictness,
      ...patch,
    };
    for (const [key, value] of Object.entries(config)) {
      nextParams.set(key, value);
    }
    setSearchParams(nextParams);
  }

  useEffect(() => {
    setSimulation(simulate(seed, strictness));
    setDay(0);
    setRunning(false);
  }, [seed, speedIndex, strictness]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(() => {
      const nextDay = Math.min(day + 1, simulation.duration);
      setDay(nextDay);
      if (nextDay >= simulation.duration) setRunning(false);
    }, SPEEDS[speedIndex].interval);
    return () => window.clearTimeout(timer);
  }, [day, running, simulation.duration, speedIndex]);

  const current = simulation.history[Math.min(day, simulation.duration)];
  const visibleAgents = simulation.agents.map((agent) => ({
    ...agent,
    balance: current.balances[agent.id],
    daysAtCurrentPoint: agent.deathDay === null ? day : Math.min(day, agent.daysSurvived),
    isDead: agent.deathDay !== null && agent.deathDay <= day,
  }));
  const lineData: Array<Record<string, number>> = simulation.history
    .slice(0, day + 1)
    .map((snapshot) => ({
      day: snapshot.day,
      ...snapshot.balances,
    }));
  const blockedData = RULES.map((rule) => ({
    label: RULE_LABELS[rule.id],
    count: current.blocked[rule.id],
  }));
  const causeData = (Object.keys(CAUSE_LABELS) as Cause[]).map((cause) => ({
    label: CAUSE_LABELS[cause],
    count: visibleAgents.filter((agent) => agent.isDead && agent.cause === cause).length,
  }));
  const strictnessData = STRICTNESS.map((option) => {
    const compared = simulate(seed, option.id);
    const average =
      compared.agents.reduce((sum, agent) => sum + agent.daysSurvived, 0) / compared.agents.length;
    return { label: option.label, days: Number(average.toFixed(1)) };
  });

  function reset(nextStrictness = strictness) {
    setSimulation(simulate(seed, nextStrictness));
    setDay(0);
    setRunning(false);
  }

  function replay() {
    setSimulation(simulate(seed, strictness));
    setDay(0);
    setRunning(true);
  }

  function selectStrictness(nextStrictness: Strictness) {
    updateQuery({ strictness: nextStrictness });
  }

  function selectSpeed(nextSpeed: number) {
    updateQuery({ speed: String(nextSpeed) });
  }

  return (
    <main className="arena-page" aria-labelledby="arena-title">
      <header className="arena-header">
        <nav aria-label="Arena navigation" className="arena-nav">
          <Link to="/">AEGIS</Link>
          <Link to="/app/overview">Open dashboard</Link>
        </nav>
        <h1 id="arena-title">Survival arena</h1>
        <p className="arena-simulated-label">
          Simulated only. No funds or external services are involved.
        </p>
        <p className="arena-seed">
          Seed {seed} <span aria-hidden="true">/</span> replay produces the exact same run
        </p>
      </header>

      <section aria-label="Simulation controls" className="arena-controls">
        <button
          disabled={running || day >= simulation.duration}
          onClick={() => setRunning(true)}
          type="button"
        >
          Start
        </button>
        <button disabled={!running} onClick={() => setRunning(false)} type="button">
          Pause
        </button>
        <button onClick={() => reset()} type="button">
          Reset
        </button>
        <button onClick={replay} type="button">
          Replay saved run
        </button>
        <label>
          Speed
          <select onChange={(event) => selectSpeed(Number(event.target.value))} value={speedIndex}>
            {SPEEDS.map((speed, index) => (
              <option key={speed.label} value={index}>
                {speed.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Strictness
          <select
            onChange={(event) => selectStrictness(event.target.value as Strictness)}
            value={strictness}
          >
            {STRICTNESS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <p aria-live="off" className="arena-status">
          {running
            ? "Running"
            : day >= simulation.duration
              ? "Complete"
              : day > 0
                ? "Paused"
                : "Ready"}
          {" / "}Day {day} of {simulation.duration}
        </p>
        <span className="sr-only" aria-live="polite" role="status">
          {day === 0
            ? "Simulation ready."
            : day % 5 === 0 || day >= simulation.duration
              ? `Simulation day ${day} of ${simulation.duration}.`
              : ""}
        </span>
      </section>

      <section aria-label="Simulated agent profiles">
        <div
          aria-label="Simulated agent profile table"
          className="arena-agent-table-wrap"
          role="region"
          tabIndex={0}
        >
          <table className="arena-agents">
            <caption>Simulated agent profiles · fake balances only</caption>
            <thead>
              <tr>
                <th scope="col">Agent</th>
                <th scope="col">Status</th>
                <th scope="col">Balance</th>
                <th scope="col">Days survived</th>
                <th scope="col">Cause of death</th>
              </tr>
            </thead>
            <tbody>
              {visibleAgents.map((agent) => (
                <tr key={agent.id}>
                  <th scope="row">{agent.name}</th>
                  <td>
                    <span className={agent.isDead ? "arena-dead" : "arena-alive"}>
                      <span aria-hidden="true">{agent.isDead ? "×" : "●"}</span>{" "}
                      {agent.isDead ? "Dead" : "Alive"}
                    </span>
                  </td>
                  <td>{agent.balance.toFixed(2)} simulated USDC</td>
                  <td>{agent.daysAtCurrentPoint}</td>
                  <td>{agent.isDead ? CAUSE_LABELS[agent.cause!] : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-label="Arena simulation charts" className="arena-charts">
        <ChartFrame
          className="arena-chart-frame"
          rows={visibleAgents.map((agent) => ({
            label: agent.name,
            value: agent.daysAtCurrentPoint,
            detail: agent.isDead ? `Died: ${CAUSE_LABELS[agent.cause!]}` : "Still active",
            key: agent.id,
          }))}
          tableLabel="View as table"
          title="Days survived"
        >
          <div aria-label="Days survived by profile" className="arena-chart" role="img">
            <ResponsiveContainer height="100%" width="100%">
              <BarChart data={visibleAgents}>
                <CartesianGrid stroke="var(--rule)" vertical={false} />
                <XAxis dataKey="name" stroke="var(--muted)" tickLine={false} />
                <YAxis allowDecimals={false} stroke="var(--muted)" tickLine={false} />
                <ReferenceLine y={TOTAL_DAYS} stroke="var(--accent-yellow)" strokeWidth={2} />
                <Tooltip />
                <Bar
                  dataKey="daysAtCurrentPoint"
                  isAnimationActive={day === 0}
                  name="Days survived"
                >
                  {visibleAgents.map((agent) => (
                    <Cell
                      fill={agent.isDead ? "var(--decision-blocked)" : "var(--decision-allowed)"}
                      key={agent.id}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartFrame>

        <ChartFrame
          className="arena-chart-frame"
          rows={lineData.map((point) => ({
            label: `Day ${point.day}`,
            value: PROFILES.map((profile) => `${profile.name}: ${point[profile.id]}`).join("; "),
            key: `day-${point.day}`,
          }))}
          tableLabel="View as table"
          title="Balance over time"
        >
          <div
            aria-label="Balance over time for all five profiles"
            className="arena-chart"
            role="img"
          >
            <ResponsiveContainer height="100%" width="100%">
              <LineChart data={lineData}>
                <CartesianGrid stroke="var(--rule)" vertical={false} />
                <XAxis dataKey="day" stroke="var(--muted)" tickLine={false} />
                <YAxis stroke="var(--muted)" tickLine={false} />
                <ReferenceLine y={0} stroke="var(--accent-yellow)" strokeWidth={2} />
                <Tooltip />
                {PROFILES.map((profile) => (
                  <Line
                    dataKey={profile.id}
                    dot={false}
                    isAnimationActive={day === 0}
                    key={profile.id}
                    name={profile.name}
                    stroke={PROFILE_COLORS[profile.id]}
                    strokeDasharray={PROFILE_DASHES[profile.id]}
                    type="monotone"
                  >
                    <LabelList
                      content={
                        <DirectEndLabel
                          color={PROFILE_COLORS[profile.id]}
                          lastIndex={lineData.length - 1}
                          name={profile.name}
                        />
                      }
                      dataKey={profile.id}
                      position="right"
                    />
                  </Line>
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </ChartFrame>

        <ChartFrame
          className="arena-chart-frame"
          rows={blockedData.map((entry) => ({
            label: entry.label,
            value: entry.count,
            key: entry.label,
          }))}
          tableLabel="View as table"
          title="Blocked attacks by rule"
        >
          <div
            aria-label="Blocked attacks by limit, recipient, contract, and expiry rule"
            className="arena-chart"
            role="img"
          >
            <ResponsiveContainer height="100%" width="100%">
              <BarChart data={blockedData}>
                <CartesianGrid stroke="var(--rule)" vertical={false} />
                <XAxis dataKey="label" stroke="var(--muted)" tickLine={false} />
                <YAxis allowDecimals={false} stroke="var(--muted)" tickLine={false} />
                <Tooltip />
                <Bar
                  dataKey="count"
                  fill="var(--decision-blocked)"
                  isAnimationActive={day === 0}
                  name="Blocked attacks"
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartFrame>

        <ChartFrame
          className="arena-chart-frame"
          rows={causeData.map((entry) => ({
            label: entry.label,
            value: entry.count,
            key: entry.label,
          }))}
          tableLabel="View as table"
          title="Cause of death"
        >
          <div aria-label="Agent deaths by cause" className="arena-chart" role="img">
            <ResponsiveContainer height="100%" width="100%">
              <BarChart data={causeData}>
                <CartesianGrid stroke="var(--rule)" vertical={false} />
                <XAxis dataKey="label" stroke="var(--muted)" tickLine={false} />
                <YAxis allowDecimals={false} stroke="var(--muted)" tickLine={false} />
                <Tooltip />
                <Bar
                  dataKey="count"
                  fill="var(--decision-blocked)"
                  isAnimationActive={day === 0}
                  name="Agent deaths"
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartFrame>

        <ChartFrame
          className="arena-chart-frame"
          rows={strictnessData.map((entry) => ({
            label: entry.label,
            value: entry.days,
            detail: "Average days survived",
            key: entry.label,
          }))}
          tableLabel="View as table"
          title="Strictness vs survival time"
        >
          <div
            aria-label="Average survival time by policy strictness"
            className="arena-chart"
            role="img"
          >
            <ResponsiveContainer height="100%" width="100%">
              <LineChart data={strictnessData}>
                <CartesianGrid stroke="var(--rule)" vertical={false} />
                <XAxis dataKey="label" stroke="var(--muted)" tickLine={false} />
                <YAxis allowDecimals={false} stroke="var(--muted)" tickLine={false} />
                <Tooltip />
                <Line
                  dataKey="days"
                  name="Average days survived"
                  stroke="var(--ink)"
                  type="monotone"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </ChartFrame>
      </section>
    </main>
  );
}
