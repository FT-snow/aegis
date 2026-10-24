import type { AgentSummary, ArenaAgent, ConnectionState, KeyStatus } from "../lib/types";

export type StatusValue =
  | KeyStatus
  | ConnectionState
  | AgentSummary["status"]
  | ArenaAgent["status"];

export interface StatusMarkProps {
  status: StatusValue;
  className?: string;
  label?: string;
}

export function StatusMark({ status, className = "", label }: StatusMarkProps) {
  const statusClass = status.replace(/[^a-z0-9-]/gi, "-");
  const classes = ["status-mark", `status-mark-${statusClass}`, className]
    .filter(Boolean)
    .join(" ");
  const text =
    label ?? status.replace(/[-_]/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());

  return <span className={classes}>{text}</span>;
}
