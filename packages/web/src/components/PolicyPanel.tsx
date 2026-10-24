import type { Policy } from "../lib/types";

export interface PolicyPanelProps {
  policy: Policy;
  title?: string;
  className?: string;
}

export function PolicyPanel({
  policy,
  title = "Spending policy",
  className = "",
}: PolicyPanelProps) {
  const classes = ["policy-panel", className].filter(Boolean).join(" ");

  return (
    <section aria-label={title} className={classes}>
      <h2 className="policy-panel-title">{title}</h2>
      <dl className="policy-panel-details">
        <div>
          <dt>Per transaction limit</dt>
          <dd>{policy.perTransactionLimit}</dd>
        </div>
        <div>
          <dt>Daily limit</dt>
          <dd>{policy.dailyLimit}</dd>
        </div>
        <div>
          <dt>Used today</dt>
          <dd>{policy.usedToday}</dd>
        </div>
        <div>
          <dt>Expires</dt>
          <dd>
            <time dateTime={policy.expiresAt}>{policy.expiresAt}</time>
          </dd>
        </div>
        <div>
          <dt>Allowed recipients</dt>
          <dd>{policy.recipients.length ? policy.recipients.join(", ") : "None"}</dd>
        </div>
        <div>
          <dt>Allowed contracts</dt>
          <dd>{policy.contracts.length ? policy.contracts.join(", ") : "None"}</dd>
        </div>
        <div>
          <dt>Allowed functions</dt>
          <dd>{policy.functions.length ? policy.functions.join(", ") : "None"}</dd>
        </div>
      </dl>
    </section>
  );
}
