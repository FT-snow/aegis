import { HairlineHero } from "../hero";
import { Link } from "../router";
import { useAppData } from "../appdata";

export function Landing() {
  const { authStatus } = useAppData();
  const destination = authStatus === "authenticated" ? "/overview" : "/login";
  const entryLabel = authStatus === "authenticated" ? "Open workspace" : "Enter AEGIS";

  return (
    <div className="landing">
      <a className="skip-link" href="#landing-main">Skip to content</a>
      <header className="landing-top">
        <Link to="/" className="landing-brand" aria-label="AEGIS home">AEGIS<span>.</span></Link>
        <div className="landing-top-right">
          <span className="chain-badge"><span className="chain-dot" /> Base Sepolia · TESTNET</span>
          <Link to={destination} className="landing-signin">{authStatus === "authenticated" ? "Workspace" : "Sign in"}<span aria-hidden="true">↗</span></Link>
        </div>
      </header>

      <main id="landing-main" className="landing-main">
        <section className="landing-copy">
          <p className="eyebrow"><span className="eyebrow-rule" /> AUTONOMOUS FINANCE, WITH LIMITS</p>
          <h1 className="landing-title">Your money.<br /><span>Your rules.</span></h1>
          <p className="landing-description">
            Let agents act on approved tasks. Keep every wallet action inside limits you set.
          </p>
          <div className="landing-actions">
            <Link to={destination} className="button button-primary button-large">{entryLabel}<span aria-hidden="true">↗</span></Link>
            <Link to={authStatus === "authenticated" ? "/tasks" : "/login"} className="button button-quiet button-large">Assign a task</Link>
          </div>
        </section>

        <div className="landing-art" aria-label="A line-art relay connecting an agent to a protected wallet">
          <div className="art-index">FIG. 01 <span>CONTROLLED AUTONOMY</span></div>
          <HairlineHero />
          <div className="art-caption"><span className="art-caption-line" />A signed action. A bounded authority.</div>
        </div>
      </main>

      <footer className="landing-footer">
        <span>ERC-4337 SMART ACCOUNTS · BASE SEPOLIA TESTNET</span>
        <span>Built for actions you can inspect.</span>
      </footer>
    </div>
  );
}
