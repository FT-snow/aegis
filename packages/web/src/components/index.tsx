import type { HTMLAttributes, ReactNode } from "react";

export { ApprovalCard } from "./ApprovalCard";
export { Button } from "./Button";
export { ChartFrame } from "./ChartFrame";
export { ConnectionIndicator } from "./ConnectionIndicator";
export { Dialog } from "./Dialog";
export { DecisionMark } from "./DecisionMark";
export { EventDrawer } from "./EventDrawer";
export { Field } from "./Field";
export { LedgerTable } from "./LedgerTable";
export { PolicyPanel } from "./PolicyPanel";
export { StatusMark } from "./StatusMark";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode;
}

export function Card({ children, className = "", ...props }: CardProps) {
  return (
    <div className={className} {...props}>
      {children}
    </div>
  );
}

export function Badge({ children, className = "", ...props }: BadgeProps) {
  return (
    <span className={className} {...props}>
      {children}
    </span>
  );
}
