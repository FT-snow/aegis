import type { Decision } from "../lib/types";

export interface DecisionMarkProps {
  decision: Decision;
  className?: string;
  label?: string;
}

const decisionLabels: Record<Decision, string> = {
  executed: "Executed",
  blocked: "Blocked",
  pending: "Pending",
  approved: "Approved",
  denied: "Denied",
};

export function DecisionMark({ decision, className = "", label }: DecisionMarkProps) {
  const classes = ["decision-mark", `decision-mark-${decision}`, className]
    .filter(Boolean)
    .join(" ");

  return <span className={classes}>{label ?? decisionLabels[decision]}</span>;
}
