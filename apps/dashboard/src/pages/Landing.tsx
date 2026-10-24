import { useLayoutEffect, useRef } from "react";
import gsap from "gsap";
import { HairlineHero } from "../hero";
import { Link } from "../router";
import { useAppData } from "../appdata";

export function Landing() {
  const { authStatus } = useAppData();
  const destination = authStatus === "authenticated" ? "/overview" : "/login";
  const entryLabel = authStatus === "authenticated" ? "Open workspace" : "Enter AEGIS";
  const heroRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    if (!heroRef.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const context = gsap.context(() => {
      gsap.timeline({ defaults: { ease: "power3.out" } })
        .fromTo(".landing-title", { autoAlpha: 0, y: 26 }, { autoAlpha: 1, y: 0, duration: 0.75 })
        .fromTo(".landing-description", { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: 0.45 }, "-=0.42")
        .fromTo(".landing-actions", { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: 0.35 }, "-=0.28")
        .fromTo(".hero-figure", { autoAlpha: 0, scale: 0.97 }, { autoAlpha: 1, scale: 1, duration: 0.85 }, "-=0.72");
    }, heroRef);

    return () => context.revert();
  }, []);

  return (
    <div className="landing">
      <a className="skip-link" href="#landing-main">Skip to content</a>
      <header className="landing-top">
        <Link to="/" className="landing-brand" aria-label="AEGIS home">AEGIS<span>.</span></Link>
        <Link to={destination} className="landing-signin">{authStatus === "authenticated" ? "Workspace" : "Sign in"}<span aria-hidden="true">↗</span></Link>
      </header>

      <main ref={heroRef} id="landing-main" className="landing-main">
        <section className="landing-copy">
          <h1 className="landing-title">Your money.<br /><span>Your rules.</span></h1>
          <p className="landing-description">
            Let agents act on approved tasks. Keep every wallet action inside limits you set.
          </p>
          <div className="landing-actions">
            <Link to={destination} className="button button-primary button-large">{entryLabel}<span aria-hidden="true">↗</span></Link>
          </div>
        </section>

        <div className="landing-art" aria-label="A line-art relay connecting an agent to a protected wallet">
          <HairlineHero />
        </div>
      </main>

    </div>
  );
}
