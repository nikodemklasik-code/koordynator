(() => {
  const select = document.getElementById("modelSelect");
  const note = document.querySelector(".composer-note");
  const badge = document.getElementById("billingBadge");
  const muteButton = document.getElementById("muteHermesButton");
  const MUTE_KEY = "koordynator.liveChat.hermesMuted";
  const LAYOUT_KEY = "koordynator.liveChat.layoutVersion";

  function migrateHermesVisible() {
    try {
      if (localStorage.getItem(LAYOUT_KEY) !== "v4") {
        localStorage.setItem(MUTE_KEY, "0");
        localStorage.setItem(LAYOUT_KEY, "v4");
      }
    } catch { /* private mode */ }
    document.body.classList.remove("chat-hermes-muted");
    if (muteButton) muteButton.textContent = "Ukryj Hermes";
  }

  async function syncBackendPrimary() {
    if (!select) return;
    try {
      await Promise.race([
        window.koordynatorChatModelsReady || Promise.resolve(true),
        new Promise((resolve) => setTimeout(resolve, 5000))
      ]);
      const [healthResponse, catalogResponse] = await Promise.all([
        fetch("/api/health", { headers: { accept: "application/json" } }),
        fetch("/api/chat/models", { headers: { accept: "application/json" } })
      ]);
      if (!healthResponse.ok || !catalogResponse.ok) return;
      const health = await healthResponse.json();
      const catalog = await catalogResponse.json();
      const configured = typeof health.chatDefaultModel === "string" ? health.chatDefaultModel : "";
      if (!configured) return;
      const available = new Set(Array.isArray(catalog.models) ? catalog.models : []);
      if (!available.has(configured)) return;
      const option = [...select.options].find((item) => item.value === configured);
      if (!option) return;
      if (select.value !== configured) {
        select.value = configured;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
      select.dataset.backendPrimary = configured;
      const free = /^(oc|ddgw|unc|horde)\//.test(configured);
      if (badge && free) {
        badge.textContent = "FREE PRIMARY";
        badge.className = "billing-badge free_confirmed";
        badge.title = `Backend live-probed free primary: ${configured}`;
      }
      if (note) {
        note.textContent = free
          ? `Free-first routing active. Primary: ${configured}. Subscription routes are fallback only.`
          : `Backend primary: ${configured}.`;
      }
      document.documentElement.dataset.controlWorkspace = "v4";
    } catch {
      // Existing fail-closed catalog policy remains authoritative.
    }
  }

  migrateHermesVisible();
  void syncBackendPrimary();
  setTimeout(() => void syncBackendPrimary(), 1200);
  setTimeout(() => void syncBackendPrimary(), 3500);
  window.addEventListener("focus", () => void syncBackendPrimary());
})();
