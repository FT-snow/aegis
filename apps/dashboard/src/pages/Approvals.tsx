import { useEffect, useMemo, useState } from "react";
import { ApiError, apiRequest, errorMessage, formatAtomic, shortAddress } from "../api";
import type { Agent, Approval, Wallet } from "../types";
import { useAppData } from "../appdata";
import { Alert, Empty, ErrorBlock, Loading, OwnerSignDialog, PageHeader, Panel, StatusBadge, type PreparedCall } from "../ui";
import { formatTimestamp } from "../format";

interface ApprovalAction {
  action: "approve" | "deny" | "whitelist";
  approval: Approval;
  wallet: Wallet;
  call: PreparedCall;
  note: string;
}

export function Approvals() {
  const { wallets, walletsLoading, walletsError, refresh } = useAppData();
  const [walletId, setWalletId] = useState("");
  const [approvals, setApprovals] = useState<Approval[] | null>(null);
  const [approvalsError, setApprovalsError] = useState("");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [busyId, setBusyId] = useState("");
  const [actionError, setActionError] = useState("");
  const [recipient, setRecipient] = useState("");
  const [pendingAction, setPendingAction] = useState<ApprovalAction | null>(null);

  useEffect(() => {
    if (!walletId && wallets.length > 0) setWalletId(wallets[0].id);
  }, [wallets]);

  async function load(wallet: string) {
    setApprovals(null);
    setApprovalsError("");
    try {
      const response = await apiRequest<{ approvals: Approval[] }>(`/approvals?walletId=${encodeURIComponent(wallet)}`);
      setApprovals(Array.isArray(response.approvals) ? response.approvals : []);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setApprovalsError("Your session expired. Sign in again.");
        return;
      }
      setApprovalsError(errorMessage(error));
    }
  }

  useEffect(() => {
    if (!walletId) return;
    void load(walletId);
  }, [walletId]);

  useEffect(() => {
    apiRequest<{ agents: Agent[] }>("/agents")
      .then((response) => setAgents(Array.isArray(response.agents) ? response.agents : []))
      .catch(() => setAgents([]));
  }, []);

  const pendingCount = useMemo(() => (approvals ?? []).filter((approval) => approval.status === "pending").length, [approvals]);

  async function act(approval: Approval, wallet: Wallet, action: "approve" | "deny" | "whitelist") {
    if (walletId === "") return;
    const key = `${approval.request_id}:${action}`;
    setBusyId(key);
    setActionError("");
    try {
      const body: { walletId: string; recipient?: string } = { walletId };
      if (action === "whitelist" && recipient.trim()) body.recipient = recipient.trim();
      const response = await apiRequest<{ call: PreparedCall }>(
        `/approvals/${encodeURIComponent(String(approval.request_id))}/${action}`,
        { method: "POST", body: JSON.stringify(body) },
      );
      setPendingAction({
        action,
        approval,
        wallet,
        call: response.call,
        note:
          action === "approve"
            ? "Signing the approve call executes the agent's pending request as addressed."
            : action === "deny"
              ? "Signing the deny call rejects the request. The agent's session key is penalized in the ARE."
              : "The allow call approves this request and whitelists the recipient for future policy-free payments.",
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setActionError("Your session expired. Sign in again.");
      } else if (error instanceof ApiError && error.status === 409) {
        setActionError("This request is no longer pending on-chain (APPROVAL_NOT_PENDING).");
      } else {
        setActionError(errorMessage(error));
      }
    } finally {
      setBusyId("");
    }
  }

  return (
    <div className="page">
      <PageHeader
        title="Approvals"
        description="Requests agents raised that exceed their policy. Decisions return calldata you sign in your wallet."
        actions={<button className="button button-secondary" type="button" onClick={() => { refresh(); if (walletId) void load(walletId); }}>Refresh</button>}
      />

      {walletsError && <Alert kind="info">{walletsError}</Alert>}

      {wallets.length === 0 && !walletsLoading && (
        <Panel index={1}><Empty title="No wallets">The approval inbox is scoped per wallet.</Empty></Panel>
      )}

      {wallets.length > 0 && (
        <div className="page-toolbar reveal" style={{ ["--index" as string]: 1 }}>
          <label className="inline-select">
            <span>Wallet</span>
            <select value={walletId} onChange={(event) => setWalletId(event.target.value)} aria-label="Select wallet">
              {wallets.map((wallet) => <option key={wallet.id} value={wallet.id}>{shortAddress(wallet.address)}</option>)}
            </select>
          </label>
          <span className="badge badge-warn">{pendingCount} pending</span>
        </div>
      )}

      {walletId && approvals === null && !approvalsError && <Panel><Loading label="Loading approvals" /></Panel>}
      {approvalsError && <ErrorBlock error={new Error(approvalsError)} retry={walletId ? () => void load(walletId) : undefined} />}
      {approvals !== null && approvals.length === 0 && (
        <Panel index={2}>
          <Empty title="Inbox clear">
            No approval requests for this wallet. Agents only raise requests when their policy requires it.
          </Empty>
        </Panel>
      )}

      {approvals !== null && approvals.length > 0 && (
        <Panel index={2}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Request</th><th>Agent</th><th>Recipient</th><th className="num-cell">Amount</th><th>Status</th><th>Reason</th><th>Expires</th><th>Decision</th>
                </tr>
              </thead>
              <tbody>
                {approvals.map((approval) => {
                  const agent = agents.find((entry) => entry.id === approval.agent_id);
                  const pending = approval.status === "pending";
                  return (
                    <tr key={approval.id}>
                      <td className="num">{String(approval.request_id)}</td>
                      <td>{agent ? agent.name : <code>{shortAddress(approval.agent_id)}</code>}</td>
                      <td><code title={approval.target}>{shortAddress(approval.target)}</code></td>
                      <td className="num-cell num">{formatAtomic(approval.amount)} USDC</td>
                      <td><StatusBadge status={approval.status} /></td>
                      <td className="reason-cell">{approval.reason || "—"}</td>
                      <td className="num">{approval.expires_at ? formatTimestamp(approval.expires_at) : "—"}</td>
                      <td>
                        <div className="row-actions">
                          <button
                            className="button button-small button-primary"
                            type="button"
                            disabled={!pending || busyId !== "" || walletId === ""}
                            onClick={() => void act(approval, wallets.find((wallet) => wallet.id === walletId)!, "approve")}
                          >
                            {busyId === `${approval.request_id}:approve` ? "…" : "Approve"}
                          </button>
                          <button
                            className="button button-small button-danger"
                            type="button"
                            disabled={!pending || busyId !== "" || walletId === ""}
                            onClick={() => void act(approval, wallets.find((wallet) => wallet.id === walletId)!, "deny")}
                          >
                            {busyId === `${approval.request_id}:deny` ? "…" : "Deny"}
                          </button>
                          <button
                            className="button button-small button-secondary"
                            type="button"
                            disabled={!pending || busyId !== "" || walletId === ""}
                            onClick={() => void act(approval, wallets.find((wallet) => wallet.id === walletId)!, "whitelist")}
                          >
                            {busyId === `${approval.request_id}:whitelist` ? "…" : "Whitelist"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <label className="whitelist-recipient">
            <span>Optional recipient override for whitelist calls</span>
            <input
              value={recipient}
              onChange={(event) => setRecipient(event.target.value)}
              placeholder="0x… (defaults to the address encoded by the API)"
              pattern="^$|^0x[0-9a-fA-F]{40}$"
              spellCheck={false}
            />
          </label>
          {actionError && <Alert>{actionError}</Alert>}
        </Panel>
      )}

      <OwnerSignDialog
        open={pendingAction !== null}
        onClose={() => { setPendingAction(null); if (walletId) void load(walletId); }}
        call={pendingAction?.call ?? null}
        title={pendingAction ? `Owner action · ${pendingAction.action}` : "Owner signature required"}
        contextNote={
          pendingAction
            ? `${pendingAction.note} The request stays pending on-chain until this transaction is confirmed and receipt sync runs.`
            : undefined
        }
      />
    </div>
  );
}
