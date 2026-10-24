import { useEffect, useState } from "react";
import { ApiError, apiRequest, errorMessage, formatAtomic } from "../api";
import { useAppData } from "../appdata";
import { Alert, Empty, ErrorBlock, Loading, PageHeader, Panel, StatusBadge } from "../ui";
import { explorerTxUrl, formatTimestamp } from "../format";

interface TransactionRow {
  id: string;
  wallet_id: string;
  agent_id?: string | null;
  userop_hash?: string | null;
  tx_hash?: string | null;
  token?: string;
  recipient: string;
  amount: string;
  status: string;
  source: string;
  created_at: number;
  [key: string]: unknown;
}

const SOURCE_LABELS: Record<string, string> = {
  "owner-dashboard": "Owner dashboard",
  "agent-gateway": "Agent gateway",
  "agent-approval": "Agent approval",
};

export function Transactions() {
  const { wallets, walletsLoading } = useAppData();
  const [walletId, setWalletId] = useState("");
  const [rows, setRows] = useState<TransactionRow[] | null>(null);
  const [error, setError] = useState("");
  const [notAvailable, setNotAvailable] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!walletId && wallets.length > 0) setWalletId(wallets[0].id);
  }, [wallets]);

  useEffect(() => {
    if (!walletId) {
      setLoading(false);
      return;
    }
    let current = true;
    setLoading(true);
    setError("");
    setNotAvailable(false);
    apiRequest<{ transactions?: TransactionRow[] }>(`/transactions?walletId=${encodeURIComponent(walletId)}`)
      .then((response) => {
        if (!current) return;
        setRows(Array.isArray(response.transactions) ? response.transactions : []);
      })
      .catch((requestError: unknown) => {
        if (!current) return;
        if (requestError instanceof ApiError && requestError.status === 404) {
          // The transactions listing route may not exist on this API build yet.
          setNotAvailable(true);
          setRows([]);
          return;
        }
        setError(errorMessage(requestError));
      })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [walletId]);

  return (
    <div className="page">
      <PageHeader
        title="Transactions"
        description="Prepared, submitted, and confirmed transfers reported by the API."
      />

      {wallets.length === 0 && !walletsLoading && (
        <Panel index={1}><Empty title="No wallets">Transactions are scoped per wallet.</Empty></Panel>
      )}

      {wallets.length > 0 && (
        <div className="page-toolbar reveal" style={{ ["--index" as string]: 1 }}>
          <label className="inline-select">
            <span>Wallet</span>
            <select value={walletId} onChange={(event) => setWalletId(event.target.value)} aria-label="Select wallet">
              {wallets.map((wallet) => (
                <option key={wallet.id} value={wallet.id}>{wallet.address.slice(0, 10)}…{wallet.address.slice(-6)}</option>
              ))}
            </select>
          </label>
        </div>
      )}

      {walletId && loading && <Panel><Loading label="Loading transactions" /></Panel>}
      {error && <ErrorBlock error={new Error(error)} />}

      {notAvailable && (
        <Panel index={2}>
          <Alert kind="info">
            The transactions listing endpoint (GET /api/transactions) is not available on this API build yet (HTTP 404).
            Prepared owner transfers still appear on each wallet page; agent activity is visible under events.
          </Alert>
        </Panel>
      )}

      {!loading && !notAvailable && !error && walletId && rows && rows.length === 0 && (
        <Panel index={2}>
          <Empty title="No transactions yet" action={null}>
            Prepared transfers appear here once the API records them.
          </Empty>
        </Panel>
      )}

      {!loading && !notAvailable && !error && rows && rows.length > 0 && (
        <Panel index={2}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Tx</th><th>Recipient</th><th className="num-cell">Amount</th><th>Status</th><th>Source</th><th>Created</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const txUrl = explorerTxUrl(row.tx_hash ?? row.userop_hash ?? null);
                  return (
                    <tr key={row.id}>
                      <td>{txUrl ? <a href={txUrl} target="_blank" rel="noreferrer" className="text-button">{row.tx_hash ? `${row.tx_hash.slice(0, 10)}…` : `${(row.userop_hash ?? "").slice(0, 10)}…`}</a> : <code className="muted">{row.tx_hash ?? row.userop_hash ?? "—"}</code>}</td>
                      <td><code title={row.recipient}>{row.recipient.slice(0, 10)}…{row.recipient.slice(-6)}</code></td>
                      <td className="num-cell num">{formatAtomic(row.amount)} USDC</td>
                      <td><StatusBadge status={row.status} /></td>
                      <td>{SOURCE_LABELS[row.source] ?? row.source}</td>
                      <td className="num">{formatTimestamp(row.created_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}
