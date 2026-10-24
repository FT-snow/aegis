import type {
  AegisEvent,
  AgentSummary,
  ApprovalAction,
  AuditDecision,
  ConnectionState,
  PendingRequest,
  Policy,
  WalletSummary,
} from "./types";

const useMock = import.meta.env.VITE_USE_MOCK !== "false";
const endpoint = (path: string) => `/api${path}`;

const now = Date.now();
const makeEvent = (
  offsetMinutes: number,
  action: string,
  amount: string,
  decision: AegisEvent["decision"],
  rule?: AegisEvent["rule"],
  reason?: string,
): AegisEvent => ({
  schemaVersion: 1,
  timestamp: new Date(Date.now() - offsetMinutes * 60_000).toISOString(),
  environment: "local",
  agentId: "shopping-agent",
  action,
  target: "0x71C7656EC7ab88b098defB751B7401B5f6d8976F",
  amount,
  decision,
  rule,
  reason: reason ?? "Sample data only; no blockchain transaction was sent.",
});

const mockWallet: WalletSummary = {
  id: "wallet-demo",
  name: "Demo policy wallet",
  address: "0x71C7656EC7ab88b098defB751B7401B5f6d8976F",
  usdcBalance: "148.27",
  ethBalance: "0.0142",
  deployed: false,
  agentCount: 2,
  keyStatus: "active",
};

const mockPolicy: Policy = {
  perTransactionLimit: "25.00",
  dailyLimit: "100.00",
  usedToday: "32.50",
  recipients: ["0x71C7656EC7ab88b098defB751B7401B5f6d8976F"],
  contracts: ["0x036CbD53842c5426634e7929541eC2318f3dCF7e"],
  functions: ["transfer(address,uint256)", "approve(address,uint256)"],
  expiresAt: new Date(now + 1000 * 60 * 60 * 24 * 11).toISOString(),
};

const mockEvents: AegisEvent[] = [
  makeEvent(
    3,
    "Attempted unlisted contract",
    "8.00",
    "blocked",
    "contract",
    "Sample policy check only; no transaction was sent.",
  ),
  makeEvent(
    17,
    "Attempted large purchase",
    "42.00",
    "blocked",
    "per_tx_limit",
    "Amount exceeds the 25.00 USDC per-transaction limit.",
  ),
  makeEvent(
    31,
    "Attempted unlisted recipient",
    "6.25",
    "blocked",
    "recipient",
    "Recipient is not on the wallet allowlist.",
  ),
  makeEvent(
    58,
    "Purchase API credits",
    "18.00",
    "pending",
    "contract",
    "Merchant contract requires owner review.",
  ),
  makeEvent(
    83,
    "Daily budget check",
    "74.00",
    "blocked",
    "daily_limit",
    "Request would exceed the remaining daily budget.",
  ),
  makeEvent(
    119,
    "Expired permission check",
    "2.00",
    "blocked",
    "expiry",
    "Session permission is no longer valid.",
  ),
  makeEvent(
    152,
    "Revoked key attempt",
    "1.00",
    "blocked",
    "revoked",
    "Session key was revoked before execution.",
  ),
];

let mockPending: PendingRequest[] = [
  {
    id: "approval-01",
    agentId: "shopping-agent",
    action: "Purchase API credits",
    amount: "18.00",
    recipient: "0xA12f409E91d332Ba84612A27776a9f09a51c0a21",
    reason: "The agent needs additional inference credits to finish the order.",
    rule: "recipient",
    expiresAt: new Date(now + 1000 * 60 * 14).toISOString(),
  },
  {
    id: "approval-02",
    agentId: "research-agent",
    action: "Reserve event ticket",
    amount: "31.50",
    recipient: "0xB864A3b09C8D2378e3F3e6d64894688E71eBd2a0",
    reason: "The listed ticket provider returned a price above the agent limit.",
    rule: "per_tx_limit",
    expiresAt: new Date(now + 1000 * 60 * 29).toISOString(),
  },
];

let mockEventsState = [...mockEvents];
let mockKeyStatus: WalletSummary["keyStatus"] = "active";
let mockPaused = false;
let mockAuthenticated = false;
let mockConnection: ConnectionState = "live";
const mockListeners = new Set<(event: AegisEvent) => void>();
const mockConnectionListeners = new Set<(state: ConnectionState) => void>();
let tick = 0;

const mockAgents: AgentSummary[] = [
  {
    id: "shopping-agent",
    name: "Shopping agent",
    purpose: "Purchases approved supplies and service credits.",
    model: "openai/gpt-oss-20b",
    walletId: mockWallet.id,
    status: "active",
    perTransactionLimit: "25.00",
    dailyLimit: "100.00",
  },
  {
    id: "research-agent",
    name: "Research agent",
    purpose: "Finds and reserves event tickets.",
    model: "Scripted demo agent",
    walletId: mockWallet.id,
    status: "active",
    perTransactionLimit: "20.00",
    dailyLimit: "60.00",
  },
];

