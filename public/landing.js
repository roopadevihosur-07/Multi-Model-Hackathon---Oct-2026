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

// From speech to map: pick a sentence to see its path through the models.
const lanes = document.querySelector(".lanes");
if (lanes) {
  const story = [
    { speech: "Speaker 1 · 0:12 · “Can we move the launch to Friday?”", map: "Topic “Launch timing”, with a question card that cites this line.", check: "Not checked. Questions are not decisions or tasks, so it stays an open question.", recap: "“Open question: can the launch move to Friday?”" },
    { speech: "Speaker 2 · 0:18 · “Let's go with Friday. I'll send the update.”", map: "A decision “Launch on Friday” and a task “Speaker 2 sends the update”.", check: "Pending until someone else responds. Supported once the transcript backs it.", recap: "“Friday launch agreed to. Speaker 2 sends the update.”" },
    { speech: "Speaker 3 · 0:25 · “Maybe we move it to the 31st.”", map: "A proposed decision “Move the launch to the 31st”.", check: "Not agreed. Nobody agreed, so it is downgraded, not verified.", recap: "“Moving the launch to the 31st was floated. Not agreed.”" },
  ];
  const picks = document.querySelectorAll("[data-pick]");
  const show = (i) => {
    picks.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.pick === String(i))));
    lanes.querySelectorAll("[data-lane]").forEach((p) => (p.textContent = story[i][p.dataset.lane]));
    lanes.querySelectorAll(".lane").forEach((l) => {
      l.classList.remove("flash");
      void l.offsetWidth;
      l.classList.add("flash");
    });
  };
  picks.forEach((b) => b.addEventListener("click", () => show(b.dataset.pick)));
  show(0);
}

// Hero preview: dismiss the "Your turn" banner (it stays until dismissed, as in the app) and tie or loosen an item.
document.querySelectorAll("[data-dismiss]").forEach((b) => {
  b.addEventListener("click", () => {
    b.closest("[data-turn]").classList.add("gone");
    document.querySelector("[data-replay]").hidden = false;
  });
});
document.querySelector("[data-replay]")?.addEventListener("click", (e) => {
  document.querySelector("[data-turn]").classList.remove("gone");
  e.currentTarget.hidden = true;
});
document.querySelectorAll("[data-tie]").forEach((b) => {
  b.addEventListener("click", () => {
    const tied = b.getAttribute("aria-pressed") !== "true";
    b.setAttribute("aria-pressed", String(tied));
    b.classList.toggle("loose", !tied);
    b.textContent = tied ? "Tied: redesign step 3 first" : "Loose: redesign step 3 first?";
  });
});
