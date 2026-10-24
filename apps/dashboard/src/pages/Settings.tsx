import { useEffect, useState } from "react";
import { apiRequest, errorMessage } from "../api";
import { useAppData } from "../appdata";
import { Alert, CopyButton, ErrorBlock, Loading, PageHeader, Panel, StatusBadge } from "../ui";
import { explorerAddressUrl, formatTimestamp, truncateMiddle } from "../format";

interface Health {
  service?: string;
  status?: string;
  environment?: string;
  chain?: { configured?: boolean; submission?: string };
}

export function Settings() {
  const { user, wallets, sessionExpiresAt, signOut } = useAppData();
  const [health, setHealth] = useState<Health | null>(null);
  const [healthError, setHealthError] = useState("");
  const [loading, setLoading] = useState(true);
  const [logoutError, setLogoutError] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    let current = true;
    apiRequest<Health>("/health")
      .then((response) => { if (current) setHealth(response); })
      .catch((error: unknown) => { if (current) setHealthError(errorMessage(error)); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, []);

  async function handleSignOut() {
    setLoggingOut(true);
    setLogoutError("");
    try {
      await signOut();
    } catch (error) {
      setLogoutError(errorMessage(error));
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <div className="page settings-page">
      <PageHeader title="Settings" description="Account, network, and session information for this workspace." />
      <div className="settings-grid">
        <Panel index={1}>
          <div className="panel-top"><div><p className="eyebrow">ACCOUNT</p><h2>Signed-in identity</h2></div></div>
          <dl className="kv-ledger">
            <div><dt>Email</dt><dd>{user?.email ?? "—"}</dd></div>
            <div><dt>Account ID</dt><dd><code>{user?.id ?? "—"}</code>{user?.id && <CopyButton value={user.id} />}</dd></div>
            <div><dt>Session expiry</dt><dd>{sessionExpiresAt ? formatTimestamp(sessionExpiresAt) : "Not reported by API"}</dd></div>
          </dl>
          {logoutError && <Alert>{logoutError}</Alert>}
          <button className="button button-danger settings-signout" type="button" disabled={loggingOut} onClick={() => void handleSignOut()}>{loggingOut ? "Signing out…" : "Sign out"}</button>
        </Panel>

        <Panel index={2}>
          <div className="panel-top"><div><p className="eyebrow">NETWORK</p><h2>Execution environment</h2></div><span className="chain-badge"><span className="chain-dot" /> Base Sepolia</span></div>
          {loading ? <Loading label="Reading environment" /> : healthError ? <ErrorBlock error={new Error(healthError)} /> : (
            <dl className="kv-ledger">
              <div><dt>Environment</dt><dd>{health?.environment ?? "Not reported"}</dd></div>
              <div><dt>Chain</dt><dd>Base Sepolia · 84532</dd></div>
              <div><dt>RPC status</dt><dd><StatusBadge status={health?.chain?.configured ? "configured" : health?.chain?.configured === false ? "unavailable" : "unknown"} /></dd></div>
              <div><dt>Transaction submission</dt><dd>{health?.chain?.submission ?? "Not reported"}</dd></div>
              <div><dt>Service health</dt><dd><StatusBadge status={health?.status ?? "unknown"} /></dd></div>
            </dl>
          )}
          <p className="muted small">AEGIS is configured for Base Sepolia. Wallet balances and transaction states are only shown when returned by the API or chain.</p>
        </Panel>

        <Panel index={3} className="settings-wallets">
          <div className="panel-top"><div><p className="eyebrow">OWNER CONTROL</p><h2>Enrolled wallets</h2></div><span className="muted small">{wallets.length} total</span></div>
          {wallets.length === 0 ? <p className="muted">No wallets are enrolled on this account.</p> : (
            <ul className="settings-wallet-list">
              {wallets.map((wallet) => {
                const owner = wallet.owner_address ?? wallet.ownerAddress;
                const explorer = explorerAddressUrl(owner);
                return <li key={wallet.id}><div><strong>{truncateMiddle(wallet.address, 10, 8)}</strong><code>{owner ?? "Owner not reported"}</code></div>{explorer ? <a href={explorer} target="_blank" rel="noreferrer" className="text-button">Owner on BaseScan ↗</a> : null}</li>;
              })}
            </ul>
          )}
        </Panel>

        <Panel index={4}>
          <div className="panel-top"><div><p className="eyebrow">PRIVACY</p><h2>Signing keys stay yours.</h2></div></div>
          <p className="muted">The owner wallet signs authorization in your browser wallet. AEGIS does not ask for or store your owner private key.</p>
          <div className="privacy-rule"><span className="privacy-rule-mark" aria-hidden="true" /><span>Review the network and transaction details in your wallet before signing.</span></div>
        </Panel>
      </div>
    </div>
  );
}
