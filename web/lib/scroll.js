// Smooth scrolling (instant if the user asked for less motion in the system settings)
const behavior = () => (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth");

// Scroll an element into view
export function scrollIntoViewSoon(ref, block = "center") {
  requestAnimationFrame(() => ref.current?.scrollIntoView({ behavior: behavior(), block }));
}

// After new items were added to a list: wait until they are on the page
// (two frames - React rendered, the browser laid them out), then glide so the
// FIRST new item is near the top of the screen. The page moves together with
// the new books, not before them.
export function scrollToNewItem(id, offset = 96) {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const el = document.getElementById(id);
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top, behavior: behavior() });
  }));
}
