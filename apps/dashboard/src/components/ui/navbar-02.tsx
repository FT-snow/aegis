import { useCallback, useEffect, useState } from "react";
import { Menu } from "lucide-react";
import { Link, useRouter } from "../../router";
import { useAppData } from "../../appdata";
import { Logo } from "./navbar-02-utils/logo";
import { NavigationSheet, type NavItem } from "./navbar-02-utils/navigation-sheet";

export const NAV_ITEMS: NavItem[] = [
  { name: "Overview", href: "/overview", icon: "overview" },
  { name: "Wallets", href: "/wallets", icon: "wallets" },
  { name: "Agents", href: "/agents", icon: "agents" },
  { name: "Tasks", href: "/tasks", icon: "tasks" },
  { name: "Transactions", href: "/transactions", icon: "transactions" },
  { name: "Approvals", href: "/approvals", icon: "approvals" },
  { name: "Security", href: "/security", icon: "security" },
  { name: "Arena", href: "/arena", icon: "arena" },
  { name: "Settings", href: "/settings", icon: "settings" },
];

function isCurrent(item: NavItem, path: string) {
  return path === item.href
    || ((item.href === "/wallets" || item.href === "/agents") && path.startsWith(`${item.href}/`));
}

export function NavMenu({ className = "" }: { className?: string }) {
  const { path } = useRouter();
  return (
    <nav className={`navbar-02-links ${className}`} aria-label="Main navigation">
      {NAV_ITEMS.map((item) => {
        const active = isCurrent(item, path);
        return (
          <Link
            key={item.href}
            to={item.href}
            className={`navbar-02-link${active ? " navbar-02-link-active" : ""}`}
            aria-current={active ? "page" : undefined}
          >
            {item.name}
          </Link>
        );
      })}
    </nav>
  );
}

export default function Navbar() {
  const { user, signOut } = useAppData();
  const { path } = useRouter();
  const [sheetOpen, setSheetOpen] = useState(false);
  const closeSheet = useCallback(() => setSheetOpen(false), []);

  useEffect(() => { closeSheet(); }, [path, closeSheet]);

  return (
    <header className="navbar-02">
      <div className="navbar-02-inner">
        <div className="navbar-02-brand-group">
          <Logo />
          {user?.email && <span className="navbar-02-account" title={user.email}>{user.email}</span>}
        </div>
        <NavMenu className="navbar-02-desktop-menu" />
        <div className="navbar-02-actions">
          <Link to="/tasks" className="button button-primary navbar-02-task">New task</Link>
          <button type="button" className="navbar-02-signout-inline" onClick={() => void signOut()}>Sign out</button>
          <button
            type="button"
            className="navbar-02-menu-trigger"
            aria-label={sheetOpen ? "Close navigation" : "Open navigation"}
            aria-controls="navbar-02-sheet"
            aria-expanded={sheetOpen}
            onClick={() => setSheetOpen((open) => !open)}
          >
            <Menu size={20} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>
      </div>
      <NavigationSheet isOpen={sheetOpen} navItems={NAV_ITEMS} onClose={closeSheet} />
    </header>
  );
}
