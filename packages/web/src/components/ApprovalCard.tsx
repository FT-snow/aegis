import { useEffect, useState } from "react";
import type { ApprovalAction, PendingRequest } from "../lib/types";
import { Button } from "./Button";

export interface ApprovalCardProps {
  request: PendingRequest;
  onAction: (action: ApprovalAction, request: PendingRequest) => void;
  className?: string;
  disabled?: boolean;
}

function formatRemaining(milliseconds: number) {
  const totalSeconds = Math.ceil(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function ApprovalCard({
  request,
  onAction,
  className = "",
  disabled = false,
}: ApprovalCardProps) {
  const [now, setNow] = useState(() => Date.now());
  const expiresAt = Date.parse(request.expiresAt);
  const isValidExpiry = Number.isFinite(expiresAt);
  const remaining = isValidExpiry ? Math.max(0, expiresAt - now) : 0;
  const expired = remaining === 0;
  const classes = ["approval-card", className].filter(Boolean).join(" ");

  useEffect(() => {
    if (!isValidExpiry || expired) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [expired, isValidExpiry]);

  return (
    <article className={classes}>
      <header className="approval-card-header">
        <div>
          <p className="approval-card-kicker">Approval required</p>
          <h2>{request.action}</h2>
        </div>
        <p
          aria-label={
            expired ? "Approval request expired" : `Time remaining ${formatRemaining(remaining)}`
          }
          className="approval-card-countdown"
          role="timer"
        >
          {expired ? "Expired" : `Expires in ${formatRemaining(remaining)}`}
        </p>
      </header>
      <dl className="approval-card-details">
        <div>
          <dt>Agent</dt>
          <dd>{request.agentId}</dd>
        </div>
        <div>
          <dt>Amount</dt>
          <dd>{request.amount}</dd>
        </div>
        <div>
          <dt>Recipient</dt>
          <dd>{request.recipient}</dd>
        </div>
        <div>
          <dt>Rule</dt>
          <dd>{request.rule.replace(/_/g, " ")}</dd>
        </div>
        <div>
          <dt>Reason</dt>
          <dd>{request.reason}</dd>
        </div>
      </dl>
      <div className="approval-card-actions" aria-label="Approval actions">
        <Button disabled={expired || disabled} onClick={() => onAction("approve_once", request)}>
          Approve once
        </Button>
        <Button
          disabled={expired || disabled}
          onClick={() => onAction("approve_and_allow", request)}
          variant="secondary"
        >
          Approve and add to policy
        </Button>
        <Button disabled={disabled} onClick={() => onAction("deny", request)} variant="danger">
          Deny
        </Button>
      </div>
    </article>
  );
}
