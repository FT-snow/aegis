import type { ConnectionState } from "../lib/types";

export interface ConnectionIndicatorProps {
  state: ConnectionState;
  className?: string;
  label?: string;
}

const connectionLabels: Record<ConnectionState, string> = {
  live: "Live",
  reconnecting: "Reconnecting",
  offline: "Offline",
};

export function ConnectionIndicator({ state, className = "", label }: ConnectionIndicatorProps) {
  const classes = ["connection-indicator", `connection-indicator-${state}`, className]
    .filter(Boolean)
    .join(" ");

  return (
    <span aria-live="polite" className={classes} role="status">
      <span aria-hidden="true" className="connection-indicator-dot" />
      {label ?? connectionLabels[state]}
    </span>
  );
}
