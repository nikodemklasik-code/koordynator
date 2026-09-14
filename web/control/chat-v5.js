(() => {
  "use strict";

  const root = document.documentElement;
  const body = document.body;
  const workspace = document.getElementById("chatWorkspace");
  const splitter = document.getElementById("workspaceSplitter");
  const hermesPane = document.getElementById("hermesPane");
  const modelSelect = document.getElementById("modelSelect");
  const primaryRouteLabel = document.getElementById("primaryRouteLabel");
  const fallbackRoutesLabel = document.getElementById("fallbackRoutesLabel");
  const footerConnection = document.getElementById("footerConnection");
  const STORAGE_WIDTH = "koordynator.workspace.hermes.width.v6";
  let routeHealth = null;
  let dragging = false;
  let applyingWidth = false;

  root.dataset.workspace = "v6";

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function workspaceWidth() {
    return workspace?.getBoundingClientRect().width || window.innerWidth;
  }

  function limits() {
    const width = workspaceWidth();
    const minTerminal = width < 760 ? 260 : 340;
    const minChat = width < 760 ? 300 : 430;
    const maxTerminal = Math.max(minTerminal, width - minChat);
    return { minTerminal, maxTerminal };
  }

  function setTerminalWidth(requested, persist = true) {
    if (!workspace || applyingWidth) return;
    const width = workspaceWidth();
    const { minTerminal, maxTerminal } = limits();
    let value = Number(requested);
    if (!Number.isFinite(value)) value = Math.round(width * 0.34);
    value = clamp(value, minTerminal, maxTerminal);

    applyingWidth = true;
    root.style.setProperty("--terminal-width", `${value}px`);
    applyingWidth = false;

    if (persist) {
      try { localStorage.setItem(STORAGE_WIDTH, String(value)); } catch { /* storage unavailable */ }
      requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
    }
  }

  function restoreTerminalWidth() {
    let saved = 0;
    try { saved = Number(localStorage.getItem(STORAGE_WIDTH)); } catch { /* ignore */ }
    setTerminalWidth(saved || workspaceWidth() * 0.34, false);
  }

  function pointerDown(event) {
    if (!splitter) return;
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();
    dragging = true;
    splitter.classList.add("dragging");
    splitter.setPointerCapture?.(event.pointerId);
    const startX = event.clientX;
    const currentWidth = hermesPane?.getBoundingClientRect().width || workspaceWidth() * 0.34;

    function pointerMove(moveEvent) {
      if (!dragging) return;
      setTerminalWidth(currentWidth + (startX - moveEvent.clientX));
    }

    function pointerUp(upEvent) {
      dragging = false;
      splitter.classList.remove("dragging");
      splitter.releasePointerCapture?.(upEvent.pointerId);
      splitter.removeEventListener("pointermove", pointerMove);
      splitter.removeEventListener("pointerup", pointerUp);
      splitter.removeEventListener("pointercancel", pointerUp);
      window.dispatchEvent(new Event("resize"));
    }

    splitter.addEventListener("pointermove", pointerMove);
    splitter.addEventListener("pointerup", pointerUp);
    splitter.addEventListener("pointercancel", pointerUp);
  }

  splitter?.addEventListener("pointerdown", pointerDown);
  splitter?.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const current = hermesPane?.getBoundingClientRect().width || workspaceWidth() * 0.34;
    setTerminalWidth(current + (event.key === "ArrowLeft" ? 24 : -24));
  });

  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    if (dragging || applyingWidth) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (body.classList.contains("terminal-hidden") || body.classList.contains("chat-hermes-muted")) return;
      const current = hermesPane?.getBoundingClientRect().width;
      if (current) setTerminalWidth(current, false);
    }, 80);
  });

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

    if (primaryRouteLabel) {
      primaryRouteLabel.textContent = primary;
      primaryRouteLabel.title = isFreeNoAuth(primary) ? "Live-probed free/no-auth primary route" : "Configured primary route";
      primaryRouteLabel.dataset.free = isFreeNoAuth(primary) ? "true" : "false";
    }
    if (fallbackRoutesLabel) {
      fallbackRoutesLabel.textContent = fallbacks.length ? `fallback · ${fallbacks.join(" → ")}` : "no fallback routes";
      fallbackRoutesLabel.title = fallbacks.join(" → ");
    }
    if (footerConnection) footerConnection.textContent = "CONNECTED";
  }

  async function fetchJsonWithTimeout(url, timeout = 2500) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, {
        headers: { accept: "application/json" },
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`HTTP_${response.status}`);
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async function refreshHealth() {
    try {
      renderRouteSummary(await fetchJsonWithTimeout("/api/health"));
    } catch {
      if (primaryRouteLabel) primaryRouteLabel.textContent = "route unavailable";
      if (fallbackRoutesLabel) fallbackRoutesLabel.textContent = "backend health unavailable";
      if (footerConnection) footerConnection.textContent = "LOCAL UI";
    }
  }

  async function ensureBackendPrimary() {
    if (!modelSelect) return;
    try {
      await Promise.race([
        window.koordynatorChatModelsReady || Promise.resolve(true),
        new Promise((resolve) => setTimeout(resolve, 5000))
      ]);
      const health = await fetchJsonWithTimeout("/api/health");
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
      if (primaryRouteLabel) primaryRouteLabel.textContent = "route unavailable";
      if (fallbackRoutesLabel) fallbackRoutesLabel.textContent = "health unavailable";
    }
  }

  const MODEL_ROLES = [
    ["ALL", "All roles"],
    ["PRODUCT_OWNER", "Product Owner"],
    ["DEVELOPER", "Developer"],
    ["RESEARCHER", "Researcher"],
    ["FRONTEND_DEVELOPER", "Frontend Developer"],
    ["FRONTEND_BUILDER", "Frontend Builder"],
    ["BUILDER", "Builder"],
    ["INNOVATION_DEVELOPER", "Innovation Developer"],
    ["SECURITY", "Security"]
  ];

  function contextSize(text) {
    const match = /\b(\d+(?:\.\d+)?)K\s+CTX\b/i.exec(text);
    return match ? Number(match[1]) : 0;
  }

  function rolesForOption(option) {
    const text = `${option.value} ${option.textContent || ""}`.toLowerCase();
    const roles = new Set(["GENERAL", "PRODUCT_OWNER"]);
    const coding = /(codex|gpt|claude|qwen|kimi|grok|gemini|coder|code|big-pickle|nemotron|mimo|ling|sonnet|opus)/.test(text);
    const reasoning = /(opus|sonnet|gpt-5|grok-4|gemini|reason|thinking|xhigh|high)/.test(text);
    const vision = /\bvision\b/.test(text);
    const longContext = contextSize(option.textContent || "") >= 128;
    if (coding) {
      roles.add("DEVELOPER");
      roles.add("BUILDER");
    }
    if (coding || vision) roles.add("FRONTEND_DEVELOPER");
    if (coding && (vision || longContext || reasoning)) roles.add("FRONTEND_BUILDER");
    if (longContext || reasoning || /research/.test(text)) roles.add("RESEARCHER");
    if (reasoning || vision || /innovation/.test(text)) roles.add("INNOVATION_DEVELOPER");
    if (coding && (reasoning || longContext)) roles.add("SECURITY");
    return roles;
  }

  function ensureModelExplorer() {
    if (!modelSelect || document.getElementById("modelSearchInput")) return;
    const picker = modelSelect.closest(".v5-model-picker") || modelSelect.parentElement;
    const actions = modelSelect.closest(".v5-composer-actions") || picker?.parentElement;
    if (!picker || !actions) return;

    const explorer = document.createElement("div");
    explorer.className = "v5-model-explorer";
    explorer.innerHTML = `
      <div class="v5-model-combobox">
        <input id="modelSearchInput" class="v5-model-search" type="search" autocomplete="off" spellcheck="false" placeholder="Type or choose model…" aria-label="Type or choose AI model" aria-controls="modelSearchResults" />
        <button class="v5-model-open" type="button" aria-label="Open model list" title="Open model list">⌄</button>
      </div>
      <select id="modelRoleFilter" class="v5-model-role" aria-label="Model role category">
        ${MODEL_ROLES.map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}
      </select>
      <div id="modelSearchResults" class="v5-model-results" role="listbox" hidden></div>`;
    actions.insertBefore(explorer, picker);
    picker.classList.add("v5-native-model-picker");

    const input = explorer.querySelector("#modelSearchInput");
    const open = explorer.querySelector(".v5-model-open");
    const role = explorer.querySelector("#modelRoleFilter");
    const results = explorer.querySelector("#modelSearchResults");

    function entries() {
      return [...modelSelect.options]
        .filter((option) => option.value && !option.disabled)
        .map((option) => ({ option, roles: rolesForOption(option) }));
    }

    function renderResults(forceOpen = false) {
      const query = String(input.value || "").trim().toLowerCase();
      const selectedRole = role.value;
      const filtered = entries().filter(({ option, roles }) => {
        const roleMatch = selectedRole === "ALL" || roles.has(selectedRole);
        const text = `${option.value} ${option.textContent || ""}`.toLowerCase();
        return roleMatch && (!query || text.includes(query));
      }).slice(0, 20);

      if (!forceOpen && !query && selectedRole === "ALL") {
        results.hidden = true;
        return;
      }
      results.hidden = false;
      if (!filtered.length) {
        results.innerHTML = '<div class="v5-model-empty">No matching executable model.</div>';
        return;
      }
      results.innerHTML = filtered.map(({ option, roles }) => {
        const labels = [...roles].filter((item) => item !== "GENERAL").slice(0, 3);
        return `<button type="button" class="v5-model-result${option.value === modelSelect.value ? " active" : ""}" data-model="${option.value.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}">
          <span><strong>${(option.textContent || option.value).replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</strong><small>${option.value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</small></span>
          <span class="v5-model-tags">${labels.map((item) => `<i class="v5-model-tag">${MODEL_ROLES.find(([value]) => value === item)?.[1] || item}</i>`).join("")}</span>
        </button>`;
      }).join("");
    }

    input.addEventListener("input", () => renderResults(true));
    input.addEventListener("focus", () => renderResults(true));
    open.addEventListener("click", () => {
      renderResults(true);
      input.focus();
    });
    role.addEventListener("change", () => renderResults(true));
    results.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-model]");
      if (!button) return;
      const value = button.dataset.model;
      const option = [...modelSelect.options].find((item) => item.value === value && !item.disabled);
      if (!option) return;
      modelSelect.value = value;
      modelSelect.dispatchEvent(new Event("change", { bubbles: true }));
      input.value = option.textContent || value;
      input.title = option.title || value;
      results.hidden = true;
    });
    document.addEventListener("pointerdown", (event) => {
      if (!explorer.contains(event.target)) results.hidden = true;
    });
    modelSelect.addEventListener("change", () => {
      const selected = modelSelect.selectedOptions[0];
      if (!selected) return;
      input.value = selected.textContent || selected.value;
      input.title = selected.title || selected.value;
    });
    const initiallySelected = modelSelect.selectedOptions[0];
    if (initiallySelected?.value) {
      input.value = initiallySelected.textContent || initiallySelected.value;
      input.title = initiallySelected.title || initiallySelected.value;
    }
    new MutationObserver(() => {
      const selected = modelSelect.selectedOptions[0];
      if (selected?.value && !input.matches(":focus")) {
        input.value = selected.textContent || selected.value;
        input.title = selected.title || selected.value;
      }
      if (!results.hidden) renderResults(true);
    }).observe(modelSelect, { childList: true, subtree: true });
  }

  function installHermesReadableSanitizer() {
    const transcript = document.getElementById("hermesTranscript");
    if (!transcript || transcript.dataset.tuiSanitizer === "1") return Boolean(transcript);
    transcript.dataset.tuiSanitizer = "1";

    let inReasoningFrame = false;
    const rowsSelector = ".terminal-answer-line,.terminal-noise";

    function hide(row) {
      row.classList.add("terminal-tui-hidden");
      row.setAttribute("aria-hidden", "true");
    }

    function meta(row, warning = false) {
      row.classList.remove("terminal-answer-line");
      row.classList.add("terminal-noise", "terminal-tui-meta");
      if (warning) row.classList.add("warning");
    }

    function sanitizeRow(row) {
      if (!(row instanceof HTMLElement) || row.dataset.tuiSanitized === "1") return;
      row.dataset.tuiSanitized = "1";
      const text = String(row.textContent || "").replace(/\s+/g, " ").trim();
      if (!text) { hide(row); return; }

      if (/[┌╭].*\bReasoning\b/i.test(text)) {
        inReasoningFrame = true;
        hide(row);
        return;
      }
      if (inReasoningFrame) {
        hide(row);
        if (/^[└╰][─━-]{3,}/.test(text)) inReasoningFrame = false;
        return;
      }

      if (/^Plan a feature, then build it step by step$/i.test(text) ||
          /^Window too small\.{0,3}$/i.test(text) ||
          /^\[?0m\]?$/i.test(text) ||
          /^\d+(?:\s+[a-z])?$/i.test(text) ||
          /^[╭╰┌└├┤│─━\s]+$/.test(text)) {
        hide(row);
        return;
      }

      if (/^(?:The user (?:wants|asked|is asking|requested)|I (?:need to|should|have all the facts|will now)|We need to|Need to)\b/i.test(text) ||
          /\bI have all the facts\. Reply in Polish\b/i.test(text)) {
        hide(row);
        return;
      }

      if (/^(?:⚕\s*)?(?:❯\s*)?msg=interrupt\b/i.test(text) ||
          /^⚕\s+.+(?:ctx\s+--|\d+(?:\.\d+)?K\/\d+[KM]).*[│┤]/i.test(text) ||
          /^(?:Initializing agent|Welcome to Hermes Agent|Tip:|Available Tools|Available Skills)\b/i.test(text) ||
          /(?:contemplating|processing|mulling|reflecting|preparing terminal)/i.test(text) ||
          /^💻\s*/.test(text)) {
        meta(row);
        return;
      }

      if (/^⚠️?\s*Model fallback:/i.test(text) || /authentication failed/i.test(text)) {
        meta(row, true);
      }
    }

    function sanitizeTree(node) {
      if (!(node instanceof HTMLElement)) return;
      if (node.matches(rowsSelector)) sanitizeRow(node);
      for (const row of node.querySelectorAll(rowsSelector)) sanitizeRow(row);
    }

    sanitizeTree(transcript);
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) sanitizeTree(node);
      }
    });
    observer.observe(transcript, { childList: true, subtree: true });
    return true;
  }

  document.addEventListener("koordynator:billing-change", () => {
    if (!routeHealth) return;
    renderRouteSummary(routeHealth);
  });
  window.addEventListener("focus", () => void ensureBackendPrimary());
  Promise.resolve(window.koordynatorChatModelsReady || true).finally(() => ensureModelExplorer());
  setTimeout(ensureModelExplorer, 1200);
  if (!installHermesReadableSanitizer()) {
    const sanitizerTimer = setInterval(() => {
      if (installHermesReadableSanitizer()) clearInterval(sanitizerTimer);
    }, 250);
    setTimeout(() => clearInterval(sanitizerTimer), 10_000);
  }

  void refreshHealth();
  void ensureBackendPrimary();
})();
