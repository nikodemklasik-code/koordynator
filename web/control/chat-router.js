(() => {
  const STORAGE_KEY = "koordynator.liveChat.routerReceipt.v1";
  const PIN_KEY = "koordynator.liveChat.routerPinned.v1";
  const MAX_EVENTS = 80;
  const toolbar = document.querySelector(".v5-toolbar-left");
  const sendButton = document.getElementById("sendButton");
  const input = document.getElementById("messageInput");
  const thread = document.getElementById("chatThread");
  if (!toolbar || !sendButton || !input || !thread) return;

  const rules = [
    { id: "research", label: "Research", agent: "Researcher", skills: ["research", "source-search", "repository-search"], re: /\b(znajd|wyszuk|poszuk|sprawd[zź].*źród|research|find|search|investigat|discover|lookup)\w*/i },
    { id: "decomposition", label: "Decomposition", agent: "Planner", skills: ["decomposition", "planning", "scope-map"], re: /(podziel|rozbij|mniejsze element|etap(?:y|ów)?|plan(?:uj|owanie)?|decompos|break down|split into|milestone)/i },
    { id: "repo", label: "Repository", agent: "Repository", skills: ["repository", "git", "github"], re: /(repo(?:zytorium)?|github|branch|commit|pull request|\bPR\b|git\b)/i },
    { id: "implementation", label: "Implementation", agent: "Developer", skills: ["coding", "implementation", "terminal"], re: /(dopisz|napisz|kod|implement|napraw|fix|refactor|typescript|javascript|python|builder|build\b)/i },
    { id: "frontend", label: "Frontend", agent: "Frontend Developer", skills: ["frontend", "ui", "browser"], re: /(frontend|interfejs|\bui\b|css|html|layout|ekran|button|przycisk|responsive|playwright|browser)/i },
    { id: "security", label: "Security", agent: "Security", skills: ["security", "dependency-audit", "threat-check"], re: /(security|bezpiecze|podatno|vulnerab|audit|npm audit|secret|credential|auth)/i },
    { id: "testing", label: "Verification", agent: "QC", skills: ["tests", "verification", "regression"], re: /(test|zweryfik|sprawdź wynik|verify|regression|\bqc\b|acceptance)/i },
    { id: "files", label: "Files", agent: "File Worker", skills: ["files", "archive", "document-read"], re: /(plik|zip|pdf|docx|xlsx|folder|katalog|file|archive)/i },
    { id: "innovation", label: "Innovation", agent: "Innovation Developer", skills: ["innovation", "architecture", "design"], re: /(innowac|zaprojekt|architekt|architecture|design|prototype|nowy mechanizm)/i }
  ];

  const state = {
    receipt: loadReceipt(),
    open: false,
    pinned: loadPinned(),
    lastCapture: "",
    lastCaptureAt: 0
  };

  function loadReceipt() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); } catch { return null; }
  }
  function saveReceipt() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.receipt)); } catch { /* private mode */ }
  }
  function loadPinned() {
    try { return localStorage.getItem(PIN_KEY) === "1"; } catch { return false; }
  }
  function savePinned() {
    try { localStorage.setItem(PIN_KEY, state.pinned ? "1" : "0"); } catch { /* private mode */ }
  }
  function nowClock() {
    return new Date().toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }
  function esc(value) {
    return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  }
  function uniq(values) { return [...new Set(values)]; }

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.id = "routerInspectorButton";
  toggle.className = "v5-action router-toggle";
  toggle.innerHTML = '<span class="router-led" aria-hidden="true"></span>Routing';
  toggle.setAttribute("aria-controls", "routerInspectorDrawer");
  toggle.setAttribute("aria-expanded", "false");
  const hermesButton = document.getElementById("muteHermesButton");
  toolbar.insertBefore(toggle, hermesButton || null);

  const backdrop = document.createElement("div");
  backdrop.className = "router-backdrop";
  backdrop.id = "routerInspectorBackdrop";
  const drawer = document.createElement("aside");
  drawer.className = "router-drawer";
  drawer.id = "routerInspectorDrawer";
  drawer.setAttribute("aria-label", "Coordinator routing inspector");
  drawer.innerHTML = `
    <header class="router-head">
      <div class="router-head-copy">
        <span class="router-kicker">COORDINATOR ROUTER</span>
        <div class="router-title-row"><h2>Routing inspector</h2><span id="routerLive" class="router-live"><i></i><b>IDLE</b></span></div>
      </div>
      <div class="router-actions">
        <button class="router-action" data-action="pin" type="button">Pin</button>
        <button class="router-action" data-action="copy" type="button">Copy receipt</button>
        <button class="router-action" data-action="clear" type="button">Clear</button>
        <button class="router-action" data-action="close" type="button" aria-label="Close routing inspector">×</button>
      </div>
    </header>
    <div class="router-body" id="routerInspectorBody"></div>`;
  document.body.append(backdrop, drawer);
  const body = drawer.querySelector("#routerInspectorBody");
  const live = drawer.querySelector("#routerLive");

  function setOpen(open) {
    state.open = Boolean(open);
    drawer.classList.toggle("open", state.open);
    backdrop.classList.toggle("open", state.open && !state.pinned);
    toggle.setAttribute("aria-expanded", state.open ? "true" : "false");
  }
  function setPinned(pinned) {
    state.pinned = Boolean(pinned);
    drawer.classList.toggle("pinned", state.pinned);
    const button = drawer.querySelector('[data-action="pin"]');
    button?.classList.toggle("active", state.pinned);
    if (button) button.textContent = state.pinned ? "Pinned" : "Pin";
    backdrop.classList.toggle("open", state.open && !state.pinned);
    savePinned();
  }
  function event(text, kind = "info") {
    if (!state.receipt) return;
    state.receipt.events ||= [];
    state.receipt.events.push({ at: nowClock(), text, kind });
    if (state.receipt.events.length > MAX_EVENTS) state.receipt.events.splice(0, state.receipt.events.length - MAX_EVENTS);
    saveReceipt();
  }
  function setPhase(phase) {
    if (!state.receipt) return;
    state.receipt.phase = phase;
    if (phase === "routing" || phase === "running") toggle.dataset.routerState = "routing";
    else if (phase === "done") toggle.dataset.routerState = "done";
    else if (phase === "error") toggle.dataset.routerState = "error";
    else delete toggle.dataset.routerState;
    if (live) {
      live.className = `router-live ${phase === "running" ? "routing" : phase}`;
      const label = live.querySelector("b");
      if (label) label.textContent = ({ routing: "ROUTING", running: "RUNNING", done: "DONE", error: "ERROR", stopped: "STOPPED" })[phase] || "IDLE";
    }
  }

  function analyse(text) {
    const matches = rules.filter((rule) => rule.re.test(text));
    if (!matches.length) matches.push({ id: "general", label: "General", agent: "General AI", skills: ["general-reasoning"], re: /.*/ });
    const skills = uniq(matches.flatMap((rule) => rule.skills));
    if (matches.some((rule) => rule.id === "implementation")) skills.push(...["tests", "verification"]);
    const agents = uniq(matches.map((rule) => rule.agent));
    if (matches.some((rule) => rule.id === "implementation") && !agents.includes("QC")) agents.push("QC");
    const signalRows = matches.map((rule) => {
      const found = String(text).match(rule.re)?.[0] || rule.label;
      return { signal: found.slice(0, 54), route: rule.label };
    });
    return { intents: matches.map((rule) => rule.label), skills: uniq(skills), agents, signals: signalRows };
  }

  function captureRequest(text) {
    const clean = String(text || "").trim();
    if (!clean) return;
    const stamp = Date.now();
    if (state.lastCapture === clean && stamp - state.lastCaptureAt < 1200) return;
    state.lastCapture = clean;
    state.lastCaptureAt = stamp;
    const route = analyse(clean);
    state.receipt = {
      version: 1,
      createdAt: new Date().toISOString(),
      request: clean,
      phase: "routing",
      ...route,
      agentStates: route.agents.map((name, index) => ({ name, state: index === 0 ? "running" : "waiting" })),
      events: []
    };
    setPhase("routing");
    event("Request captured from Live Chat");
    event(`Intent routing: ${route.intents.join(" · ")}`);
    event(`Skills selected: ${route.skills.join(", ")}`);
    setPhase("running");
    event(`${route.agents[0]} started`);
    saveReceipt();
    render();
  }

  function advanceAgents(finalState) {
    if (!state.receipt?.agentStates?.length) return;
    if (finalState === "done") {
      for (const agent of state.receipt.agentStates) agent.state = "done";
    } else if (finalState === "error") {
      const running = state.receipt.agentStates.find((agent) => agent.state === "running") || state.receipt.agentStates[0];
      running.state = "error";
    } else if (finalState === "stopped") {
      const running = state.receipt.agentStates.find((agent) => agent.state === "running");
      if (running) running.state = "stopped";
    }
  }

  function render() {
    if (!body) return;
    setPinned(state.pinned);
    if (!state.receipt) {
      body.innerHTML = '<div class="router-empty">Send a task in Live Chat. Routing Inspector will record the request, detected intent, required skill set and execution lifecycle here.</div>';
      delete toggle.dataset.routerState;
      if (live) { live.className = "router-live"; live.querySelector("b").textContent = "IDLE"; }
      return;
    }
    const r = state.receipt;
    setPhase(r.phase || "idle");
    body.innerHTML = `
      <section class="router-section"><span class="router-label">REQUEST</span><p class="router-request">${esc(r.request)}</p></section>
      <section class="router-section"><span class="router-label">UNDERSTANDING</span><div class="router-intents">${(r.intents || []).map((v) => `<span class="router-chip">${esc(v)}</span>`).join("")}</div></section>
      <section class="router-section"><span class="router-label">DETECTED SIGNALS</span><div class="router-signal-list">${(r.signals || []).map((v) => `<div class="router-signal"><code>${esc(v.signal)}</code><span>→</span><strong>${esc(v.route)}</strong></div>`).join("")}</div></section>
      <section class="router-section"><span class="router-label">SELECTED SKILL PLAN</span><div class="router-skills">${(r.skills || []).map((v) => `<span class="router-chip">✓ ${esc(v)}</span>`).join("")}</div></section>
      <section class="router-section"><span class="router-label">AGENT ROUTE</span><div class="router-agent-list">${(r.agentStates || []).map((v) => `<div class="router-agent"><strong>${esc(v.name)}</strong><span class="${esc(v.state)}">${esc(String(v.state).toUpperCase())}</span></div>`).join("")}</div></section>
      <section class="router-section"><span class="router-label">EXECUTION EVENTS</span><div class="router-event-list">${(r.events || []).map((v) => `<div class="router-event"><time>${esc(v.at)}</time><strong>${esc(v.text)}</strong></div>`).join("")}</div></section>
      <div class="router-disclaimer">Inspector receipt shows observable routing decisions and execution lifecycle. It does not expose private model chain-of-thought. “Selected skill plan” is the capability route requested by Koordynator; actual tool execution is evidenced separately by chat/Hermes/task receipts.</div>`;
    body.scrollTop = body.scrollHeight;
  }

  function assistantLifecycle() {
    if (!state.receipt) return;
    const assistants = [...thread.querySelectorAll(".chat-message.assistant")];
    const current = assistants.at(-1);
    if (!current) return;
    const status = current.querySelector(".message-state")?.textContent?.trim() || "";
    const bubble = current.querySelector(".message-bubble")?.textContent || "";
    if (status === "Generation failed") {
      if (state.receipt.phase !== "error") { advanceAgents("error"); setPhase("error"); event("Assistant generation failed", "error"); saveReceipt(); render(); }
      return;
    }
    if (status === "Generation stopped") {
      if (state.receipt.phase !== "stopped") { advanceAgents("stopped"); setPhase("stopped"); event("Generation stopped by operator"); saveReceipt(); render(); }
      return;
    }
    if (bubble && state.receipt.phase === "running") {
      const hasStreamingMarker = current.querySelector(".message-bubble .streaming-cursor") || document.getElementById("statusText")?.textContent === "Generating";
      if (!hasStreamingMarker && document.getElementById("statusText")?.textContent === "Connected") {
        advanceAgents("done");
        setPhase("done");
        event("Assistant turn completed");
        saveReceipt();
        render();
      }
    }
  }

  toggle.addEventListener("click", () => setOpen(!state.open));
  backdrop.addEventListener("click", () => { if (!state.pinned) setOpen(false); });
  drawer.addEventListener("click", async (ev) => {
    const button = ev.target.closest("button[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    if (action === "close") setOpen(false);
    if (action === "pin") setPinned(!state.pinned);
    if (action === "clear") { state.receipt = null; try { localStorage.removeItem(STORAGE_KEY); } catch {} render(); }
    if (action === "copy" && state.receipt) {
      const text = JSON.stringify(state.receipt, null, 2);
      try {
        await navigator.clipboard.writeText(text);
        button.classList.add("router-copy-ok");
        const old = button.textContent; button.textContent = "Copied";
        setTimeout(() => { button.classList.remove("router-copy-ok"); button.textContent = old; }, 1200);
      } catch { /* clipboard unavailable */ }
    }
  });

  sendButton.addEventListener("click", () => captureRequest(input.value), true);
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) captureRequest(input.value);
  }, true);

  const observer = new MutationObserver(() => assistantLifecycle());
  observer.observe(thread, { childList: true, subtree: true, characterData: true });

  window.addEventListener("koordynator:routing-event", (ev) => {
    const detail = ev.detail || {};
    if (!state.receipt) return;
    if (detail.text) event(String(detail.text), String(detail.kind || "info"));
    if (detail.phase) setPhase(String(detail.phase));
    saveReceipt(); render();
  });

  window.koordynatorRouterInspector = {
    open: () => setOpen(true), close: () => setOpen(false), capture: captureRequest,
    emit: (text, kind) => { event(text, kind); saveReceipt(); render(); },
    receipt: () => state.receipt
  };

  setPinned(state.pinned);
  render();
})();