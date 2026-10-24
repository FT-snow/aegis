import type { ReactNode } from "react";
import Navbar from "../components/ui/navbar-02";

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <Navbar />
      <main id="main-content" className="content-area">
        {children}
      </main>
    </div>
  );
}
