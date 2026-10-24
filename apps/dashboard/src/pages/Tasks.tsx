import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ApiError, apiRequest, errorMessage, formatAtomic, parseUnits, shortAddress } from "../api";
import type { Agent, Wallet } from "../types";
import { useAppData } from "../appdata";
import { Link } from "../router";
import { Alert, Empty, ErrorBlock, Loading, PageHeader, Panel, StatusBadge } from "../ui";
import { formatTimestamp } from "../format";

interface TaskRecord {
  id: string;
  agent_id?: string;
  wallet_id?: string;
  title?: string;
  goal?: string;
  status: string;
  max_budget?: string;
  budget_spent?: string;
  created_at?: number;
  result_json?: string | null;
  error_json?: string | null;
  [key: string]: unknown;
}

interface TaskEvent {
  id?: string;
  sequence_number?: number;
  event_type?: string;
  status?: string;
  message?: string;
  tool_name?: string;
  created_at?: number;
  transaction_hash?: string;
  userop_hash?: string;
}

const TOOLS = ["get_balance", "get_policy", "browse", "pay", "request_approval", "buy_paid_resource"];

function eventTime(value: unknown): string {
  return typeof value === "number" ? formatTimestamp(value) : "—";
}

export function Tasks() {
  const { wallets } = useAppData();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentError, setAgentError] = useState("");
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [taskApiMissing, setTaskApiMissing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [eventsError, setEventsError] = useState("");
  const [agentId, setAgentId] = useState("");
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [budget, setBudget] = useState("");
  const [deadline, setDeadline] = useState("");
  const [approvalRequired, setApprovalRequired] = useState(true);
  const [allowedTools, setAllowedTools] = useState<string[]>(["get_balance", "get_policy", "browse", "pay", "request_approval", "buy_paid_resource"]);
  const [busy, setBusy] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [formNotice, setFormNotice] = useState("");

  async function loadTasks() {
    setLoading(true);
    setLoadError("");
    setTaskApiMissing(false);
    try {
      const agentResponse = await apiRequest<{ agents: Agent[] }>("/agents");
      const list = Array.isArray(agentResponse.agents) ? agentResponse.agents : [];
      setAgents(list);
      setAgentId((previous) => list.some((agent) => agent.id === previous) ? previous : list[0]?.id ?? "");
      const responses = await Promise.allSettled(list.map((agent) =>
        apiRequest<{ tasks?: TaskRecord[] }>(`/agents/${encodeURIComponent(agent.id)}/tasks`),
      ));
      const collected: TaskRecord[] = [];
      let missing = false;
      const failures: string[] = [];
      responses.forEach((response) => {
        if (response.status === "fulfilled") collected.push(...(response.value.tasks ?? []));
        else if (response.reason instanceof ApiError && response.reason.status === 404) missing = true;
        else failures.push(errorMessage(response.reason));
      });
      collected.sort((left, right) => (right.created_at ?? 0) - (left.created_at ?? 0));
      setTasks(collected);
      setTaskApiMissing(missing);
      if (failures.length > 0) setLoadError(failures[0]);
    } catch (error) {
      setAgents([]);
      setTasks([]);
      setAgentError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadTasks(); }, []);

  useEffect(() => {
    if (!selectedId) { setEvents([]); return; }
    let current = true;
    setEventsError("");
    apiRequest<{ events?: TaskEvent[] }>(`/tasks/${encodeURIComponent(selectedId)}/events`)
      .then((response) => { if (current) setEvents(response.events ?? []); })
      .catch((error: unknown) => { if (current) { setEvents([]); setEventsError(errorMessage(error)); } });
    return () => { current = false; };
  }, [selectedId]);

  const selectedTask = useMemo(() => tasks.find((task) => task.id === selectedId) ?? null, [tasks, selectedId]);
  const agent = agents.find((item) => item.id === agentId);
  const agentWallet = wallets.find((wallet: Wallet) => wallet.id === (agent?.wallet_id ?? agent?.walletId));

  function toggleTool(tool: string) {
    setAllowedTools((current) => current.includes(tool) ? current.filter((item) => item !== tool) : [...current, tool]);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFormError("");
    setFormNotice("");
    try {
      if (!agentId) throw new Error("Choose an agent before assigning a task.");
      if (allowedTools.length === 0) throw new Error("Choose at least one tool for this task.");
      const maxBudget = parseUnits(budget, 6);
      const response = await apiRequest<{ task?: TaskRecord }>(`/agents/${encodeURIComponent(agentId)}/tasks`, {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          goal: goal.trim(),
          maxBudget,
          allowedTools,
          approvalRequired,
          ...(deadline ? { deadline: Math.floor(new Date(deadline).getTime() / 1000) } : {}),
        }),
      });
      if (!response.task?.id) throw new Error("The API did not return a task record. No task status is being shown.");
      setTasks((current) => [response.task!, ...current]);
      setSelectedId(response.task.id);
      setTitle("");
      setGoal("");
      setBudget("");
      setDeadline("");
      setFormNotice("Task record received from the API. Follow its live status and event history below.");
    } catch (error) {
      setFormError(errorMessage(error));
      if (error instanceof ApiError && error.status === 404) setTaskApiMissing(true);
    } finally {
      setBusy(false);
    }
  }

  async function cancelTask() {
    if (!selectedTask) return;
    setCancelBusy(true);
    setFormError("");
    try {
      await apiRequest(`/tasks/${encodeURIComponent(selectedTask.id)}/cancel`, { method: "POST", body: "{}" });
      await loadTasks();
      setFormNotice("Cancellation request sent. The task status will change only when the API reports it.");
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setCancelBusy(false);
    }
  }

  return (
    <div className="page tasks-page">
      <PageHeader
        title="Tasks"
        description="Give an agent an outcome to achieve. A task budget can narrow permissions, never expand them."
        actions={<button className="button button-secondary" type="button" onClick={() => void loadTasks()} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button>}
      />

      {taskApiMissing && <Alert kind="info">Task execution endpoints are not available in the current API build. This page will report the API response; it will not create simulated tasks.</Alert>}
      {agentError && <ErrorBlock error={new Error(agentError)} />}
      {loadError && <ErrorBlock error={new Error(loadError)} retry={() => void loadTasks()} />}

      <div className="tasks-layout">
        <Panel className="task-composer" index={1}>
          <div className="panel-top"><div><p className="eyebrow">NEW OBJECTIVE</p><h2>Assign a task</h2></div><span className="task-step">01 / GOAL</span></div>
          {agents.length === 0 && !loading ? (
            <Empty title="An agent is required" action={<Link to="/agents" className="button button-primary">Create an agent</Link>}>Authorize an agent before assigning work to it.</Empty>
          ) : (
            <form className="task-form" onSubmit={submit}>
              <label>Agent
                <select value={agentId} onChange={(event) => setAgentId(event.target.value)} required disabled={agents.length === 0}>
                  {agents.length === 0 && <option value="">Loading agents…</option>}
                  {agents.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.status}</option>)}
                </select>
                {agent && <span className="field-help">Wallet {shortAddress(agentWallet?.address)} · {agent.profile}</span>}
              </label>
              <label>Task title
                <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} placeholder="Purchase a research report" required />
              </label>
              <label>What should the agent accomplish?
                <textarea value={goal} onChange={(event) => setGoal(event.target.value)} rows={5} maxLength={4000} placeholder="Find the required research data from the approved API, purchase access if needed, and summarize the findings. Do not spend more than the budget below." required />
              </label>
              <div className="task-fields-row">
                <label>Maximum task budget <span className="input-suffix"><input type="number" min="0.000001" max="1000000" step="0.000001" inputMode="decimal" value={budget} onChange={(event) => setBudget(event.target.value)} placeholder="3.00" required /><span>USDC</span></span></label>
                <label>Deadline <span className="field-help">Optional</span><input type="datetime-local" value={deadline} onChange={(event) => setDeadline(event.target.value)} /></label>
              </div>
              <fieldset className="tool-selector">
                <legend>Tools available to this task</legend>
                <div className="tool-grid">
                  {TOOLS.map((tool) => (
                    <label className="tool-option" key={tool}><input type="checkbox" checked={allowedTools.includes(tool)} onChange={() => toggleTool(tool)} /><span>{tool.replace(/_/g, " ")}</span></label>
                  ))}
                </div>
              </fieldset>
              <label className="approval-toggle"><input type="checkbox" checked={approvalRequired} onChange={(event) => setApprovalRequired(event.target.checked)} /><span>Pause for owner approval when a payment requires it.</span></label>
              <div className="permission-note"><span className="note-mark" aria-hidden="true">i</span><p>Task budget is an execution limit, not a new wallet permission. The agent remains bound by its on-chain session policy.</p></div>
              {formError && <Alert>{formError}</Alert>}
              {formNotice && <Alert kind="success">{formNotice}</Alert>}
              <button className="button button-primary button-large task-submit" type="submit" disabled={busy || loading || agents.length === 0}>
                {busy ? "Submitting task…" : "Assign task"}<span aria-hidden="true">↗</span>
              </button>
            </form>
          )}
        </Panel>

        <div className="task-monitor">
          <Panel index={2}>
            <div className="panel-top"><div><p className="eyebrow">EXECUTION</p><h2>Task activity</h2></div><span className="muted small">API-reported</span></div>
            {loading ? <Loading label="Loading task records" /> : tasks.length === 0 ? (
              <Empty title="No task records" />
            ) : (
              <ul className="task-list">
                {tasks.map((task) => {
                  const taskAgent = agents.find((item) => item.id === task.agent_id);
                  return (
                    <li key={task.id}>
                      <button type="button" className={`task-list-item${selectedId === task.id ? " selected" : ""}`} onClick={() => setSelectedId(task.id)}>
                        <span className="task-list-main"><strong>{task.title ?? "Untitled task"}</strong><small>{taskAgent?.name ?? shortAddress(task.agent_id)} · {task.created_at ? formatTimestamp(task.created_at) : "Time unavailable"}</small></span>
                        <StatusBadge status={task.status} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          <Panel index={3}>
            <div className="panel-top"><div><p className="eyebrow">EVENT LOG</p><h2>{selectedTask?.title ?? "Execution timeline"}</h2></div>{selectedTask && <StatusBadge status={selectedTask.status} />}</div>
            {!selectedTask ? <p className="muted">Select an API-reported task to inspect its events.</p> : (
              <>
                <dl className="task-budget-ledger">
                  <div><dt>Budget</dt><dd>{selectedTask.max_budget ? `${formatAtomic(selectedTask.max_budget)} USDC` : "Not reported"}</dd></div>
                  <div><dt>Spent</dt><dd>{selectedTask.budget_spent ? `${formatAtomic(selectedTask.budget_spent)} USDC` : "0 USDC reported"}</dd></div>
                </dl>
                {eventsError && <Alert kind="info">Timeline could not be loaded: {eventsError}</Alert>}
                {events.length === 0 && !eventsError && <Empty title="No task events returned" />}
                {events.length > 0 && (
                  <ol className="timeline">
                    {events.map((event, index) => (
                      <li className="timeline-item" key={event.id ?? `${event.sequence_number ?? index}-${event.event_type ?? "event"}`}>
                        <span className="timeline-node" aria-hidden="true" />
                        <div className="timeline-content">
                          <div className="timeline-heading"><strong>{(event.event_type ?? "task event").replace(/_/g, " ")}</strong><span>{eventTime(event.created_at)}</span></div>
                          {event.message && <p>{event.message}</p>}
                          {event.tool_name && <span className="tool-tag">{event.tool_name}</span>}
                          {event.userop_hash && <code className="break-all">UserOperation · {event.userop_hash}</code>}
                          {event.transaction_hash && <a className="text-button" href={`https://sepolia.basescan.org/tx/${event.transaction_hash}`} target="_blank" rel="noreferrer">View transaction ↗</a>}
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
                {["queued", "planning", "running", "waiting_for_payment", "waiting_for_approval", "resuming"].includes(selectedTask.status) && (
                  <button className="button button-danger" type="button" disabled={cancelBusy} onClick={() => void cancelTask()}>{cancelBusy ? "Requesting cancellation…" : "Cancel task"}</button>
                )}
              </>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
