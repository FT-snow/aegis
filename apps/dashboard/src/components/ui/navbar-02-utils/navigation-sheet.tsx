import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowLeftRight,
  Bot,
  CircleCheck,
  LayoutDashboard,
  ListTodo,
  Settings,
  ShieldCheck,
  Swords,
  WalletCards,
  X,
} from "lucide-react";
import { Link, useRouter } from "../../../router";
import { useAppData } from "../../../appdata";

const ICONS = {
  overview: LayoutDashboard,
  wallets: WalletCards,
  agents: Bot,
  tasks: ListTodo,
  transactions: ArrowLeftRight,
  approvals: CircleCheck,
  security: ShieldCheck,
  arena: Swords,
  settings: Settings,
} as const;

export type NavItem = {
  name: string;
  href: string;
  icon: keyof typeof ICONS;
};

export function NavigationSheet({
  isOpen,
  navItems,
  onClose,
}: {
  isOpen: boolean;
  navItems: NavItem[];
  onClose: () => void;
}) {
  const { path } = useRouter();
  const { signOut } = useAppData();
  const panel = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (!isOpen) return;
    const priorOverflow = document.body.style.overflow;
    const priorFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = panel.current?.querySelectorAll<HTMLElement>("button:not([disabled]), a[href]");
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = priorOverflow;
      document.removeEventListener("keydown", onKeyDown);
      priorFocus?.focus();
    };
  }, [isOpen, onClose]);

  function onPanelKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") onClose();
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="navbar-02-sheet-layer"
          initial="closed"
          animate="open"
          exit="closed"
          variants={{ closed: {}, open: {} }}
        >
          <motion.button
            type="button"
            className="navbar-02-sheet-backdrop"
            aria-label="Close navigation"
            onClick={onClose}
            variants={{ closed: { opacity: 0 }, open: { opacity: 1 } }}
            transition={{ duration: reduceMotion ? 0.01 : 0.18 }}
          />
          <motion.aside
            ref={panel}
            id="navbar-02-sheet"
            className="navbar-02-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Main navigation"
            variants={{
              closed: { x: reduceMotion ? 0 : 28, opacity: 0 },
              open: { x: 0, opacity: 1 },
            }}
            transition={reduceMotion ? { duration: 0.01 } : { type: "spring", stiffness: 330, damping: 30 }}
            onKeyDown={onPanelKeyDown}
          >
            <div className="navbar-02-sheet-heading">
              <h2>Pages</h2>
              <button ref={closeButton} className="navbar-02-sheet-close" type="button" aria-label="Close navigation" onClick={onClose}>
                <X size={20} strokeWidth={1.8} aria-hidden="true" />
              </button>
            </div>
            <nav className="navbar-02-sheet-links">
              {navItems.map((item, index) => {
                const Icon = ICONS[item.icon];
                const active = path === item.href
                  || ((item.href === "/wallets" || item.href === "/agents") && path.startsWith(`${item.href}/`));
                return (
                  <motion.div
                    key={item.href}
                    initial={reduceMotion ? false : { opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={reduceMotion ? { duration: 0.01 } : { duration: 0.18, delay: index * 0.018, ease: "easeOut" }}
                  >
                    <Link
                      to={item.href}
                      className={`navbar-02-sheet-link${active ? " navbar-02-sheet-link-active" : ""}`}
                      aria-current={active ? "page" : undefined}
                      onClick={onClose}
                    >
                      <Icon size={18} strokeWidth={1.7} aria-hidden="true" />
                      <span>{item.name}</span>
                    </Link>
                  </motion.div>
                );
              })}
            </nav>
            <div className="navbar-02-sheet-footer">
              <button
                type="button"
                className="navbar-02-signout"
                onClick={() => {
                  onClose();
                  void signOut();
                }}
              >
                Sign out
              </button>
            </div>
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
