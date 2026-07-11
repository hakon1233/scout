// Motion-preference helpers. The global reduced-motion CSS in `globals.css`
// clamps CSS transitions/animations, but it can't reach motion driven from
// JavaScript - typewriter streaming, `scrollTo({ behavior: "smooth" })`. Call
// this before kicking off that kind of motion so `prefers-reduced-motion:
// reduce` users get an instant, non-animated result.

/**
 * True when the user asked the OS for reduced motion. Safe during
 * SSR/prerender: returns false when `window`/`matchMedia` are unavailable
 * rather than throwing, and reads the live value on each call.
 */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
