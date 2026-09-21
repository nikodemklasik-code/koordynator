(() => {
  const root = document.documentElement;
  const splitter = document.getElementById("workspaceSplitter");
  const workspace = document.getElementById("chatWorkspace");
  const modelSelect = document.getElementById("modelSelect");
  const primaryLabel = document.getElementById("primaryRouteLabel");
  const fallbackLabel = document.getElementById("fallbackRoutesLabel");
  const STORAGE_WIDTH = "koordynator.liveChat.v5.terminalWidth.runtime2";
  const DEFAULT_WIDTH = 500;
  const MIN_WIDTH = 380;
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

  const MODEL_ROLES = [
    ["ALL", "All roles"],
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
    const roles = new Set(["GENERAL"]);
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

  function ensureExplorerStyles() {
    // Canonical layout lives in chat-shell.css. Keep this hook for older runtimes
    // that still call it, but never inject a competing third layout definition.
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function ensureModelExplorer() {
    if (!modelSelect) return;
    ensureExplorerStyles();

    const actions = modelSelect.closest(".v5-composer-actions");
    if (!actions) return;

    let row = actions.querySelector(".v5-control-row");
    let unified = document.getElementById("unifiedModelSelector") || actions.querySelector(".v5-unified-model-select");
    let input = document.getElementById("modelSearchInput");
    let menuButton = document.getElementById("modelMenuButton");
    let results = document.getElementById("modelSearchResults");
    let role = document.getElementById("modelRoleFilter");

    if (!row || !unified || !input || !menuButton || !results || !role) {
      const picker = modelSelect.closest(".v5-model-picker") || modelSelect.parentElement;
      if (!picker) return;
      const addAgent = document.getElementById("addAgentButton");
      const attach = document.getElementById("attachButton");
      const stop = document.getElementById("stopButton");
      const send = document.getElementById("sendButton");

      row = document.createElement("div");
      row.className = "v5-control-row";
      row.setAttribute("aria-label", "Model, role and message controls");

      unified = document.createElement("div");
      unified.id = "unifiedModelSelector";
      unified.className = "v5-unified-model-select";
      unified.setAttribute("role", "combobox");
      unified.setAttribute("aria-haspopup", "listbox");
      unified.setAttribute("aria-expanded", "false");
      unified.innerHTML = `
        <input id="modelSearchInput" class="v5-model-search" type="search"
          autocomplete="off" spellcheck="false"
          placeholder="SEARCH OR CHOOSE MODEL"
          aria-label="Search or choose AI model" />
        <button id="modelMenuButton" class="v5-model-menu-button" type="button"
          aria-label="Open model menu" aria-expanded="false">⌄</button>
        <div id="modelSearchResults" class="v5-model-results" role="listbox" hidden></div>`;

      role = document.createElement("select");
      role.id = "modelRoleFilter";
      role.className = "v5-model-role";
      role.setAttribute("aria-label", "Model role category");
      role.innerHTML = MODEL_ROLES.map(([value, label]) => `<option value="${value}">${label}</option>`).join("");

      picker.classList.add("v5-native-model-picker");
      picker.setAttribute("aria-hidden", "true");
      actions.textContent = "";
      unified.appendChild(picker);
      row.append(unified, role);
      if (addAgent) row.appendChild(addAgent);
      if (attach) row.appendChild(attach);
      if (stop) row.appendChild(stop);
      if (send) row.appendChild(send);
      actions.appendChild(row);

      input = document.getElementById("modelSearchInput");
      menuButton = document.getElementById("modelMenuButton");
      results = document.getElementById("modelSearchResults");
    }

    if (!input || !menuButton || !results || !role || !unified || !row) return;
    if (unified.dataset.bound === "true") return;
    unified.dataset.bound = "true";
    actions.classList.add("v5-canonical-control-row");

    const picker = modelSelect.closest(".v5-model-picker");
    picker?.classList.add("v5-native-model-picker");
    picker?.setAttribute("aria-hidden", "true");

    function entries() {
      return [...modelSelect.options]
        .filter((option) => option.value && !option.disabled)
        .map((option) => ({ option, roles: rolesForOption(option) }));
    }

    function selectedLabel() {
      const option = modelSelect.selectedOptions?.[0];
      return option?.textContent?.trim() || option?.value || "SELECT MODEL";
    }

    function syncSelectedLabel() {
      if (document.activeElement !== input || input.dataset.editing !== "true") {
        input.value = selectedLabel();
      }
      input.title = modelSelect.value || selectedLabel();
    }

    function closeResults({ restore = true } = {}) {
      results.hidden = true;
      unified.setAttribute("aria-expanded", "false");
      menuButton.setAttribute("aria-expanded", "false");
      input.dataset.editing = "false";
      if (restore) syncSelectedLabel();
    }

    function renderResults({ forceOpen = false, ignoreQuery = false } = {}) {
      const rawQuery = ignoreQuery ? "" : String(input.value || "").trim().toLowerCase();
      const selectedRole = role.value;
      const filtered = entries().filter(({ option, roles }) => {
        const roleMatch = selectedRole === "ALL" || roles.has(selectedRole);
        const text = `${option.value} ${option.textContent || ""}`.toLowerCase();
        return roleMatch && (!rawQuery || text.includes(rawQuery));
      }).slice(0, 24);

      if (!forceOpen && !rawQuery && selectedRole === "ALL") {
        closeResults({ restore: false });
        return;
      }

      results.hidden = false;
      unified.setAttribute("aria-expanded", "true");
      menuButton.setAttribute("aria-expanded", "true");

      if (!filtered.length) {
        results.innerHTML = '<div class="v5-model-empty">NO MATCHING EXECUTABLE MODEL</div>';
        return;
      }

      results.innerHTML = filtered.map(({ option, roles }) => {
        const labels = [...roles].filter((item) => item !== "GENERAL").slice(0, 3);
        const active = option.value === modelSelect.value ? " active" : "";
        return `<button type="button" class="v5-model-result${active}" data-model="${escapeHtml(option.value)}">
          <span><strong>${escapeHtml(option.textContent || option.value)}</strong><small>${escapeHtml(option.value)}</small></span>
          <span class="v5-model-tags">${labels.map((item) => `<i class="v5-model-tag">${escapeHtml(MODEL_ROLES.find(([value]) => value === item)?.[1] || item)}</i>`).join("")}</span>
        </button>`;
      }).join("");
    }

    function commitModel(value) {
      const option = [...modelSelect.options].find((item) => item.value === value && !item.disabled);
      if (!option) return;
      modelSelect.value = value;
      modelSelect.dispatchEvent(new Event("change", { bubbles: true }));
      closeResults({ restore: true });
    }

    syncSelectedLabel();

    input.addEventListener("focus", () => {
      input.dataset.editing = "true";
      input.select();
      renderResults({ forceOpen: true, ignoreQuery: true });
    });
    input.addEventListener("input", () => {
      input.dataset.editing = "true";
      renderResults({ forceOpen: true });
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeResults({ restore: true });
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        renderResults({ forceOpen: true });
        results.querySelector("button[data-model]")?.focus();
      } else if (event.key === "Enter") {
        const first = results.querySelector("button[data-model]");
        if (first) {
          event.preventDefault();
          commitModel(first.dataset.model);
        }
      }
    });

    menuButton.addEventListener("click", () => {
      if (!results.hidden) {
        closeResults({ restore: true });
        return;
      }
      input.dataset.editing = "true";
      input.focus();
      input.select();
      renderResults({ forceOpen: true, ignoreQuery: true });
    });

    role.addEventListener("change", () => {
      input.dataset.editing = "true";
      input.focus();
      input.select();
      renderResults({ forceOpen: true, ignoreQuery: true });
    });

    results.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-model]");
      if (!button) return;
      commitModel(button.dataset.model);
    });

    results.addEventListener("keydown", (event) => {
      const button = event.target.closest("button[data-model]");
      if (!button) return;
      const items = [...results.querySelectorAll("button[data-model]")];
      const index = items.indexOf(button);
      if (event.key === "ArrowDown") {
        event.preventDefault();
        items[Math.min(items.length - 1, index + 1)]?.focus();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        if (index <= 0) input.focus();
        else items[index - 1]?.focus();
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        commitModel(button.dataset.model);
      } else if (event.key === "Escape") {
        event.preventDefault();
        input.focus();
        closeResults({ restore: true });
      }
    });

    modelSelect.addEventListener("change", () => {
      syncSelectedLabel();
      if (!results.hidden) renderResults({ forceOpen: true });
    });

    document.addEventListener("pointerdown", (event) => {
      if (!unified.contains(event.target) && event.target !== role) closeResults({ restore: true });
    });

    new MutationObserver(() => {
      syncSelectedLabel();
      if (!results.hidden) renderResults({ forceOpen: true });
    }).observe(modelSelect, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled", "selected"] });
  }

  function installHermesReadableSanitizer() {
    const transcript = document.getElementById("hermesTranscript");
    if (!transcript || transcript.dataset.tuiSanitizer === "1") return Boolean(transcript);
    transcript.dataset.tuiSanitizer = "1";

    const style = document.createElement("style");
    style.id = "hermesReadableSanitizerStyles";
    style.textContent = `
      #hermesTranscript .terminal-tui-hidden{display:none!important}
      #hermesTranscript .terminal-tui-meta{color:#46555f!important;font-size:9.5px!important;line-height:1.35!important;opacity:.82!important}
      #hermesTranscript .terminal-tui-meta.warning{color:#8d7651!important}
    `;
    document.head.appendChild(style);

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
  void ensureBackendPrimary();
})();