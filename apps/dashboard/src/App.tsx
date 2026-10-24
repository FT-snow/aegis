import { useEffect, type ReactNode } from "react";
import { AppDataProvider, useAppData } from "./appdata";
import { RouterProvider, useRouter } from "./router";
import { Shell } from "./pages/Shell";
import { Landing } from "./pages/Landing";
import { Login } from "./pages/Login";
import { Overview } from "./pages/Overview";
import { WalletDetail, Wallets } from "./pages/Wallets";
import { AgentDetail, Agents } from "./pages/Agents";
import { Tasks } from "./pages/Tasks";
import { Transactions } from "./pages/Transactions";
import { Approvals } from "./pages/Approvals";
import { Security } from "./pages/Security";
import { Arena } from "./pages/Arena";
import { Settings } from "./pages/Settings";
import { Link } from "./router";

function SessionLoading() {
  return (
    <main className="loading-page" role="status" aria-live="polite">
      <span className="loading-mark" aria-hidden="true" />
      <span>Opening your workspace</span>
    </main>
  );
}

function NotFound() {
  return (
    <div className="page">
      <header className="page-header">
        <div><p className="eyebrow">404 / NOT FOUND</p><h1>This page is not in your workspace.</h1></div>
      </header>
      <Link to="/overview" className="button button-secondary">Return to overview</Link>
    </div>
  );
}

function ProtectedPage({ children }: { children: ReactNode }) {
  return <Shell>{children}</Shell>;
}

function Application() {
  const { authStatus } = useAppData();
  const { path, navigate } = useRouter();

  useEffect(() => {
    if (authStatus === "unauthenticated" && path !== "/" && path !== "/login") {
      navigate("/login", { replace: true });
    }
    if (authStatus === "authenticated" && path === "/login") {
      navigate("/overview", { replace: true });
    }
  }, [authStatus, path, navigate]);

  if (authStatus === "loading") return <SessionLoading />;
  if (path === "/") return <Landing />;
  if (authStatus === "unauthenticated") return <Login />;
  if (path === "/login") return <SessionLoading />;

  let page: ReactNode;
  if (path === "/overview") page = <Overview />;
  else if (path === "/wallets") page = <Wallets />;
  else if (path.startsWith("/wallets/")) page = <WalletDetail walletId={decodeURIComponent(path.slice("/wallets/".length))} />;
  else if (path === "/agents") page = <Agents />;
  else if (path.startsWith("/agents/")) page = <AgentDetail agentId={decodeURIComponent(path.slice("/agents/".length))} />;
  else if (path === "/tasks") page = <Tasks />;
  else if (path === "/transactions") page = <Transactions />;
  else if (path === "/approvals") page = <Approvals />;
  else if (path === "/security") page = <Security />;
  else if (path === "/arena") page = <Arena />;
  else if (path === "/settings") page = <Settings />;
  else page = <NotFound />;

  return <ProtectedPage>{page}</ProtectedPage>;
}

export default function App() {
  return (
    <RouterProvider>
      <AppDataProvider>
        <Application />
      </AppDataProvider>
    </RouterProvider>
  );
}
