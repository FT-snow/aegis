import type { AegisEvent } from "../lib/types";
import { DecisionMark } from "./DecisionMark";

export interface LedgerTableProps {
  events: readonly AegisEvent[];
  caption?: string;
  className?: string;
  selectedEvent?: AegisEvent | null;
  onEventSelect?: (event: AegisEvent) => void;
}

function formatTimestamp(timestamp: string) {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleString();
}

export function LedgerTable({
  caption = "Event ledger",
  className = "",
  events,
  onEventSelect,
  selectedEvent,
}: LedgerTableProps) {
  const classes = ["ledger-table-wrap", className].filter(Boolean).join(" ");

  return (
    <div aria-label={caption} className={classes} role="region" tabIndex={0}>
      <table className="ledger-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Time</th>
            <th scope="col">Agent</th>
            <th scope="col">Action</th>
            <th scope="col">Target</th>
            <th scope="col">Amount</th>
            <th scope="col">Decision</th>
          </tr>
        </thead>
        <tbody>
          {events.length ? (
            events.map((event, index) => {
              const selected =
                selectedEvent === event ||
                (selectedEvent?.userOpHash === event.userOpHash &&
                  selectedEvent?.timestamp === event.timestamp);
              const rowClass = ["ledger-table-row", selected ? "ledger-table-row-selected" : ""]
                .filter(Boolean)
                .join(" ");

              return (
                <tr
                  aria-current={selected ? "true" : undefined}
                  className={rowClass}
                  key={
                    event.userOpHash ??
                    event.txHash ??
                    `${event.timestamp}-${event.agentId}-${index}`
                  }
                >
                  <td>
                    {onEventSelect ? (
                      <button
                        aria-label={`Open ${event.action} event from ${event.agentId}`}
                        className="ledger-table-event"
                        onClick={() => onEventSelect(event)}
                        type="button"
                      >
                        <time dateTime={event.timestamp}>{formatTimestamp(event.timestamp)}</time>
                      </button>
                    ) : (
                      <time dateTime={event.timestamp}>{formatTimestamp(event.timestamp)}</time>
                    )}
                  </td>
                  <td>{event.agentId}</td>
                  <td>{event.action}</td>
                  <td>{event.target}</td>
                  <td>{event.amount}</td>
                  <td>
                    <DecisionMark decision={event.decision} />
                  </td>
                </tr>
              );
            })
          ) : (
            <tr className="ledger-table-empty">
              <td colSpan={6}>No events to display.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
