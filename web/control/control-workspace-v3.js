(() => {
  const select = document.getElementById("modelSelect");
  const note = document.querySelector(".composer-note");
  const badge = document.getElementById("billingBadge");

  async function syncPrimary() {
    if (!select) return;
    try {
      await Promise.race([
        window.koordynatorChatModelsReady || Promise.resolve(true),
        new Promise((resolve) => setTimeout(resolve, 4000))
      ]);
      const [healthResponse, catalogResponse] = await Promise.all([
        fetch("/api/health", { headers: { accept: "application/json" } }),
        fetch("/api/chat/models", { headers: { accept: "application/json" } })
      ]);
      if (!healthResponse.ok || !catalogResponse.ok) return;
      const health = await healthResponse.json();
      const catalog = await catalogResponse.json();
      const available = new Set(Array.isArray(catalog.models) ? catalog.models : []);
      const entries = Array.isArray(catalog.entries) ? catalog.entries : [];
      const configured = typeof health.chatDefaultModel === "string" ? health.chatDefaultModel : "";
      const free = entries.find((entry) => entry && entry.billingSource === "FREE_CONFIRMED" && available.has(entry.id))?.id
        || entries.find((entry) => entry && entry.billingSource === "FREE_OAUTH" && available.has(entry.id))?.id
        || "";
      const desired = configured && available.has(configured) ? configured : free;
      if (!desired) return;
      const option = [...select.options].find((item) => item.value === desired);
      if (!option) return;
      if (select.value !== desired) {
        select.value = desired;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
      select.dataset.backendPrimary = desired;
      select.title = `Backend primary: ${desired}. ${select.title || ""}`.trim();
      if (badge && /^(oc|ddgw|unc|horde)\//.test(desired)) {
        badge.textContent = "FREE PRIMARY";
        badge.className = "billing-badge free_confirmed";
      }
      if (note && /^(oc|ddgw|unc|horde)\//.test(desired)) {
        note.textContent = `Free-first routing active. Primary: ${desired}. Subscription routes are fallbacks only.`;
      }
      document.documentElement.dataset.controlWorkspace = "v3";
    } catch {
      // Existing fail-closed catalog and billing policy remain authoritative.
    }
  }

  void syncPrimary();
  window.addEventListener("focus", () => void syncPrimary());
})();
