import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { NavLink } from "react-router-dom";
import "./navigation.css";

export interface DashboardNavItem {
  path: string;
  label: string;
}

interface DashboardNavProps {
  items: DashboardNavItem[];
  approvalCount: number;
}

type IconName = "overview" | "policy" | "approvals" | "activity" | "agents" | "arena" | "default";

function getIconName(item: DashboardNavItem): IconName {
  const key = `${item.path} ${item.label}`.toLowerCase();
  if (key.includes("overview") || key.includes("home")) return "overview";
  if (key.includes("policy")) return "policy";
  if (key.includes("approval")) return "approvals";
  if (key.includes("activity") || key.includes("event") || key.includes("audit")) return "activity";
  if (key.includes("agent")) return "agents";
  if (key.includes("arena")) return "arena";
  return "default";
}

function NavigationIcon({ name }: { name: IconName }) {
  const shared = {
    "aria-hidden": true as const,
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: "var(--focus-width)",
    viewBox: "0 0 24 24",
  };

  switch (name) {
    case "overview":
      return (
        <svg {...shared}>
          <rect x="3.5" y="3.5" width="7" height="7" rx="1" />
          <rect x="13.5" y="3.5" width="7" height="7" rx="1" />
          <rect x="3.5" y="13.5" width="7" height="7" rx="1" />
          <rect x="13.5" y="13.5" width="7" height="7" rx="1" />
        </svg>
      );
    case "policy":
      return (
        <svg {...shared}>
          <path d="M12 3.5 19 6v5.4c0 4.4-2.8 7.5-7 9.1-4.2-1.6-7-4.7-7-9.1V6l7-2.5Z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      );
    case "approvals":
      return (
        <svg {...shared}>
          <path d="M6 4.5h12v16H6z" />
          <path d="M9 4.5V3h6v1.5M9 10h6M9 14h2m2-.5 1.5 1.5 2.5-3" />
        </svg>
      );
    case "activity":
      return (
        <svg {...shared}>
          <path d="M3 12h4l2.2-6 4.1 12 2.2-6H21" />
        </svg>
      );
    case "agents":
      return (
        <svg {...shared}>
          <circle cx="9" cy="8" r="3" />
          <path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 5.5a3 3 0 0 1 0 5.8m1 3a5 5 0 0 1 3.5 4.7" />
        </svg>
      );
    case "arena":
      return (
        <svg {...shared}>
          <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" />
          <path d="m4.5 7.8 7.5 4.4 7.5-4.4M12 12.2V21M8 5.2l8 4.6" />
        </svg>
      );
    default:
      return (
        <svg {...shared}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7.5v9m-4.5-4.5h9" />
        </svg>
      );
  }
}

export function DashboardNav({ items, approvalCount }: DashboardNavProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (mobileOpen) closeButtonRef.current?.focus();
  }, [mobileOpen]);

  function closeMobileNav(restoreFocus = false) {
    setMobileOpen(false);
    if (restoreFocus) menuButtonRef.current?.focus();
  }

  function handleDrawerKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeMobileNav(true);
      return;
    }

    if (event.key !== "Tab") return;
    const focusable = event.currentTarget.querySelectorAll<HTMLElement>(
      "a[href], button:not([disabled])",
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const renderLinks = (onNavigate?: () => void) => (
    <>
      <div className="dashboard-nav__links">
        {items.map((item) => {
          const isApprovalItem = item.path.toLowerCase().includes("approval");
          const count = isApprovalItem ? Math.max(0, approvalCount) : 0;
          const accessibleLabel = count > 0 ? `${item.label}, ${count} pending` : item.label;

          return (
            <NavLink
              aria-label={accessibleLabel}
              className={({ isActive }) => `dashboard-nav__link${isActive ? " is-active" : ""}`}
              key={item.path}
              onClick={onNavigate}
              title={item.label}
              to={item.path}
            >
              <NavigationIcon name={getIconName(item)} />
              <span className="dashboard-nav__label">{item.label}</span>
              {count > 0 ? (
                <span className="dashboard-nav__count" aria-hidden="true">
                  <span className="dashboard-nav__count-number">{count}</span>
                  <span className="dashboard-nav__count-dot" />
                </span>
              ) : null}
            </NavLink>
          );
        })}
      </div>
      <div className="dashboard-nav__arena">
        <NavLink
          aria-label="Survival Arena"
          className={({ isActive }) => `dashboard-nav__link${isActive ? " is-active" : ""}`}
          onClick={onNavigate}
          title="Survival Arena"
          to="/arena"
        >
          <NavigationIcon name="arena" />
          <span className="dashboard-nav__label">Survival Arena</span>
          <span className="dashboard-nav__sim">Sim</span>
        </NavLink>
      </div>
    </>
  );

  return (
    <div className="dashboard-nav-shell">
      <button
        aria-controls="dashboard-navigation"
        aria-expanded={mobileOpen}
        aria-label={mobileOpen ? "Close dashboard menu" : "Open dashboard menu"}
        className="dashboard-nav__menu-button"
        onClick={() => setMobileOpen((open) => !open)}
        ref={menuButtonRef}
        type="button"
      >
        {mobileOpen ? (
          <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        ) : (
          <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
            <path d="M4 6.5h16M4 12h16M4 17.5h16" />
          </svg>
        )}
      </button>

      <div
        aria-label={mobileOpen ? "Dashboard menu" : undefined}
        aria-modal={mobileOpen || undefined}
        className={`dashboard-nav__drawer${mobileOpen ? " is-open" : ""}`}
        onKeyDown={handleDrawerKeyDown}
        role={mobileOpen ? "dialog" : undefined}
      >
        <button
          aria-label="Close dashboard menu"
          className="dashboard-nav__drawer-close"
          onClick={() => closeMobileNav(true)}
          ref={closeButtonRef}
          type="button"
        >
          <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </button>
        <nav
          aria-label="Dashboard navigation"
          className="dashboard-nav__surface"
          id="dashboard-navigation"
        >
          {renderLinks(() => closeMobileNav())}
        </nav>
      </div>
      {mobileOpen ? (
        <button
          aria-label="Close dashboard menu"
          className="dashboard-nav__scrim"
          onClick={() => closeMobileNav(true)}
          tabIndex={-1}
          type="button"
        />
      ) : null}
    </div>
  );
}

export default DashboardNav;
