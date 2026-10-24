import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { ApiError, apiRequest, errorMessage, prettyJson } from "./api";
import { useRouter } from "./router";
import { Link } from "./router";

export function Alert({ children, kind = "error" }: { children: ReactNode; kind?: "error" | "info" | "success" }) {
  return <div className={`alert alert-${kind}`} role={kind === "error" ? "alert" : "status"}>{children}</div>;
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="skeleton-stack" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="skeleton" style={{ ["--w" as string]: `${[92, 74, 84, 58][index % 4]}%` }} />
      ))}
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <span className="empty-mark" aria-hidden="true" />
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

const STATUS_GROUPS: Record<string, "good" | "warn" | "bad" | "neutral"> = {
  active: "good",
  deployed: "good",
  allow: "good",
  confirmed: "good",
  ok: "good",
  approved: "good",
  success: "good",
  succeeded: "good",
  completed: "good",
  survived: "good",
  configured: "good",
  running: "good",
  "scripted-safe": "good",
  pending: "warn",
  queued: "warn",
  planning: "warn",
  waiting_for_payment: "warn",
  waiting_for_approval: "warn",
  resuming: "warn",
  needs_approval: "warn",
  approval_required: "warn",
  "counterfactual-undeployed": "warn",
  undeployed: "warn",
  submitted: "warn",
  degraded: "warn",
  proposal_only: "warn",
  denied: "bad",
  deny: "bad",
  blocked: "bad",
  revoked: "bad",
  frozen: "bad",
  failed: "bad",
  dead: "bad",
  died: "bad",
};

export function StatusBadge({ status, prefix }: { status: string | null | undefined; prefix?: string }) {
  const value = typeof status === "string" && status.length > 0 ? status : "unknown";
  const group = STATUS_GROUPS[value] ?? "neutral";
  return (
    <span className={`badge badge-${group}`}>
      {prefix ? `${prefix} ` : ""}
      {value.replace(/_/g, " ")}
    </span>
  );
}

export function CopyButton({ value, label = "Copy", className = "" }: { value: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const area = document.createElement("textarea");
      area.value = value;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.append(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setCopied(true);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1800);
  }
  return (
    <button type="button" className={`text-button copy-button ${className}`} onClick={() => void copy()}>
      <span aria-live="polite">{copied ? "Copied" : label}</span>
    </button>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const onCancel = (event: Event) => { event.preventDefault(); onClose(); };
    const onBackdrop = (event: ReactMouseEvent<HTMLDialogElement>) => {
      if (event.target === dialog) onClose();
    };
    dialog.addEventListener("cancel", onCancel);
    dialog.addEventListener("click", onBackdrop as never);
    return () => {
      dialog.removeEventListener("cancel", onCancel);
      dialog.removeEventListener("click", onBackdrop as never);
    };
  }, [onClose]);
  return (
    <dialog ref={ref} className="modal" aria-labelledby={headingId}>
      <div className="modal-body">
        <h2 id={headingId} className="modal-title">{title}</h2>
        {children}
        <div className="modal-actions">
          <button type="button" className="button button-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </dialog>
  );
}

export function JsonBlock({ value, compact = false }: { value: unknown; compact?: boolean }) {
  return <pre className="json-block" tabIndex={0}>{compact ? JSON.stringify(value) : prettyJson(value)}</pre>;
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <header className="page-header reveal" style={{ ["--index" as string]: 0 }}>
      <div>
        <h1>{title}</h1>
        {description && <p className="muted page-desc">{description}</p>}
      </div>
      {actions && <div className="page-header-actions">{actions}</div>}
    </header>
  );
}

export function Panel({ children, className = "", index = 0 }: { children: ReactNode; className?: string; index?: number }) {
  return (
    <section className={`panel reveal ${className}`} style={{ ["--index" as string]: index }}>
      {children}
    </section>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="loading-block" role="status">
      <span className="loading-spinner" aria-hidden="true" />
      <span>{label}…</span>
    </div>
  );
}

export function ErrorBlock({ error, retry }: { error: unknown; retry?: () => void }) {
  const status = error instanceof ApiError ? error.status : null;
  return (
    <Alert>
      <span>{errorMessage(error)}</span>
      {status !== null && <span className="muted"> (HTTP {status})</span>}
      {retry && (
        <>
          {" "}
          <button type="button" className="text-button" onClick={retry}>Retry</button>
        </>
      )}
    </Alert>
  );
}

export interface PreparedCall {
  to: string;
  value: string;
  data: string;
}

export function OwnerSignDialog({
  open,
  onClose,
  call,
  contextNote,
  title = "Owner signature required",
}: {
  open: boolean;
  onClose: () => void;
  call: PreparedCall | null;
  contextNote?: string;
  title?: string;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      {call && (
        <div className="sign-call">
          <Alert kind="info">Owner must sign this in their wallet — AEGIS does not sign for you.</Alert>
          {contextNote && <p className="muted">{contextNote}</p>}
          <dl className="kv-ledger">
            <div><dt>Send to</dt><dd><code className="break-all">{call.to}</code> <CopyButton value={call.to} /></dd></div>
            <div><dt>Value (wei)</dt><dd className="num">{call.value}</dd></div>
            <div>
              <dt>Calldata</dt>
              <dd><code className="break-all calldata">{call.data}</code></dd>
            </div>
          </dl>
          <div className="modal-actions-inline">
            <CopyButton value={call.data} label="Copy calldata" />
            <CopyButton value={JSON.stringify(call)} label="Copy call JSON" />
          </div>
          <p className="muted small">Status stays pending until the signed transaction is confirmed and receipt sync reports it. Nothing is submitted by this dashboard.</p>
        </div>
      )}
    </Modal>
  );
}

export function useSessionGuard(onExpired: (message: string) => void) {
  const { navigate } = useRouter();
  return (error: unknown): boolean => {
    if (error instanceof ApiError && error.status === 401) {
      onExpired("Your session expired. Sign in again to continue.");
      navigate("/login", { replace: true });
      return true;
    }
    return false;
  };
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;

export function RefLink({ to, children }: { to: string; children: ReactNode }) {
  return <Link to={to} className="button button-primary">{children}</Link>;
}

export async function logout(): Promise<void> {
  await apiRequest<{ ok: boolean }>("/auth/logout", { method: "POST", body: "{}" });
}
