(() => {
  "use strict";
  fetch("/api/health", { headers: { accept: "application/json" } })
    .then((response) => response.ok ? response.json() : null)
    .then((health) => {
      if (!health) return;
      document.documentElement.dataset.runtime = "connected";
      const badge = document.querySelector(".ustroj-core-badge strong");
      if (badge && typeof health.version === "string") badge.title = `Koordynator ${health.version}`;
    })
    .catch(() => {
      document.documentElement.dataset.runtime = "offline";
    });
})();
