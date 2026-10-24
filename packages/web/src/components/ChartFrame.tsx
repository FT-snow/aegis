import type { ReactNode } from "react";

export interface ChartFrameRow {
  label: ReactNode;
  value: ReactNode;
  detail?: ReactNode;
  key?: string;
}

export interface ChartFrameProps {
  children?: ReactNode;
  rows?: readonly ChartFrameRow[];
  title?: ReactNode;
  className?: string;
  tableLabel?: string;
}

export function ChartFrame({
  children,
  rows,
  title,
  className = "",
  tableLabel = "View as table",
}: ChartFrameProps) {
  const classes = ["chart-frame", className].filter(Boolean).join(" ");

  return (
    <section className={classes}>
      {title ? <h2 className="chart-frame-title">{title}</h2> : null}
      {children}
      {rows?.length ? (
        <details className="chart-frame-data">
          <summary>{tableLabel}</summary>
          <table>
            <thead>
              <tr>
                <th scope="col">Category</th>
                <th scope="col">Value</th>
                <th scope="col">Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.key ?? `${index}`}>
                  <th scope="row">{row.label}</th>
                  <td>{row.value}</td>
                  <td>{row.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ) : null}
    </section>
  );
}
