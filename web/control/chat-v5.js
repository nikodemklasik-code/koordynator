(() => {
  const root = document.documentElement;
  const splitter = document.getElementById("workspaceSplitter");
  const workspace = document.getElementById("chatWorkspace");
  const modelSelect = document.getElementById("modelSelect");
  const primaryLabel = document.getElementById("primaryRouteLabel");
  const fallbackLabel = document.getElementById("fallbackRoutesLabel");
  const STORAGE_WIDTH = "koordynator.liveChat.v5.terminalWidth";
  const DEFAULT_WIDTH = 420;
  const MIN_WIDTH = 300;
  const MAX_WIDTH = 720;
  let routeHealth = null;

  root.dataset.workspace = "v5";

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function availableWidth() {
    const width = workspace?.clientWidth || window.innerWidth;
    return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.floor(width * 0.55)));
  }

  function setTerminalWidth(value, persist = true) {
    const width = clamp(Number(value) || DEFAULT_WIDTH, MIN_WIDTH, availableWidth());
    root.style.setProperty("--terminal-width", `${width}px`);
    if (persist) {
      try { localStorage.setItem(STORAGE_WIDTH, String(width)); } catch { /* storage unavailable */ }
    }
    window.dispatchEvent(new Event("resize"));
  }

  function restoreTerminalWidth() {
    let value = DEFAULT_WIDTH;
    try { value = Number(localStorage.getItem(STORAGE_WIDTH)) || DEFAULT_WIDTH; } catch { /* storage unavailable */ }
    setTerminalWidth(value, false);
  }

  function beginResize(event) {
    if (!splitter || window.innerWidth <= 900) return;
    event.preventDefault();
    splitter.setPointerCapture?.(event.pointerId);
    const startX = event.clientX;
    const current = parseInt(getComputedStyle(root).getPropertyValue("--terminal-width"), 10) || DEFAULT_WIDTH;

    const move = (moveEvent) => {
      const next = current + (startX - moveEvent.clientX);
      setTerminalWidth(next);
    };
    const end = (endEvent) => {
      splitter.releasePointerCapture?.(endEvent.pointerId);
      splitter.removeEventListener("pointermove", move);
      splitter.removeEventListener("pointerup", end);
      splitter.removeEventListener("pointercancel", end);
      window.dispatchEvent(new Event("resize"));
    };

    splitter.addEventListener("pointermove", move);
    splitter.addEventListener("pointerup", end);
    splitter.addEventListener("pointercancel", end);
  }

  splitter?.addEventListener("pointerdown", beginResize);
  splitter?.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const current = parseInt(getComputedStyle(root).getPropertyValue("--terminal-width"), 10) || DEFAULT_WIDTH;
    setTerminalWidth(current + (event.key === "ArrowLeft" ? 24 : -24));
  });
  window.addEventListener("resize", () => setTerminalWidth(parseInt(getComputedStyle(root).getPropertyValue("--terminal-width"), 10) || DEFAULT_WIDTH, false));
  restoreTerminalWidth();

  function isFreeNoAuth(model) {
    return /^(?:oc|ddgw|unc|horde)\//.test(String(model || ""));
  }

  function renderRouteSummary(health) {
    routeHealth = health && typeof health === "object" ? health : routeHealth;
    if (!routeHealth) return;
    const primary = typeof routeHealth.chatDefaultModel === "string" && routeHealth.chatDefaultModel
      ? routeHealth.chatDefaultModel
      : "not configured";
    const fallbacks = Array.isArray(routeHealth.chatFallbackModels)
      ? routeHealth.chatFallbackModels.filter((value) => typeof value === "string" && value)
      : [];

    if (primaryLabel) {
      primaryLabel.textContent = primary;
      primaryLabel.title = isFreeNoAuth(primary) ? "Live-probed free/no-auth primary route" : "Configured primary route";
      primaryLabel.dataset.free = isFreeNoAuth(primary) ? "true" : "false";
    }
    if (fallbackLabel) {
      fallbackLabel.textContent = fallbacks.length ? `fallback · ${fallbacks.join(" → ")}` : "no fallback routes";
      fallbackLabel.title = fallbacks.join(" → ");
    }
  }

  async function fetchHealth() {
    const response = await fetch("/api/health", { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`HEALTH_HTTP_${response.status}`);
    return response.json();
  }

  async function ensureBackendPrimary() {
    if (!modelSelect) return;
    try {
      await Promise.race([
        window.koordynatorChatModelsReady || Promise.resolve(true),
        new Promise((resolve) => setTimeout(resolve, 5000))
      ]);
      const health = await fetchHealth();
      renderRouteSummary(health);
      const desired = typeof health.chatDefaultModel === "string" ? health.chatDefaultModel : "";
      if (!desired) return;
      const option = [...modelSelect.options].find((item) => item.value === desired && !item.disabled);
      if (!option) return;
      if (modelSelect.value !== desired) {
        modelSelect.value = desired;
        modelSelect.dispatchEvent(new Event("change", { bubbles: true }));
      }
      modelSelect.dataset.backendPrimary = desired;
    } catch {
      if (primaryLabel) primaryLabel.textContent = "route unavailable";
      if (fallbackLabel) fallbackLabel.textContent = "health unavailable";
    }
  }

  document.addEventListener("koordynator:billing-change", () => {
    if (!routeHealth) return;
    renderRouteSummary(routeHealth);
  });
  window.addEventListener("focus", () => void ensureBackendPrimary());
  void ensureBackendPrimary();
})();
