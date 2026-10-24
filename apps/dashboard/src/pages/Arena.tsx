import { useState, type FormEvent } from "react";
import { apiRequest, errorMessage, formatAtomic, parseUnits } from "../api";
import type { SimulationRun } from "../types";
import { Empty, ErrorBlock, PageHeader, Panel, StatusBadge } from "../ui";

const DEFAULTS = { seed: "42", days: "7", startingBalance: "15", dailyBurn: "1", profile: "scripted-safe", attackTicks: "" };

export function Arena() {
  const [config, setConfig] = useState(DEFAULTS);
  const [runId, setRunId] = useState("");
  const [run, setRun] = useState<SimulationRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setRun(null);
    try {
      const seed = Number(config.seed);
      const days = Number(config.days);
      if (!Number.isSafeInteger(seed)) throw new Error("Seed must be a whole number.");
      if (!Number.isInteger(days) || days < 1 || days > 30) throw new Error("Duration must be between 1 and 30 days.");
      const parts = config.attackTicks.trim() ? config.attackTicks.split(",").map((value) => value.trim()) : [];
      if (parts.some((value) => !/^\d+$/.test(value))) throw new Error("Attack days must be comma-separated whole numbers.");
      const attackTicks = parts.map(Number);
      if (attackTicks.some((tick) => tick < 0 || tick >= days)) throw new Error(`Attack days must be from 0 to ${days - 1}.`);
      const created = await apiRequest<{ id: string }>("/sim/runs", {
        method: "POST",
        body: JSON.stringify({
          seed,
          days,
          startingBalance: parseUnits(config.startingBalance, 6, true),
          dailyBurn: parseUnits(config.dailyBurn, 6, true),
          profile: config.profile,
          attackTicks,
        }),
      });
      if (!created.id) throw new Error("The simulation API did not return a run ID.");
      setRunId(created.id);
      setRun(await apiRequest<SimulationRun>(`/sim/runs/${encodeURIComponent(created.id)}`));
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  async function load(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      setRun(await apiRequest<SimulationRun>(`/sim/runs/${encodeURIComponent(runId.trim())}`));
    } catch (requestError) {
      setRun(null);
      setError(errorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page arena-page">
      <div className="simulation-banner"><span className="simulation-mark" aria-hidden="true">SIM</span><div><strong>Simulation environment</strong><p>Survival Arena uses deterministic simulated balances. It does not read from or submit transactions to Base Sepolia.</p></div></div>
      <PageHeader title="Survival Arena" description="Stress-test policy decisions in an isolated, replayable simulation." />
      {error && <ErrorBlock error={new Error(error)} />}

      <div className="arena-grid">
        <Panel index={1} className="arena-config">
          <div className="panel-top"><div><p className="eyebrow">SCENARIO</p><h2>Configure a run</h2></div></div>
          <form className="form-grid" onSubmit={start}>
            <label>Seed<input type="number" step="1" value={config.seed} onChange={(event) => setConfig({ ...config, seed: event.target.value })} required /></label>
            <label>Duration in days<input type="number" min="1" max="30" step="1" value={config.days} onChange={(event) => setConfig({ ...config, days: event.target.value })} required /></label>
            <label>Starting balance<input type="number" min="0" step="0.000001" value={config.startingBalance} onChange={(event) => setConfig({ ...config, startingBalance: event.target.value })} required /><span className="field-help">Simulated USDC</span></label>
            <label>Daily burn<input type="number" min="0" step="0.000001" value={config.dailyBurn} onChange={(event) => setConfig({ ...config, dailyBurn: event.target.value })} required /><span className="field-help">Simulated USDC</span></label>
            <label>Policy profile<select value={config.profile} onChange={(event) => setConfig({ ...config, profile: event.target.value })}><option value="scripted-safe">Scripted safe</option><option value="scripted-adaptive">Scripted adaptive</option></select></label>
            <label>Attack day indexes<input value={config.attackTicks} onChange={(event) => setConfig({ ...config, attackTicks: event.target.value })} placeholder="Optional · e.g. 2, 4" /></label>
            <div className="form-span-2 form-actions"><button className="button button-primary" type="submit" disabled={busy}>{busy ? "Running simulation…" : "Run simulation"}<span aria-hidden="true">↗</span></button></div>
          </form>
          <div className="arena-replay">
            <div><p className="eyebrow">REPLAY</p><h3>Load an existing run</h3></div>
            <form className="inline-form" onSubmit={load}><label className="grow">Run ID<input value={runId} onChange={(event) => setRunId(event.target.value)} placeholder="Paste a simulation run ID" required /></label><button className="button button-secondary" type="submit" disabled={busy}>Load run</button></form>
          </div>
        </Panel>

        <Panel index={2} className="arena-result">
          <div className="panel-top"><div><p className="eyebrow">REPLAY OUTPUT</p><h2>Run report</h2></div>{run && <StatusBadge status={run.summary?.alive ? "survived" : "completed"} />}</div>
          {!run ? <Empty title="No simulation selected">Run a scenario or load a saved run to view its event record.</Empty> : (
            <>
              <dl className="arena-ledger">
                <div><dt>Run ID</dt><dd><code>{run.id ?? runId}</code></dd></div>
                <div><dt>Seed</dt><dd>{run.summary?.seed ?? "—"}</dd></div>
                <div><dt>Days simulated</dt><dd>{run.summary?.ticks ?? "—"}</dd></div>
                <div><dt>Ending balance</dt><dd>{run.summary?.endingBalance !== undefined ? `${formatAtomic(run.summary.endingBalance)} USDC` : "—"}</dd></div>
                <div><dt>Blocked attacks</dt><dd>{run.summary?.blockedAttacks ?? "—"}</dd></div>
                <div><dt>Event record</dt><dd><code>{run.summary?.eventHash ?? "—"}</code></dd></div>
              </dl>
              {run.summary?.decisions && <p className="muted small">Policy decisions · allow {run.summary.decisions.allow} · approval {run.summary.decisions.needs_approval} · deny {run.summary.decisions.deny}</p>}
              {run.events && run.events.length > 0 ? (
                <div className="table-wrap"><table><thead><tr><th>#</th><th>Day</th><th>Event</th><th className="num-cell">Amount</th><th className="num-cell">Balance</th><th>Details</th></tr></thead><tbody>
                  {run.events.map((item, index) => <tr key={`${String(item.seq ?? index)}-${String(item.kind ?? "event")}`}><td>{String(item.seq ?? index + 1)}</td><td>{String(item.tick ?? "—")}</td><td>{String(item.kind ?? "—")}</td><td className="num-cell num">{item.amount !== undefined ? `${formatAtomic(String(item.amount))} USDC` : "—"}</td><td className="num-cell num">{item.balance !== undefined ? `${formatAtomic(String(item.balance))} USDC` : "—"}</td><td>{String(item.detail ?? "—")}</td></tr>)}
                </tbody></table></div>
              ) : <Empty title="No events in this run" />}
            </>
          )}
        </Panel>
      </div>
    </div>
  );
}
