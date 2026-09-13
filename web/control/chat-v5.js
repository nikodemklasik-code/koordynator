(() => {
  const root = document.documentElement;
  const splitter = document.getElementById("workspaceSplitter");
  const workspace = document.getElementById("chatWorkspace");
  const modelSelect = document.getElementById("modelSelect");
  const primaryLabel = document.getElementById("primaryRouteLabel");
  const fallbackLabel = document.getElementById("fallbackRoutesLabel");
  const STORAGE_WIDTH = "koordynator.liveChat.v5.terminalWidth.final";
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
    if (document.getElementById("v5ModelExplorerStyles")) return;
    const style = document.createElement("style");
    style.id = "v5ModelExplorerStyles";
    style.textContent = `
      .v5-model-explorer{position:relative;display:flex;align-items:center;gap:6px;min-width:0}
      .v5-model-search{width:190px;height:40px;padding:0 10px;border:1px solid #27333d;border-radius:9px;background:#0b1116;color:#d9e2e8;font-size:12px;outline:none}
      .v5-model-search:focus{border-color:#44779a;box-shadow:0 0 0 3px rgba(77,139,181,.10)}
      .v5-model-role{height:40px;max-width:150px;padding:0 8px;border:1px solid #27333d;border-radius:9px;background:#0b1116;color:#9fb0bb;font-size:11px;outline:none}
      .v5-model-results{position:absolute;z-index:180;left:0;bottom:46px;width:min(620px,70vw);max-height:340px;overflow:auto;padding:6px;border:1px solid #2b3944;border-radius:12px;background:#090e13;box-shadow:0 24px 70px rgba(0,0,0,.62)}
      .v5-model-results[hidden]{display:none}
      .v5-model-result{width:100%;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;padding:8px 9px;border:0;border-radius:8px;background:transparent;color:#dce5eb;text-align:left;cursor:pointer}
      .v5-model-result:hover,.v5-model-result.active{background:#111b23}
      .v5-model-result strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:600 12px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace}
      .v5-model-result small{display:block;margin-top:3px;color:#687986;font-size:10px}
      .v5-model-tags{display:flex;gap:3px;justify-content:flex-end;flex-wrap:wrap;max-width:210px}
      .v5-model-tag{padding:2px 5px;border:1px solid #263844;border-radius:999px;color:#7194aa;font-size:8px;letter-spacing:.04em;text-transform:uppercase;white-space:nowrap}
      .v5-model-empty{padding:14px;color:#6f7e89;font-size:11px;text-align:center}
      @media (max-width:980px){.v5-model-search{width:130px}.v5-model-role{max-width:110px}.v5-model-results{width:min(520px,88vw)}}
      @media (max-width:720px){.v5-model-explorer{width:100%}.v5-model-search{flex:1;width:auto}.v5-model-role{max-width:140px}}
    `;
    document.head.appendChild(style);
  }

  function ensureModelExplorer() {
    if (!modelSelect || document.getElementById("modelSearchInput")) return;
    ensureExplorerStyles();
    const picker = modelSelect.closest(".v5-model-picker") || modelSelect.parentElement;
    const actions = modelSelect.closest(".v5-composer-actions") || picker?.parentElement;
    if (!picker || !actions) return;

    const explorer = document.createElement("div");
    explorer.className = "v5-model-explorer";
    explorer.innerHTML = `
      <input id="modelSearchInput" class="v5-model-search" type="search" autocomplete="off" spellcheck="false" placeholder="Search model…" aria-label="Search AI model" />
      <select id="modelRoleFilter" class="v5-model-role" aria-label="Model role category">
        ${MODEL_ROLES.map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}
      </select>
      <div id="modelSearchResults" class="v5-model-results" role="listbox" hidden></div>`;
    actions.insertBefore(explorer, picker);

    const input = explorer.querySelector("#modelSearchInput");
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
    input.addEventListener("focus", () => renderResults(Boolean(input.value || role.value !== "ALL")));
    role.addEventListener("change", () => renderResults(true));
    results.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-model]");
      if (!button) return;
      const value = button.dataset.model;
      const option = [...modelSelect.options].find((item) => item.value === value && !item.disabled);
      if (!option) return;
      modelSelect.value = value;
      modelSelect.dispatchEvent(new Event("change", { bubbles: true }));
      input.value = "";
      results.hidden = true;
    });
    document.addEventListener("pointerdown", (event) => {
      if (!explorer.contains(event.target)) results.hidden = true;
    });
    new MutationObserver(() => {
      if (!results.hidden) renderResults(true);
    }).observe(modelSelect, { childList: true, subtree: true });
  }

  function installHermesReadableSanitizer() {
    const transcript = document.getElementById("hermesTranscript");
    if (!transcript || transcript.dataset.tuiSanitizer === "1") return Boolean(transcript);
    transcript.dataset.tuiSanitizer = "1";

    const style = document.createElement("style");
    style.id = "hermesReadableSanitizerStyles";
    style.textContent = `
      #hermesTranscript .terminal-tui-hidden{display:none!important}
      #hermesTranscript .terminal-tui-meta{color:#46555f!important;font-size:7.5px!important;line-height:1.35!important;opacity:.82!important}
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