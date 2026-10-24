import { Component, type ErrorInfo, type ReactNode } from "react";
import { Relay } from "@lucasmarkes/hairline/react";

class FigureFallback extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(_error: unknown, _info: ErrorInfo) {
    // The hand-drawn SVG below renders instead; no telemetry configured.
  }
  render() {
    return this.state.failed ? (
      <svg
        className="hero-fallback-svg"
        viewBox="0 0 400 320"
        role="img"
        aria-label="Isometric line drawing of a relay hub connecting four branches of tiles"
      >
        <g fill="none" stroke="#ffffff" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
          {/* plinth */}
          <path className="draw d1" d="M60 250 L200 322 L340 250 L200 178 Z" />
          <path className="draw d2" d="M60 250 L60 236 L200 308 L200 322" />
          <path className="draw d2" d="M340 250 L340 236 L200 308" />
          {/* hub */}
          <path className="draw d3" d="M200 150 L232 166 L200 182 L168 166 Z" />
          <path className="draw d3" d="M168 166 L168 156 L200 140 L232 156 L232 166" />
          <path className="draw d3" d="M200 140 L200 150" />
          {/* branches */}
          <path className="draw d4" d="M200 166 L120 126 L120 116 L200 156" />
          <path className="draw d4" d="M200 166 L280 126 L280 116 L200 156" />
          <path className="draw d4" d="M200 166 L164 200 L164 210 L200 190" />
          <path className="draw d4" d="M200 166 L236 200 L236 210 L200 190" />
          {/* tiles */}
          <path className="draw d5" d="M104 112 L136 128 L120 136 L88 120 Z" />
          <path className="draw d5" d="M296 112 L264 128 L280 136 L312 120 Z" />
          <path className="draw d5" d="M156 212 L188 228 L172 236 L140 220 Z" />
          <path className="draw d5" d="M244 212 L212 228 L228 236 L260 220 Z" />
        </g>
      </svg>
    ) : this.props.children;
  }
}

/**
 * Landing figure: a white-line isometric relay on the ink background.
 * Uses @lucasmarkes/hairline's Relay; falls back to hand-drawn SVG line art
 * if the library fails at runtime.
 */
export function HairlineHero() {
  return (
    <div className="hero-figure">
      <FigureFallback>
        <Relay
          theme="dark"
          play={true}
          intensity={0.6}
          label="Isometric line drawing of a relay hub connecting four branches of tiles"
          className="hero-hairline"
        />
      </FigureFallback>
    </div>
  );
}
