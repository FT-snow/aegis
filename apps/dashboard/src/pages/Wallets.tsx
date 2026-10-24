import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ApiError, apiRequest, errorMessage, formatAtomic, parseUnits, shortAddress } from "../api";
import type { Agent, Wallet } from "../types";
import { useAppData } from "../appdata";
import { Alert, CopyButton, Empty, ErrorBlock, Loading, Modal, PageHeader, Panel, StatusBadge } from "../ui";
import { Link } from "../router";
import { bytesToHexUtf8, explorerAddressUrl, formatTimestamp, truncateMiddle } from "../format";

type SignPath = "injected" | "external";

interface ChallengeResponse {
  challengeId: string;
  nonce: string;
  message: string;
  walletAddress: string;
  factory: string;
  expiresAt: number;
}

interface EnrollResponse {
  wallet: { id: string; chainId: number; address: string; ownerAddress: string; env: string; deploymentStatus: string; factory: string; salt: string };
}

const FAUCETS = [
  { name: "Base faucet (ETH for gas)", url: "https://faucet.base.org" },
  { name: "Alchemy Base Sepolia faucet", url: "https://www.alchemy.com/faucets/base-sepolia" },
  { name: "Circle testnet faucet (USDC)", url: "https://faucet.circle.com" },
];

function deploymentLabel(status: string | null | undefined): { text: string; group: "good" | "warn" | "bad" } {
  switch (status) {
    case "deployed":
      return { text: "Deployed", group: "good" };
    case "submitted":
      return { text: "Deployment submitted", group: "warn" };
    case "failed":
      return { text: "Deployment failed", group: "bad" };
    default:
      return { text: "Counterfactual · undeployed", group: "warn" };
  }
}

function CreateWalletDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { refresh } = useAppData();
  const [ownerAddress, setOwnerAddress] = useState("");
  const [salt, setSalt] = useState("0");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [challenge, setChallenge] = useState<ChallengeResponse | null>(null);
  const [signature, setSignature] = useState("");
  const [signPath, setSignPath] = useState<SignPath | null>(null);
  const [created, setCreated] = useState<EnrollResponse["wallet"] | null>(null);
  const hasInjected = typeof window !== "undefined" && typeof (window as { ethereum?: unknown }).ethereum === "object";

  async function connectOwner() {
    setError("");
    try {
      const ethereum = (window as { ethereum?: { request(args: { method: string; params?: unknown[] }): Promise<unknown> } }).ethereum;
      if (!ethereum) throw new Error("No browser wallet was detected. Enter the owner address and sign externally instead.");
      const accounts = await ethereum.request({ method: "eth_requestAccounts" });
      if (!Array.isArray(accounts) || typeof accounts[0] !== "string") throw new Error("Unlock your wallet and choose an owner account.");
      const chainId = await ethereum.request({ method: "eth_chainId" });
      if (chainId !== "0x14a34") {
        await ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x14a34" }] });
      }
      setOwnerAddress(accounts[0]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not connect the owner wallet.");
    }
  }

  function reset() {
    setOwnerAddress("");
    setSalt("0");
    setError("");
    setChallenge(null);
    setSignature("");
    setSignPath(null);
    setCreated(null);
    setBusy(false);
  }

  function close() {
    onClose();
    if (created) refresh();
    reset();
  }

  async function requestChallenge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const chainId = 84532;
      const response = await apiRequest<ChallengeResponse>("/wallets/challenge", {
        method: "POST",
        body: JSON.stringify({ ownerAddress: ownerAddress.trim(), chainId, salt: salt.trim() === "" ? "0" : salt.trim() }),
      });
      setChallenge(response);
      setSignPath(hasInjected ? "injected" : "external");
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  async function signWithInjected() {
    if (!challenge) return;
    setError("");
    setBusy(true);
    try {
      const ethereum = (window as { ethereum?: { request(args: { method: string; params?: unknown[] }): Promise<unknown> } }).ethereum;
      if (!ethereum) throw new Error("No injected wallet found.");
      const signatureHex = await ethereum.request({
        method: "personal_sign",
        params: [bytesToHexUtf8(challenge.message), ownerAddress.trim()],
      });
      if (typeof signatureHex !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(signatureHex)) {
        throw new Error("The injected wallet returned a signature in an unexpected format.");
      }
      await enroll(signatureHex, "injected");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Signing failed.");
    } finally {
      setBusy(false);
    }
  }

  async function enroll(signatureHex: string, path: SignPath) {
    if (!challenge) return;
    setError("");
    setBusy(true);
    try {
      const response = await apiRequest<EnrollResponse>("/wallets", {
        method: "POST",
        body: JSON.stringify({
          ownerAddress: ownerAddress.trim(),
          chainId: 84532,
          salt: salt.trim() === "" ? "0" : salt.trim(),
          challengeId: challenge.challengeId,
          nonce: challenge.nonce,
          signature: signatureHex,
        }),
      });
      setCreated(response.wallet);
      setSignPath(path);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  async function submitPasted(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await enroll(signature.trim(), "external");
  }

  return (
    <Modal open={open} onClose={close} title="Create wallet">
      <div className="dialog-stack">
        {created ? (
          <>
            <Alert kind="success">
              Wallet enrolled via {signPath === "injected" ? "injected wallet signature (EIP-1193 personal_sign)" : "externally signed message (signature pasted)"}.
            </Alert>
            <dl className="kv-ledger">
              <div><dt>Wallet address</dt><dd><code className="break-all">{created.address}</code> <CopyButton value={created.address} /></dd></div>
              <div><dt>Predicted from factory</dt><dd><code className="break-all">{created.factory}</code></dd></div>
              <div><dt>Salt</dt><dd className="num">{created.salt}</dd></div>
              <div><dt>Deployment status</dt><dd><StatusBadge status={created.deploymentStatus} /></dd></div>
            </dl>
            <p className="muted small">
              The wallet exists as a record and derives at its factory address. Until it is deployed, the first user operation deploys it.
              Fund it before use — see the funding instructions on the wallet page.
            </p>
          </>
        ) : !challenge ? (
          <>
            <p className="muted">
              The API derives the account address from the factory, owner address, and salt, then issues a one-time challenge message
              that must be signed by the owner key. Chain is fixed to Base Sepolia (84532).
            </p>
            {error && <Alert>{error}</Alert>}
            <form className="form-stack" onSubmit={requestChallenge}>
              {hasInjected && <button className="button button-secondary" type="button" onClick={() => void connectOwner()}>Connect owner wallet</button>}
              <label>
                Owner address
                <input
                  value={ownerAddress}
                  onChange={(event) => setOwnerAddress(event.target.value)}
                  placeholder="0x…"
                  pattern="^0x[0-9a-fA-F]{40}$"
                  autoComplete="off"
                  spellCheck={false}
                  required
                />
              </label>
              <label>
                Salt
                <input value={salt} onChange={(event) => setSalt(event.target.value)} inputMode="numeric" pattern="^(0|[1-9][0-9]{0,77})$" required />
                <span className="field-help">Whole number. Changing it derives a different account address.</span>
              </label>
              <div className="modal-actions-inline">
                <button className="button button-primary" type="submit" disabled={busy}>{busy ? "Requesting…" : "Request challenge"}</button>
                <span className="muted small">{hasInjected ? "Injected wallet detected — you can sign with it next." : "No injected wallet — you can sign externally and paste the signature."}</span>
              </div>
            </form>
          </>
        ) : (
          <>
            <dl className="kv-ledger">
              <div><dt>Derived wallet address</dt><dd><code className="break-all">{challenge.walletAddress}</code></dd></div>
              <div><dt>Factory</dt><dd><code className="break-all">{challenge.factory}</code></dd></div>
              <div><dt>Challenge expires</dt><dd>{formatTimestamp(challenge.expiresAt)}</dd></div>
            </dl>
            <details className="message-details">
              <summary>Challenge message to sign</summary>
              <pre className="json-block">{challenge.message}</pre>
              <CopyButton value={challenge.message} label="Copy message" />
            </details>
            {error && <Alert>{error}</Alert>}
            {hasInjected && (
              <div className="sign-path-block">
                <p className="path-label">Path A · Injected wallet <span className="badge badge-good">EIP-1193 personal_sign</span></p>
                <button className="button button-primary" type="button" disabled={busy} onClick={() => void signWithInjected()}>
                  {busy ? "Waiting for wallet…" : "Sign with injected wallet"}
                </button>
              </div>
            )}
            <div className="sign-path-block">
              <p className="path-label">Path B · External signing <span className="badge badge-neutral">paste signature</span></p>
              <p className="muted small">Sign the challenge message with the owner key in any EIP-191 personal_sign tool, then paste the raw signature (0x + 130 hex characters). This dashboard does not sign for you.</p>
              <form className="form-stack" onSubmit={submitPasted}>
                <label>
                  Signature
                  <input
                    value={signature}
                    onChange={(event) => setSignature(event.target.value)}
                    placeholder="0x…"
                    pattern="^0x[0-9a-fA-F]{130}$"
                    spellCheck={false}
                    autoComplete="off"
                    required
                  />
                </label>
                <button className="button button-secondary" type="submit" disabled={busy}>Submit pasted signature</button>
              </form>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

export function Wallets() {
  const { wallets, walletsLoading, walletsError, refresh } = useAppData();
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [agentsError, setAgentsError] = useState("");
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    let current = true;
    apiRequest<{ agents: Agent[] }>("/agents")
      .then((response) => { if (current) setAgents(Array.isArray(response.agents) ? response.agents : []); })
      .catch((error: unknown) => {
        if (!current) return;
        if (error instanceof ApiError && error.status === 401) return;
        setAgentsError(errorMessage(error));
      });
    return () => { current = false; };
  }, []);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return wallets;
    return wallets.filter((wallet) =>
      wallet.address.toLowerCase().includes(query) ||
      (wallet.owner_address ?? wallet.ownerAddress ?? "").toLowerCase().includes(query) ||
      wallet.id.toLowerCase().includes(query));
  }, [wallets, search]);

  return (
    <div className="page">
      <PageHeader
        title="Wallets"
        description="Smart accounts derived by the Aegis factory on Base Sepolia."
        actions={<button className="button button-primary" type="button" onClick={() => setCreateOpen(true)}>Create wallet</button>}
      />

      {walletsError && <ErrorBlock error={new Error(walletsError)} retry={refresh} />}
      {agentsError && <Alert kind="info">Agent assignment data: {agentsError}</Alert>}

      {wallets.length > 0 && (
        <div className="page-toolbar reveal" style={{ ["--index" as string]: 1 }}>
          <label className="search-field">
            <span className="sr-only">Search wallets</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by address, owner, or wallet id"
              aria-label="Search wallets"
            />
          </label>
          <span className="muted small">{filtered.length} of {wallets.length}</span>
        </div>
      )}

      {walletsLoading && <Panel><Loading label="Loading wallets" /></Panel>}

      {!walletsLoading && wallets.length === 0 && !walletsError && (
        <Panel index={1}>
          <Empty
            title="No wallets yet"
            action={<button className="button button-primary" type="button" onClick={() => setCreateOpen(true)}>Create your first wallet</button>}
          >
            Enroll a smart account by deriving it from the Aegis factory and signing the owner challenge.
          </Empty>
        </Panel>
      )}

      {!walletsLoading && filtered.length === 0 && wallets.length > 0 && (
        <Panel index={1}><Empty title="No matches">No wallet matches that search.</Empty></Panel>
      )}

      <div className="card-grid">
        {filtered.map((wallet, index) => {
          const deployment = deploymentLabel(wallet.deployment_status ?? wallet.deploymentStatus);
          const explorer = explorerAddressUrl(wallet.address);
          const walletAgents = (agents ?? []).filter((agent) => agent.wallet_id === wallet.id || agent.walletId === wallet.id);
          return (
            <Panel key={wallet.id} className="wallet-card" index={index + 1}>
              <div className="panel-top">
                <h2 className="wallet-name"><code title={wallet.address}>{truncateMiddle(wallet.address, 10, 8)}</code></h2>
                <span className={`badge badge-${deployment.group}`}>{deployment.text}</span>
              </div>
              <dl className="kv-ledger">
                <div>
                  <dt>Address</dt>
                  <dd className="dd-actions"><code className="break-all">{wallet.address}</code> <CopyButton value={wallet.address} /></dd>
                </div>
                <div>
                  <dt>Balance</dt>
                  <dd className="num">
                    {wallet.balance ? `${formatAtomic(wallet.balance.atomic, wallet.balance.decimals)} ${wallet.balance.symbol}` : (wallet.balanceError ? "Unavailable" : "—")}
                  </dd>
                </div>
                <div>
                  <dt>Chain</dt>
                  <dd className="num">{wallet.chain_id ?? wallet.chainId ?? "—"}</dd>
                </div>
                <div>
                  <dt>Agents</dt>
                  <dd className="num">{agents === null ? "…" : walletAgents.length}</dd>
                </div>
              </dl>
              {wallet.balanceError && wallet.balanceError !== "RPC_OR_CHAIN_NOT_CONFIGURED" && (
                <p className="muted small">Balance read failed: {wallet.balanceError}</p>
              )}
              <div className="row-actions">
                <Link to={`/wallets/${encodeURIComponent(wallet.id)}`} className="button button-secondary button-small">Details</Link>
                {explorer && (
                  <a className="button button-secondary button-small" href={explorer} target="_blank" rel="noreferrer">Explorer ↗</a>
                )}
              </div>
            </Panel>
          );
        })}
      </div>

      <CreateWalletDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}

export function WalletDetail({ walletId }: { walletId: string }) {
  const { wallets, refresh } = useAppData();
  const [detail, setDetail] = useState<(Wallet & { testnetOnly?: boolean }) | null>(null);
  const [detailError, setDetailError] = useState("");
  const [detailLoading, setDetailLoading] = useState(true);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentsError, setAgentsError] = useState("");
  const [policies, setPolicies] = useState<Record<string, unknown>>({});
  const [policiesError, setPoliciesError] = useState("");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [transferBusy, setTransferBusy] = useState(false);
  const [transferError, setTransferError] = useState("");
  const [transferResult, setTransferResult] = useState<unknown>(null);
  const [transferOpen, setTransferOpen] = useState(false);

  async function loadAll() {
    setDetailLoading(true);
    setDetailError("");
    setAgentsError("");
    setPoliciesError("");
    try {
      const response = await apiRequest<{ wallet: Wallet; balance?: Wallet["balance"]; error?: string; testnetOnly?: boolean }>(
        `/wallets/${encodeURIComponent(walletId)}`,
      );
      setDetail({ ...response.wallet, balance: response.balance ?? response.wallet.balance ?? null, testnetOnly: response.testnetOnly });
      if (response.error) setDetailError(response.error);
    } catch (error) {
      setDetailError(errorMessage(error));
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
    try {
      const response = await apiRequest<{ agents: Agent[] }>(`/agents?walletId=${encodeURIComponent(walletId)}`);
      const list = Array.isArray(response.agents) ? response.agents : [];
      setAgents(list);
      const loaded: Record<string, unknown> = {};
      await Promise.allSettled(list
        .filter((agent) => typeof agent.session_key_address === "string" || typeof agent.sessionKeyAddress === "string")
        .map(async (agent) => {
          const key = agent.session_key_address ?? agent.sessionKeyAddress ?? "";
          try {
            const policy = await apiRequest<Record<string, unknown>>(
              `/policy?walletId=${encodeURIComponent(walletId)}&keyAddress=${encodeURIComponent(key)}`,
            );
            loaded[agent.id] = policy;
          } catch {
            loaded[agent.id] = null; // POLICY_NOT_FOUND and similar
          }
        }));
      setPolicies(loaded);
    } catch (error) {
      setAgentsError(errorMessage(error));
    }
  }

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletId]);

  async function prepareTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTransferError("");
    setTransferResult(null);
    setTransferBusy(true);
    try {
      const atomic = parseUnits(amount, 6);
      const result = await apiRequest<unknown>(`/wallets/${encodeURIComponent(walletId)}/transfers/prepare`, {
        method: "POST",
        body: JSON.stringify({ recipient: recipient.trim(), amount: atomic }),
      });
      setTransferResult(result);
      setTransferOpen(true);
      refresh();
    } catch (requestError) {
      setTransferError(errorMessage(requestError));
    } finally {
      setTransferBusy(false);
    }
  }

  const wallet = detail ?? wallets.find((entry) => entry.id === walletId) ?? null;

  return (
    <div className="page">
      <PageHeader
        title="Wallet"
        description={wallet ? shortAddress(wallet.address) : "Loading wallet"}
        actions={<Link to="/wallets" className="button button-secondary">All wallets</Link>}
      />
      {detailError && detail && <Alert kind="info">{detailError}</Alert>}
      {detailError && !detail && <ErrorBlock error={new Error(detailError)} retry={loadAll} />}
      {detailLoading && !detail && <Panel><Loading label="Loading wallet" /></Panel>}

      {wallet && (
        <div className="page-stack">
          <Panel index={1}>
            <div className="panel-top">
              <h2>Account</h2>
              <StatusBadge status={wallet.deployment_status ?? wallet.deploymentStatus ?? undefined} />
            </div>
            <dl className="kv-ledger">
              <div><dt>Wallet ID</dt><dd><code>{wallet.id}</code></dd></div>
              <div>
                <dt>Address</dt>
                <dd className="dd-actions"><code className="break-all">{wallet.address}</code> <CopyButton value={wallet.address} /></dd>
              </div>
              <div><dt>Owner</dt><dd><code className="break-all">{wallet.owner_address ?? wallet.ownerAddress ?? "—"}</code></dd></div>
              <div><dt>Chain ID</dt><dd className="num">{wallet.chain_id ?? wallet.chainId ?? "—"}</dd></div>
              <div><dt>Environment</dt><dd>{wallet.env ?? "—"}</dd></div>
              <div><dt>Deployment</dt><dd>{deploymentLabel(wallet.deployment_status ?? wallet.deploymentStatus).text}</dd></div>
              <div><dt>Deployment tx</dt><dd><code className="break-all">{wallet.deployment_tx_hash ?? "—"}</code></dd></div>
              <div>
                <dt>USDC balance</dt>
                <dd className="num">{wallet.balance ? `${formatAtomic(wallet.balance.atomic, wallet.balance.decimals)} ${wallet.balance.symbol}` : "—"}</dd>
              </div>
            </dl>
            {explorerAddressUrl(wallet.address) && (
              <a className="button button-secondary button-small" href={explorerAddressUrl(wallet.address)!} target="_blank" rel="noreferrer">
                View on BaseScan ↗
              </a>
            )}
          </Panel>

          <Panel index={2}>
            <div className="panel-top"><h2>Funding</h2></div>
            <p className="muted">
              Base Sepolia is testnet. Fund gas with ETH and operations with test USDC from public faucets (external services — availability is not guaranteed):
            </p>
            <ul className="faucet-list">
              {FAUCETS.map((faucet) => (
                <li key={faucet.url}><a href={faucet.url} target="_blank" rel="noreferrer" className="text-button">{faucet.name} ↗</a></li>
              ))}
            </ul>
          </Panel>

          <Panel index={3}>
            <div className="panel-top"><h2>Assigned agents</h2><Link to="/agents" className="text-button">Manage</Link></div>
            {agentsError && <Alert kind="info">{agentsError}</Alert>}
            {agents.length === 0 ? (
              <Empty title="No agents on this wallet" action={<Link to="/agents" className="button button-secondary">Add an agent</Link>}>
                Agents hold session keys scoped to this account&apos;s policy.
              </Empty>
            ) : (
              <ul className="simple-list">
                {agents.map((agent) => (
                  <li key={agent.id}>
                    <Link to={`/agents/${encodeURIComponent(agent.id)}`} className="row-link">
                      <strong>{agent.name}</strong>
                      <StatusBadge status={agent.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel index={4}>
            <div className="panel-top"><h2>Policy overview</h2><span className="muted small">Latest cached policy per session key</span></div>
            {agents.length === 0 && <p className="muted">No session keys — no policies to show.</p>}
            {agents.map((agent) => {
              const key = agent.session_key_address ?? agent.sessionKeyAddress ?? "";
              const policy = policies[agent.id];
              return (
                <div key={agent.id} className="policy-block">
                  <p><strong>{agent.name}</strong> <code className="muted">{truncateMiddle(key, 8, 6)}</code></p>
                  {policy === undefined ? <Loading label="Loading policy" /> : policy === null ? (
                    <p className="muted small">No policy cached for this key yet (HTTP 404 from the policy endpoint).</p>
                  ) : (
                    <details>
                      <summary>Policy v{String((policy as { version?: unknown }).version ?? "?")} · <code>{String((policy as { policyHash?: unknown }).policyHash ?? "").slice(0, 18)}…</code></summary>
                      <pre className="json-block">{JSON.stringify((policy as { policy?: unknown }).policy, null, 2)}</pre>
                    </details>
                  )}
                </div>
              );
            })}
            {policiesError && <Alert kind="info">{policiesError}</Alert>}
          </Panel>

          <Panel index={5}>
            <div className="panel-top"><h2>Prepare owner transfer</h2></div>
            <p className="muted">Prepares an unsigned USDC transfer call for owner signature. Nothing is submitted here.</p>
            {transferError && <Alert>{transferError}</Alert>}
            <form className="form-grid" onSubmit={prepareTransfer}>
              <label className="form-span-2">
                Recipient address
                <input value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder="0x…" pattern="^0x[0-9a-fA-F]{40}$" spellCheck={false} required />
              </label>
              <label>
                Amount (USDC)
                <input type="number" inputMode="decimal" min="0.000001" step="0.000001" value={amount} onChange={(event) => setAmount(event.target.value)} required />
              </label>
              <div className="form-actions">
                <button className="button button-primary" type="submit" disabled={transferBusy}>{transferBusy ? "Preparing…" : "Prepare transfer"}</button>
              </div>
            </form>
          </Panel>
        </div>
      )}

      <Modal open={transferOpen} onClose={() => setTransferOpen(false)} title="Prepared transfer call">
        <Alert kind="info">Owner must sign this in their wallet — AEGIS does not sign for you.</Alert>
        {transferResult !== null && <pre className="json-block">{JSON.stringify(transferResult, null, 2)}</pre>}
      </Modal>
    </div>
  );
}

export { FAUCETS };
