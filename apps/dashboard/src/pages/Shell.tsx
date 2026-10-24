import { useEffect, useState, type ReactNode } from "react";
import { Link, useRouter } from "../router";
import { useAppData } from "../appdata";
import { shortAddress } from "../api";

const NAV = [
  { to: "/overview", label: "Overview" },
  { to: "/wallets", label: "Wallets" },
  { to: "/agents", label: "AI Agents" },
  { to: "/tasks", label: "Tasks" },
  { to: "/transactions", label: "Transactions" },
  { to: "/approvals", label: "Approvals" },
  { to: "/security", label: "Security Center" },
  { to: "/arena", label: "Survival Arena" },
  { to: "/settings", label: "Settings" },
];

export function Shell({ children }: { children: ReactNode }) {
  const { user, wallets, signOut } = useAppData();
  const { path, navigate } = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  // Close the mobile menu whenever the route changes.
  useEffect(() => { setMenuOpen(false); }, [path]);

  const ownerAddress = wallets.find((wallet) => typeof wallet.owner_address === "string" && wallet.owner_address)?.owner_address
    ?? wallets.find((wallet) => typeof wallet.ownerAddress === "string" && wallet.ownerAddress)?.ownerAddress
    ?? null;

  function isActive(item: { to: string }) {
    if (item.to === "/wallets" || item.to === "/agents") return path === item.to || path.startsWith(`${item.to}/`);
    return path === item.to;
  }

  function go(item: { to: string }) {
    setMenuOpen(false);
    navigate(item.to);
  }

  const navList = (
    <nav className="side-nav" aria-label="Main navigation">
      {NAV.map((item) => (
        <button
          key={item.to}
          type="button"
          className={`nav-item${isActive(item) ? " nav-item-active" : ""}`}
          aria-current={isActive(item) ? "page" : undefined}
          onClick={() => go(item)}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <aside className="sidebar">
        <div className="sidebar-heading">
          <Link to="/" className="wordmark-link"><strong>AEGIS</strong></Link>
          <span className="muted small">Agent treasury control</span>
        </div>
        {navList}
        <div className="sidebar-footer">
          <span className="muted small">Signed in as</span>
          <strong className="user-email" title={user?.email}>{user?.email}</strong>
          <button className="button button-secondary button-full" type="button" onClick={() => void signOut()}>Sign out</button>
        </div>
      </aside>

      <div className="main-area">
        <header className="topbar">
          <button
            type="button"
            className="nav-toggle"
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span className="hamburger" aria-hidden="true" />
            <span className="sr-only">Menu</span>
          </button>
          <Link to="/overview" className="mobile-wordmark">AEGIS<span>.</span></Link>
          <div id="mobile-nav" className={`mobile-nav${menuOpen ? " open" : ""}`}>
            {navList}
          </div>
          <div className="topbar-right">
            <div className="topbar-actions">
              <Link to="/wallets" className="button button-tertiary topbar-action">Create wallet</Link>
              <Link to="/agents" className="button button-tertiary topbar-action">Create agent</Link>
              <Link to="/tasks" className="button button-primary topbar-action">Assign task <span aria-hidden="true">↗</span></Link>
            </div>
            {ownerAddress ? (
              <span className="owner-chip" title="Connected owner address">
                <span className="muted small">Owner</span>
                <code>{shortAddress(ownerAddress)}</code>
              </span>
            ) : (
              <span className="owner-chip"><span className="muted small">Owner</span><code>—</code></span>
            )}
            <span className="chain-badge">Base Sepolia · 84532 · TESTNET</span>
          </div>
        </header>
        <main id="main-content" className="content-area">
          {children}
        </main>
      </div>
    </div>
  );
}