export const isMockMode = useMock;

export async function getSession(): Promise<boolean> {
  if (useMock) return mockAuthenticated;
  const session = await request<{ authenticated: boolean }>("/auth/session");
  return session.authenticated;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(endpoint(path), {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(detail?.message ?? `Request failed (${response.status}). Try again.`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function login(
  email: string,
  password: string,
  mode: "login" | "signup",
): Promise<void> {
  if (useMock) {
    await new Promise((resolve) => window.setTimeout(resolve, 180));
    mockAuthenticated = true;
    return;
  }
  await request(mode === "signup" ? "/auth/signup" : "/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function getWallet(): Promise<WalletSummary> {
  if (useMock)
    return {
      ...mockWallet,
      keyStatus: mockKeyStatus === "revoked" ? "revoked" : mockPaused ? "paused" : "active",
    };
  const wallet = await request<WalletSummary>("/wallet");
  if (wallet.chainId !== undefined && wallet.chainId !== 84532) {
    throw new Error(
      `Unsupported chain ID ${wallet.chainId}. Switch the connected wallet to Base Sepolia (84532).`,
    );
  }
  return wallet;
}

export async function getPolicy(): Promise<Policy> {
  return useMock ? mockPolicy : request<Policy>("/wallet/policy");
}

export async function getPending(): Promise<PendingRequest[]> {
  if (!useMock) return request<PendingRequest[]>("/approvals");
  const timestamp = Date.now();
  const expired = mockPending.filter((pending) => Date.parse(pending.expiresAt) <= timestamp);
  mockPending = mockPending.filter((pending) => Date.parse(pending.expiresAt) > timestamp);
  for (const pending of expired) {
    mockEventsState = [
      {
        ...makeEvent(
          0,
          pending.action,
          pending.amount,
          "denied",
          "expiry",
          "Automatically denied after the approval request expired.",
        ),
        agentId: pending.agentId,
      },
      ...mockEventsState,
    ];
  }
  return [...mockPending];
}

export async function decide(
  id: string,
  action: ApprovalAction,
  ownerSignature?: string,
): Promise<void> {
  if (useMock) {
    const selected = mockPending.find((request) => request.id === id);
    mockPending = mockPending.filter((request) => request.id !== id);
    if (!selected)
      throw new Error("This request is no longer pending. Refresh the approvals list.");
    if (Date.parse(selected.expiresAt) <= Date.now()) {
      mockEventsState = [
        {
          ...makeEvent(
            0,
            selected.action,
            selected.amount,
            "denied",
            "expiry",
            "Automatically denied after the approval request expired.",
          ),
          agentId: selected.agentId,
        },
        ...mockEventsState,
      ];
      throw new Error(
        "This request expired and was automatically denied. Refresh the approvals list.",
      );
    }
    const decision = action === "deny" ? "denied" : "approved";
    if (
      action === "approve_and_allow" &&
      !mockPolicy.recipients.some(
        (recipient) => recipient.toLowerCase() === selected.recipient.toLowerCase(),
      )
    ) {
      mockPolicy.recipients.push(selected.recipient);
    }
    mockEventsState = [
      {
        ...makeEvent(
          0,
          selected.action,
          selected.amount,
          decision,
          selected.rule,
          `Demo-only owner action: ${action.replaceAll("_", " ")}. No chain transaction was sent.`,
        ),
        agentId: selected.agentId,
      },
      ...mockEventsState,
    ];
    return;
  }
  if (!ownerSignature)
    throw new Error(
      `Owner wallet signature is required before ${action.replaceAll("_", " ")}. No request was sent.`,
    );
  const activeRequests = await getPending();
  const selected = activeRequests.find((request) => request.id === id);
  if (!selected || Date.parse(selected.expiresAt) <= Date.now()) {
    throw new Error("This approval request expired or is no longer pending. Refresh the queue.");
  }
  await request(`/approvals/${encodeURIComponent(id)}/decision`, {
    method: "POST",
    body: JSON.stringify({ action, ownerSignature }),
  });
}

export async function revokeKey(ownerSignature?: string): Promise<void> {
  if (useMock) {
    mockKeyStatus = "revoked";
    mockPaused = true;
    return;
  }
  if (!ownerSignature)
    throw new Error(
      "Owner wallet signature is required to revoke a session key. No request was sent.",
    );
  await request("/wallet/session-key/revoke", {
    method: "POST",
    body: JSON.stringify({ ownerSignature }),
  });
}

export async function setAgentPaused(paused: boolean, ownerSignature?: string): Promise<void> {
  if (useMock) {
    mockPaused = paused;
    return;
  }
  if (!ownerSignature)
    throw new Error(
      `Owner wallet signature is required to ${paused ? "pause" : "resume"} agent access. No request was sent.`,
    );
  await request("/wallet/agent/pause", {
    method: "POST",
    body: JSON.stringify({ paused, ownerSignature }),
  });
}

export function isAgentPaused(): boolean {
  return mockPaused;
}

export async function getEvents(): Promise<AegisEvent[]> {
  return useMock ? [...mockEventsState] : request<AegisEvent[]>("/events");
}

export async function getAuditTrail(): Promise<AuditDecision[]> {
  if (!useMock) return request<AuditDecision[]>("/audit");
  return mockEventsState
    .filter((event) => event.decision === "approved" || event.decision === "denied")
    .map((event, index) => ({
      id: `${event.timestamp}-${index}`,
      timestamp: event.timestamp,
      actor: "Owner (demo)",
      action: event.action,
      outcome: event.decision,
      detail: event.reason ?? "Decision recorded in mock mode.",
    }));
}

export async function getAgents(): Promise<AgentSummary[]> {
  return useMock ? [...mockAgents] : request<AgentSummary[]>("/agents");
}

export function subscribe(
  onEvent: (event: AegisEvent) => void,
  onConnection?: (state: ConnectionState) => void,
): () => void {
  if (useMock) {
    mockListeners.add(onEvent);
    if (onConnection) {
      mockConnectionListeners.add(onConnection);
      onConnection(mockConnection);
    }
    return () => {
      mockListeners.delete(onEvent);
      if (onConnection) mockConnectionListeners.delete(onConnection);
    };
  }

  let active = true;
  let socket: WebSocket | undefined;
  let retryTimer = 0;
  let attempts = 0;
  const setConnection = (state: ConnectionState) => onConnection?.(state);
  const connect = () => {
    if (!active) return;
    setConnection("reconnecting");
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(`${protocol}//${window.location.host}/api/live`);
    socket.onopen = () => {
      attempts = 0;
      setConnection("live");
      void getEvents()
        .then((events) => events.forEach(onEvent))
        .catch(() => setConnection("reconnecting"));
    };
    socket.onmessage = (message) => {
      try {
        onEvent(JSON.parse(String(message.data)) as AegisEvent);
      } catch {
        setConnection("reconnecting");
      }
    };
    socket.onerror = () => setConnection("reconnecting");
    socket.onclose = () => {
      if (!active) return;
      attempts += 1;
      setConnection(attempts > 6 ? "offline" : "reconnecting");
      retryTimer = window.setTimeout(connect, Math.min(30_000, 500 * 2 ** Math.min(attempts, 6)));
    };
  };
  connect();
  return () => {
    active = false;
    window.clearTimeout(retryTimer);
    socket?.close();
    setConnection("offline");
  };
}

if (useMock) {
  window.setInterval(() => {
    tick += 1;
    const expired = mockPending.filter((pending) => Date.parse(pending.expiresAt) <= Date.now());
    if (expired.length) {
      mockPending = mockPending.filter((pending) => Date.parse(pending.expiresAt) > Date.now());
      for (const pending of expired) {
        const event: AegisEvent = {
          ...makeEvent(
            0,
            pending.action,
            pending.amount,
            "denied",
            "expiry",
            "Automatically denied after the approval request expired.",
          ),
          agentId: pending.agentId,
        };
        mockEventsState = [event, ...mockEventsState];
        mockListeners.forEach((listener) => listener(event));
      }
    }
    if (tick % 17 === 0) {
      mockConnection = mockConnection === "live" ? "reconnecting" : "live";
      mockConnectionListeners.forEach((listener) => listener(mockConnection));
      return;
    }
    const samples: AegisEvent[] = [
      makeEvent(
        0,
        "Checked merchant request",
        "4.50",
        "pending",
        "contract",
        "Sample policy check; awaiting review and no transaction was sent.",
      ),
      makeEvent(
        0,
        "Checked new recipient",
        "12.00",
        "blocked",
        "recipient",
        "Sample stream event. No transaction was sent.",
      ),
      makeEvent(
        0,
        "Awaiting owner review",
        "16.00",
        "pending",
        "contract",
        "Sample stream event. No transaction was sent.",
      ),
    ];
    const event = { ...samples[tick % samples.length], timestamp: new Date().toISOString() };
    if (event.decision === "pending") {
      mockPending = [
        {
          id: `live-approval-${tick}`,
          agentId: event.agentId,
          action: event.action,
          amount: event.amount,
          recipient: event.target,
          reason: "A sample live-stream request is waiting for owner review.",
          rule: event.rule ?? "recipient",
          expiresAt: new Date(Date.now() + 1000 * 60 * 10).toISOString(),
        },
        ...mockPending,
      ];
    }
    mockEventsState = [event, ...mockEventsState].slice(0, 80);
    mockListeners.forEach((listener) => listener(event));
  }, 12_000);
}
