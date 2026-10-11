// Landing page only: click-to-explore figures and scroll reveals. Plain JS, no build step.
document.documentElement.classList.add("js");

// Any [data-explorer] shows the description of whichever item is picked.
document.querySelectorAll("[data-explorer]").forEach((ex) => {
  const out = ex.querySelector(".detail");
  const picks = ex.querySelectorAll("[data-detail]");
  picks.forEach((b) => {
    b.setAttribute("aria-pressed", "false");
    b.addEventListener("click", () => {
      picks.forEach((x) => x.setAttribute("aria-pressed", "false"));
      b.setAttribute("aria-pressed", "true");
      out.textContent = b.dataset.detail;
    });
  });
});

// Sections fade up as they enter the screen. Without motion support, show them at once.
const reveals = document.querySelectorAll(".reveal");
if ("IntersectionObserver" in window && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
  const io = new IntersectionObserver(
    (entries) =>
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add("in");
          io.unobserve(e.target);
        }
      }),
    { threshold: 0.12 }
  );
  reveals.forEach((el) => io.observe(el));
} else {
  reveals.forEach((el) => el.classList.add("in"));
}
