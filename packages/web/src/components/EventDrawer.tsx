import { useEffect, useId, useRef } from "react";
import type { AegisEvent } from "../lib/types";
import { Button } from "./Button";
import { DecisionMark } from "./DecisionMark";

export interface EventDrawerProps {
  event: AegisEvent | null;
  open?: boolean;
  onClose: () => void;
  className?: string;
}

export function EventDrawer({ event, open = true, onClose, className = "" }: EventDrawerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const classes = ["event-drawer", className].filter(Boolean).join(" ");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && event && !dialog.open) dialog.showModal();
    if ((!open || !event) && dialog.open) dialog.close();
  }, [event, open]);

  if (!event) return null;

  return (
    <dialog aria-labelledby={titleId} className={classes} onCancel={onClose} ref={dialogRef}>
      <header className="event-drawer-header">
        <div>
          <p className="event-drawer-kicker">Event detail</p>
          <h2 id={titleId}>{event.action}</h2>
        </div>
        <Button
          aria-label="Close event details"
          className="event-drawer-close"
          onClick={() => {
            dialogRef.current?.close();
            onClose();
          }}
          variant="quiet"
        >
          Close
        </Button>
      </header>
      <dl className="event-drawer-details">
        <div>
          <dt>Decision</dt>
          <dd>
            <DecisionMark decision={event.decision} />
          </dd>
        </div>
        <div>
          <dt>Time</dt>
          <dd>
            <time dateTime={event.timestamp}>{event.timestamp}</time>
          </dd>
        </div>
        <div>
          <dt>Environment</dt>
          <dd>{event.environment}</dd>
        </div>
        <div>
          <dt>Agent</dt>
          <dd>{event.agentId}</dd>
        </div>
        <div>
          <dt>Target</dt>
          <dd>{event.target}</dd>
        </div>
        <div>
          <dt>Amount</dt>
          <dd>{event.amount}</dd>
        </div>
        {event.rule ? (
          <div>
            <dt>Rule</dt>
            <dd>{event.rule.replace(/_/g, " ")}</dd>
          </div>
        ) : null}
        {event.reason ? (
          <div>
            <dt>Reason</dt>
            <dd>{event.reason}</dd>
          </div>
        ) : null}
        {event.userOpHash ? (
          <div>
            <dt>User operation</dt>
            <dd>{event.userOpHash}</dd>
          </div>
        ) : null}
        {event.txHash ? (
          <div>
            <dt>Transaction</dt>
            <dd>{event.txHash}</dd>
          </div>
        ) : null}
      </dl>
    </dialog>
  );
}
