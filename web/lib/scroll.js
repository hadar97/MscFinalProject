// Scroll an element into view - smoothly, unless the user asked for less motion
export function scrollIntoViewSoon(ref) {
  requestAnimationFrame(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    ref.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
  });
}
