(() => {
  const STORAGE_KEY = "koordynator.liveChat.routerReceipt.v2";
  const PIN_KEY = "koordynator.liveChat.routerPinned.v1";
  const MAX_EVENTS = 80;
  const toolbar = document.querySelector(".v5-toolbar-left");
  const sendButton = document.getElementById("sendButton");
  const input = document.getElementById("messageInput");
  const thread = document.getElementById("chatThread");
  if (!toolbar || !sendButton || !input || !thread) return;

  const state = { receipt: loadReceipt(), open: false, pinned: loadPinned(), lastCapture: "", lastCaptureAt: 0 };
  function loadReceipt() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); } catch { return null; } }
  function saveReceipt() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.receipt)); } catch {} }
  function loadPinned() { try { return localStorage.getItem(PIN_KEY) === "1"; } catch { return false; } }
  function savePinned() { try { localStorage.setItem(PIN_KEY, state.pinned ? "1" : "0"); } catch {} }
  function nowClock() { return new Date().toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
  function esc(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }
  function clampProgress(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.max(0, Math.min(100, Math.round(number)));
  }
  function elapsedLabel(iso) {
    const started = Date.parse(String(iso || ""));
    if (!Number.isFinite(started)) return "0s";
    const seconds = Math.max(0, Math.floor((Date.now() - started) / 1000));
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ${seconds % 60}s`;
  }

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

  function captureRequest(text) {
    const clean = String(text || "").trim();
    if (!clean) return;
    const stamp = Date.now();
    if (state.lastCapture === clean && stamp - state.lastCaptureAt < 1200) return;
    state.lastCapture = clean;
    state.lastCaptureAt = stamp;
    state.receipt = {
      version: 2,
      createdAt: new Date().toISOString(),
      request: clean,
      phase: "routing",
      stage: "INTAKE",
      agent: "Koordynator",
      process: "Awaiting backend lifecycle",
      progress: 0,
      activity: "Request captured in Live Chat",
      model: null,
      skills: [],
      agentStates: [{ name: "Koordynator", state: "waiting" }],
      events: []
    };
    setPhase("routing");
    event("Request captured from Live Chat");
    event("Awaiting authoritative backend process events");
    saveReceipt();
    render();
  }

  function phaseForStage(stage) {
    const value = String(stage || "").toUpperCase();
    if (value === "DONE") return "done";
    if (value === "ERROR") return "error";
    if (value === "STOPPED") return "stopped";
    return "running";
  }

  function applyProcess(update) {
    if (!state.receipt || !update || typeof update !== "object") return;
    const previous = [state.receipt.stage, state.receipt.agent, state.receipt.activity].join("|");
    state.receipt.stage = String(update.stage || state.receipt.stage || "UNKNOWN");
    state.receipt.agent = String(update.agent || state.receipt.agent || "Koordynator");
    state.receipt.process = String(update.process || state.receipt.process || "Live Chat");
    state.receipt.progress = clampProgress(update.progress ?? state.receipt.progress);
    state.receipt.activity = String(update.activity || state.receipt.activity || "Active");
    state.receipt.model = update.model ? String(update.model) : state.receipt.model;
    if (Array.isArray(update.skills)) state.receipt.skills = update.skills.map((item) => String(item));
    const phase = phaseForStage(state.receipt.stage);
    state.receipt.agentStates = [{
      name: state.receipt.agent,
      state: phase === "done" ? "done" : phase === "error" ? "error" : phase === "stopped" ? "stopped" : "running"
    }];
    state.receipt.lastActivityAt = new Date().toISOString();
    setPhase(phase);
    const current = [state.receipt.stage, state.receipt.agent, state.receipt.activity].join("|");
    if (current !== previous) event(`${state.receipt.stage} · ${state.receipt.agent} · ${state.receipt.activity}`);
    saveReceipt();
    render();
  }

  function render() {
    if (!body) return;
    setPinned(state.pinned);
    if (!state.receipt) {
      body.innerHTML = '<div class="router-empty">Send a task in Live Chat. Routing Inspector will show only observed backend lifecycle events, active agent, stage and process progress.</div>';
      delete toggle.dataset.routerState;
      if (live) { live.className = "router-live"; live.querySelector("b").textContent = "IDLE"; }
      return;
    }
    const r = state.receipt;
    setPhase(r.phase || "idle");
    const progress = clampProgress(r.progress);
    const skillHtml = (r.skills || []).length
      ? r.skills.map((v) => `<span class="router-chip">✓ ${esc(v)}</span>`).join("")
      : '<span class="router-empty-inline">not selected</span>';
    const model = r.model ? `<span class="router-model">${esc(r.model)}</span>` : "";
    body.innerHTML = `
      <section class="router-section"><span class="router-label">REQUEST</span><p class="router-request">${esc(r.request)}</p></section>
      <section class="router-section router-live-section">
        <div class="router-process-head"><span class="router-label">LIVE PROCESS</span><span class="router-elapsed">${esc(elapsedLabel(r.createdAt))}</span></div>
        <div class="router-process-grid">
          <div class="router-process-card active"><span>AGENT</span><strong><i class="router-agent-pulse"></i>${esc(r.agent || "Koordynator")}</strong></div>
          <div class="router-process-card"><span>STAGE</span><strong>${esc(r.stage || "INTAKE")}</strong></div>
          <div class="router-process-card"><span>PROCESS</span><strong>${esc(r.process || "Awaiting backend")}</strong></div>
        </div>
        <div class="router-progress-row"><div class="router-progress-track"><i style="width:${progress}%"></i></div><strong class="router-progress-value">${progress}%</strong></div>
        <div class="router-activity"><span class="router-activity-dot"></span><strong>${esc(r.activity || "Waiting")}</strong>${model}</div>
      </section>
      <section class="router-section"><span class="router-label">SELECTED SKILL PLAN</span><div class="router-skills">${skillHtml}</div></section>
      <section class="router-section"><span class="router-label">AGENT ROUTE</span><div class="router-agent-list">${(r.agentStates || []).map((v) => `<div class="router-agent"><strong>${esc(v.name)}</strong><span class="${esc(v.state)}">${esc(String(v.state).toUpperCase())}</span></div>`).join("")}</div></section>
      <section class="router-section"><span class="router-label">EXECUTION EVENTS</span><div class="router-event-list">${(r.events || []).map((v) => `<div class="router-event"><time>${esc(v.at)}</time><strong>${esc(v.text)}</strong></div>`).join("")}</div></section>
      <div class="router-disclaimer">Progress is checkpoint progress from observable lifecycle events, not a guessed token/time estimate. Skills are shown only after an execution path actually selects them. The inspector does not expose private chain-of-thought.</div>`;
    body.scrollTop = body.scrollHeight;
  }

  function assistantLifecycle() {
    if (!state.receipt) return;
    const current = [...thread.querySelectorAll(".chat-message.assistant")].at(-1);
    if (!current) return;
    const status = current.querySelector(".message-state")?.textContent?.trim() || "";
    if (status === "Generation failed" && state.receipt.phase !== "error") {
      applyProcess({ stage: "ERROR", agent: "Koordynator", process: state.receipt.process, progress: state.receipt.progress, activity: "Assistant generation failed" });
    } else if (status === "Generation stopped" && state.receipt.phase !== "stopped") {
      applyProcess({ stage: "STOPPED", agent: "Koordynator", process: state.receipt.process, progress: state.receipt.progress, activity: "Generation stopped by operator" });
    }
  }

  function tickLive() {
    if (!state.receipt) return;
    const elapsed = drawer.querySelector(".router-elapsed");
    if (elapsed) elapsed.textContent = elapsedLabel(state.receipt.createdAt);
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
      try {
        await navigator.clipboard.writeText(JSON.stringify(state.receipt, null, 2));
        button.classList.add("router-copy-ok");
        const old = button.textContent;
        button.textContent = "Copied";
        setTimeout(() => { button.classList.remove("router-copy-ok"); button.textContent = old; }, 1200);
      } catch {}
    }
  });

  sendButton.addEventListener("click", () => captureRequest(input.value), true);
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) captureRequest(input.value);
  }, true);
  new MutationObserver(() => assistantLifecycle()).observe(thread, { childList: true, subtree: true, characterData: true });
  window.addEventListener("koordynator:routing-event", (ev) => {
    const detail = ev.detail || {};
    if (!state.receipt && detail.request) captureRequest(String(detail.request));
    if (!state.receipt) return;
    if (detail.stage || detail.agent || detail.process || detail.progress !== undefined || detail.activity) {
      applyProcess(detail);
      return;
    }
    if (detail.text) event(String(detail.text), String(detail.kind || "info"));
    if (detail.phase) setPhase(String(detail.phase));
    saveReceipt();
    render();
  });
  window.koordynatorRouterInspector = {
    open: () => setOpen(true),
    close: () => setOpen(false),
    capture: captureRequest,
    emit: (text, kind) => { event(text, kind); saveReceipt(); render(); },
    process: applyProcess,
    receipt: () => state.receipt
  };
  setInterval(tickLive, 1000);
  setPinned(state.pinned);
  render();
})();

/* Live app-level route telemetry and a readable Hermes mirror. */
(() => {
  const encoder = new TextEncoder();
  const NativeEventSource = window.EventSource;
  const nativeFetch = window.fetch.bind(window);
  const STALL_MS = 90_000;
  const ACTIVE_MS = 12_000;
  const MAX_READABLE_LINES = 320;
  const telemetry = {
    chat: { rx: 0, tx: 0, lastActivity: 0, connected: false, generating: false, error: false },
    hermes: { rx: 0, tx: 0, lastActivity: 0, startedAt: 0, sessionId: null, pid: null, alive: false, busySince: 0, error: false },
    sampled: { rx: 0, tx: 0, at: Date.now(), deltaRx: 0, deltaTx: 0 }
  };
  let readableRoot = null;
  let readableBuffer = "";
  let readableFlushTimer = null;
  let terminalToolbar = null;
  let terminalSummary = null;
  let currentMode = "raw";
  let lastReadableLine = "";
  let lastReadableAt = 0;
  let lastReadableKind = "";
  let lastReadableRow = null;
  const byteLength = (value) => encoder.encode(String(value ?? "")).byteLength;
  const now = () => Date.now();

  function pathOf(input) {
    try { return new URL(typeof input === "string" ? input : input?.url || String(input || ""), window.location.href).pathname; }
    catch { return ""; }
  }
  function snapshot() { return JSON.parse(JSON.stringify(telemetry)); }
  function emitTelemetry() { window.dispatchEvent(new CustomEvent("koordynator:runtime-telemetry", { detail: snapshot() })); }

  window.fetch = async function monitoredFetch(input, init) {
    const pathname = pathOf(input);
    const method = String(init?.method || (typeof Request !== "undefined" && input instanceof Request ? input.method : "GET") || "GET").toUpperCase();
    const outgoing = typeof init?.body === "string" ? byteLength(init.body) : 0;
    if (method === "POST" && /^\/api\/chat\/sessions\/[0-9a-f-]+\/messages$/i.test(pathname)) {
      telemetry.chat.tx += outgoing; telemetry.chat.generating = true; telemetry.chat.error = false; telemetry.chat.lastActivity = now(); emitTelemetry();
    }
    if (method === "POST" && /^\/api\/hermes\/pty\/[0-9a-f-]+\/input$/i.test(pathname)) {
      telemetry.hermes.tx += outgoing; telemetry.hermes.busySince = now(); telemetry.hermes.lastActivity = now(); telemetry.hermes.error = false; emitTelemetry();
    }
    const response = await nativeFetch(input, init);
    if (method === "POST" && pathname === "/api/hermes/pty" && response.ok) {
      response.clone().json().then((payload) => {
        telemetry.hermes.sessionId = payload?.sessionId || null;
        telemetry.hermes.pid = Number.isInteger(payload?.pid) ? payload.pid : null;
        telemetry.hermes.startedAt = now(); telemetry.hermes.lastActivity = now(); telemetry.hermes.alive = true; telemetry.hermes.busySince = 0; telemetry.hermes.error = false;
        resetReadable("Hermes uruchomiony. Odpowiedzi dla Ciebie są turkusowe, pytania wymagające reakcji bursztynowe. Pełny strumień jest w Raw PTY.");
        setMode("readable"); emitTelemetry();
      }).catch(() => undefined);
    }
    if (method === "POST" && /^\/api\/hermes\/pty\/[0-9a-f-]+\/stop$/i.test(pathname) && response.ok) {
      telemetry.hermes.alive = false; telemetry.hermes.busySince = 0; telemetry.hermes.lastActivity = now(); emitTelemetry();
    }
    if (method === "POST" && /^\/api\/chat\/sessions\/[0-9a-f-]+\/stop$/i.test(pathname) && response.ok) {
      telemetry.chat.generating = false; telemetry.chat.lastActivity = now(); emitTelemetry();
    }
    return response;
  };

  function stripAnsi(value) {
    return String(value || "").replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, "").replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "").replace(/\x1B[@-_]/g, "");
  }
  function compactLine(value) {
    return String(value || "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/^[│┃┆┊┌└├┤╭╰─━\s]+/, "").replace(/[│┃┆┊┌└├┤╭╰─━\s]+$/, "").replace(/\s{3,}/g, "  ").trim();
  }
  function isNoise(text) {
    return !text || /^[╭╰┌└├┤│┃─━\s]+$/.test(text) || /^(?:Window too small\.{0,3}|Plan a feature, then build it step by step)$/i.test(text) ||
      /^(?:Initializing agent|Welcome to Hermes Agent|Available Tools|Available Skills|Tip:)\b/i.test(text) || /(?:contemplating|processing|mulling|reflecting|preparing terminal)/i.test(text) ||
      /^(?:⚕\s*)?(?:❯\s*)?msg=interrupt\b/i.test(text) || (/\bctx\s+--\b/i.test(text) && /[│┤]/.test(text)) ||
      /^(?:The user (?:wants|asked|is asking|requested)|I (?:need to|should|will now)|We need to|Need to)\b/i.test(text) || /\bI have all the facts\. Reply in Polish\b/i.test(text);
  }
  function classify(text) {
    if (/\b(ERROR|FAIL(?:ED)?|DENIED|DENY|TIMEOUT|EXCEPTION|TRACEBACK|HARMONIA_HTTP_\d+|CHAT_UPSTREAM_\d+|WORKER_PROCESS_FAILED)\b/i.test(text)) return ["error", "BŁĄD"];
    if (/\b(ALLOW|PASS|COMPLETE|COMPLETED|SUCCESS|DONE)\b/i.test(text)) return ["success", "WYNIK"];
    if (/^(?:▶|❯|➜|\$|>)\s*/.test(text)) return ["command", "TY"];
    if (/\?\s*$/.test(text) || /^(?:czy|chcesz|mam|mogę|możesz|potwierdź|wybierz|do you|would you|should i|which|what|where|when|how)\b.*\?/i.test(text)) return ["question", "PYTANIE"];
    if (/^(?:\+\s*\d+\s+commands?|model fallback|authentication failed|npm |node |git |gh |cd |curl |npx |pid\b|exit\b)/i.test(text)) return ["meta", "SYSTEM"];
    return ["answer", "ODPOWIEDŹ"];
  }
  function addReadableLine(raw) {
    const text = compactLine(raw);
    if (isNoise(text)) return;
    const stamp = now();
    if (text === lastReadableLine && stamp - lastReadableAt < 900) return;
    lastReadableLine = text; lastReadableAt = stamp;
    mountTerminalUi(); if (!readableRoot) return;
    readableRoot.querySelector(".runtime-readable-empty")?.remove();
    const [kind, tag] = classify(text);
    const mergeable = kind === "answer" || kind === "question" || kind === "meta";
    if (mergeable && kind === lastReadableKind && lastReadableRow?.isConnected) {
      const body = lastReadableRow.querySelector(".runtime-line-text");
      if (body) body.textContent += `\n${text}`;
    } else {
      const row = document.createElement("div"); row.className = `runtime-line ${kind}`;
      const label = document.createElement("span"); label.className = "runtime-line-tag"; label.textContent = tag;
      const body = document.createElement("span"); body.className = "runtime-line-text"; body.textContent = text;
      row.append(label, body); readableRoot.appendChild(row); lastReadableRow = row; lastReadableKind = kind;
    }
    while (readableRoot.children.length > MAX_READABLE_LINES) readableRoot.firstElementChild?.remove();
    if (readableRoot.scrollHeight - readableRoot.scrollTop - readableRoot.clientHeight < 160 || kind === "question") readableRoot.scrollTop = readableRoot.scrollHeight;
  }
  function flushReadableBuffer() { const pending = compactLine(readableBuffer); readableBuffer = ""; if (pending) addReadableLine(pending); }
  function ingestHermesOutput(text) {
    const clean = stripAnsi(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    readableBuffer += clean;
    const lines = readableBuffer.split("\n"); readableBuffer = lines.pop() || "";
    for (const line of lines) addReadableLine(line);
    clearTimeout(readableFlushTimer); readableFlushTimer = setTimeout(flushReadableBuffer, 450);
    if (/[❯➜$]\s*$/.test(clean.trim())) telemetry.hermes.busySince = 0;
  }
  function resetReadable(message) {
    mountTerminalUi(); if (!readableRoot) return;
    readableRoot.innerHTML = ""; readableBuffer = ""; lastReadableLine = ""; lastReadableKind = ""; lastReadableRow = null;
    const empty = document.createElement("div"); empty.className = "runtime-readable-empty"; empty.textContent = message || "Czekam na wyjście Hermesa…"; readableRoot.appendChild(empty);
  }

  function handleSse(kind, event) {
    const bytes = byteLength(event.data);
    let payload = null; try { payload = JSON.parse(event.data); } catch {}
    if (kind === "chat") {
      telemetry.chat.rx += bytes; telemetry.chat.lastActivity = now(); telemetry.chat.connected = true;
      if (payload?.type === "assistant_start") telemetry.chat.generating = true;
      if (payload?.type === "assistant_done" || payload?.type === "stopped") telemetry.chat.generating = false;
      if (payload?.type === "error") { telemetry.chat.generating = false; telemetry.chat.error = true; }
    } else {
      telemetry.hermes.rx += bytes; telemetry.hermes.lastActivity = now(); telemetry.hermes.alive = true;
      if (payload?.type === "out" && typeof payload.text === "string") ingestHermesOutput(payload.text);
      if (payload?.type === "exit") { telemetry.hermes.alive = false; telemetry.hermes.busySince = 0; addReadableLine(`Hermes zakończył proces (exit ${payload.code ?? "?"}).`); }
    }
    emitTelemetry();
  }

  if (typeof NativeEventSource === "function") {
    function MonitoredEventSource(url, options) {
      const source = new NativeEventSource(url, options);
      const pathname = pathOf(url);
      const kind = /^\/api\/hermes\/pty\/[0-9a-f-]+\/events$/i.test(pathname) ? "hermes" : /^\/api\/chat\/sessions\/[0-9a-f-]+\/events$/i.test(pathname) ? "chat" : null;
      if (kind) {
        source.addEventListener("open", () => { if (kind === "chat") telemetry.chat.connected = true; else telemetry.hermes.alive = true; emitTelemetry(); });
        source.addEventListener("message", (event) => handleSse(kind, event));
        source.addEventListener("error", () => {
          if (kind === "chat" && source.readyState === NativeEventSource.CLOSED) telemetry.chat.connected = false;
          if (kind === "hermes" && source.readyState === NativeEventSource.CLOSED) telemetry.hermes.error = true;
          emitTelemetry();
        });
      }
      return source;
    }
    MonitoredEventSource.prototype = NativeEventSource.prototype;
    Object.setPrototypeOf(MonitoredEventSource, NativeEventSource);
    MonitoredEventSource.CONNECTING = NativeEventSource.CONNECTING; MonitoredEventSource.OPEN = NativeEventSource.OPEN; MonitoredEventSource.CLOSED = NativeEventSource.CLOSED;
    window.EventSource = MonitoredEventSource;
  }

  function formatBytes(bytes) {
    const value = Math.max(0, Number(bytes) || 0);
    if (value < 1024) return `${Math.round(value)} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`;
    return `${(value / (1024 * 1024)).toFixed(value < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  }
  function ageLabel(timestamp) {
    if (!timestamp) return "n/a";
    const seconds = Math.max(0, Math.floor((now() - timestamp) / 1000));
    if (seconds < 2) return "teraz"; if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60); if (minutes < 60) return `${minutes}m`; return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  }
  function chatStatus() {
    if (telemetry.chat.error) return ["ERROR", "error"];
    if (telemetry.chat.generating && telemetry.chat.lastActivity && now() - telemetry.chat.lastActivity > STALL_MS) return ["STALLED", "stalled"];
    if (telemetry.chat.generating) return ["RUNNING", "running"];
    if (telemetry.chat.connected) return ["ALIVE", "alive"];
    return ["OFFLINE", "dead"];
  }
  function hermesStatus() {
    if (telemetry.hermes.error && !telemetry.hermes.alive) return ["ERROR", "error"];
    if (!telemetry.hermes.alive) return ["OFF", "dead"];
    if (telemetry.hermes.busySince && telemetry.hermes.lastActivity && now() - telemetry.hermes.lastActivity > STALL_MS) return ["STALLED", "stalled"];
    if (telemetry.hermes.lastActivity && now() - telemetry.hermes.lastActivity < ACTIVE_MS) return ["RUNNING", "running"];
    return ["ALIVE", "alive"];
  }

  function setMode(mode) {
    currentMode = mode === "raw" ? "raw" : "readable"; mountTerminalUi();
    const raw = document.getElementById("hermesTerm");
    const readableButton = terminalToolbar?.querySelector('[data-runtime-mode="readable"]');
    const rawButton = terminalToolbar?.querySelector('[data-runtime-mode="raw"]');
    readableRoot?.classList.toggle("active", currentMode === "readable"); raw?.classList.toggle("runtime-raw-hidden", currentMode !== "raw");
    readableButton?.classList.toggle("active", currentMode === "readable"); rawButton?.classList.toggle("active", currentMode === "raw");
    readableButton?.setAttribute("aria-pressed", String(currentMode === "readable")); rawButton?.setAttribute("aria-pressed", String(currentMode === "raw"));
    if (currentMode === "raw") requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
  }
  function mountTerminalUi() {
    const pane = document.getElementById("hermesPane"); const raw = document.getElementById("hermesTerm"); const header = pane?.querySelector(".v5-terminal-head");
    if (!pane || !raw || !header) return false;
    pane.classList.add("runtime-monitor-installed");
    if (!readableRoot) {
      readableRoot = document.createElement("div"); readableRoot.id = "hermesReadableRuntime"; readableRoot.className = "runtime-readable";
      readableRoot.setAttribute("role", "log"); readableRoot.setAttribute("aria-live", "polite"); readableRoot.innerHTML = '<div class="runtime-readable-empty">Czekam na wyjście Hermesa…</div>'; raw.before(readableRoot);
    }
    if (!terminalToolbar) {
      terminalToolbar = document.createElement("div"); terminalToolbar.className = "runtime-terminal-toolbar";
      terminalToolbar.innerHTML = '<button class="runtime-terminal-button" data-runtime-mode="readable" type="button" aria-pressed="false">Readable</button><button class="runtime-terminal-button active" data-runtime-mode="raw" type="button" aria-pressed="true">Raw PTY</button><span class="runtime-terminal-spacer"></span><span class="runtime-terminal-summary dead" id="runtimeTerminalSummary"><i class="runtime-terminal-heartbeat"></i><strong>OFF</strong><span>RX 0 B · TX 0 B</span></span><button class="runtime-terminal-button" data-runtime-action="expand" type="button">Expand</button><button class="runtime-terminal-button" data-runtime-action="copy" type="button">Copy</button>';
      readableRoot.before(terminalToolbar); terminalSummary = terminalToolbar.querySelector("#runtimeTerminalSummary");
      terminalToolbar.addEventListener("click", async (event) => {
        const button = event.target.closest("button"); if (!button) return;
        if (button.dataset.runtimeMode) setMode(button.dataset.runtimeMode);
        if (button.dataset.runtimeAction === "expand") { pane.classList.toggle("runtime-expanded"); button.textContent = pane.classList.contains("runtime-expanded") ? "Collapse" : "Expand"; requestAnimationFrame(() => window.dispatchEvent(new Event("resize"))); }
        if (button.dataset.runtimeAction === "copy") {
          try {
            let text = "";
            if (currentMode === "raw") {
              text = window.koordynatorHermesTerminal?.getSelection?.() || "";
              if (!text) {
                button.textContent = "Select text first";
                setTimeout(() => { button.textContent = "Copy"; }, 1200);
                return;
              }
            } else {
              const selection = window.getSelection();
              const selected = selection && selection.anchorNode && readableRoot?.contains(selection.anchorNode)
                ? selection.toString().trim()
                : "";
              text = selected || readableRoot?.innerText || "";
            }
            await navigator.clipboard.writeText(text);
            const old = button.textContent;
            button.textContent = "Copied";
            setTimeout(() => { button.textContent = old; }, 1000);
          } catch {
            button.textContent = "Copy failed";
            setTimeout(() => { button.textContent = "Copy"; }, 1200);
          }
        }
      });
    }
    return true;
  }
  function mountRouterMonitor() {
    const headCopy = document.querySelector("#routerInspectorDrawer .router-head-copy"); if (!headCopy) return false;
    if (document.getElementById("routerRuntimeStrip")) return true;
    const strip = document.createElement("div"); strip.id = "routerRuntimeStrip"; strip.className = "router-runtime-strip";
    strip.innerHTML = '<span class="router-runtime-pill dead" id="runtimeChatProcess"><i class="router-runtime-dot"></i>CHAT <strong>OFFLINE</strong></span><span class="router-runtime-pill dead" id="runtimeHermesProcess"><i class="router-runtime-dot"></i>HERMES <strong>OFF</strong></span><span class="router-runtime-pill router-runtime-bytes" id="runtimeBytes">RX 0 B · TX 0 B</span><span class="router-runtime-pill router-runtime-delta" id="runtimeDelta">Δ 0 B/s · 0 B/s</span><span class="router-runtime-pill" id="runtimeLastActivity">last n/a</span>';
    headCopy.appendChild(strip); return true;
  }
  function updateUi() {
    mountTerminalUi(); mountRouterMonitor();
    const totalRx = telemetry.chat.rx + telemetry.hermes.rx; const totalTx = telemetry.chat.tx + telemetry.hermes.tx;
    const [cStatus, cClass] = chatStatus(); const [hStatus, hClass] = hermesStatus(); const latest = Math.max(telemetry.chat.lastActivity || 0, telemetry.hermes.lastActivity || 0);
    const chatPill = document.getElementById("runtimeChatProcess"); const hermesPill = document.getElementById("runtimeHermesProcess"); const bytesPill = document.getElementById("runtimeBytes"); const deltaPill = document.getElementById("runtimeDelta"); const activityPill = document.getElementById("runtimeLastActivity");
    if (chatPill) { chatPill.className = `router-runtime-pill ${cClass}`; chatPill.querySelector("strong").textContent = cStatus; chatPill.title = `Chat activity: ${ageLabel(telemetry.chat.lastActivity)}`; }
    if (hermesPill) { hermesPill.className = `router-runtime-pill ${hClass}`; hermesPill.querySelector("strong").textContent = hStatus; hermesPill.title = `Hermes ${hStatus}${telemetry.hermes.pid ? ` · PID ${telemetry.hermes.pid}` : " · PID N/A"} · activity ${ageLabel(telemetry.hermes.lastActivity)}`; }
    if (bytesPill) bytesPill.textContent = `RX ${formatBytes(totalRx)} · TX ${formatBytes(totalTx)}`;
    if (deltaPill) deltaPill.textContent = `Δ ${formatBytes(telemetry.sampled.deltaRx)}/s · ${formatBytes(telemetry.sampled.deltaTx)}/s`;
    if (activityPill) activityPill.textContent = `last ${ageLabel(latest)}`;
    if (terminalSummary) {
      terminalSummary.className = `runtime-terminal-summary ${hClass}`; terminalSummary.querySelector("strong").textContent = hStatus;
      terminalSummary.querySelector("span").textContent = `RX ${formatBytes(telemetry.hermes.rx)} · TX ${formatBytes(telemetry.hermes.tx)} · ${ageLabel(telemetry.hermes.lastActivity)}`;
      terminalSummary.title = telemetry.hermes.pid ? `PID ${telemetry.hermes.pid}` : "PID unavailable in current PTY API";
    }
  }
  function sample() {
    const stamp = now(); const totalRx = telemetry.chat.rx + telemetry.hermes.rx; const totalTx = telemetry.chat.tx + telemetry.hermes.tx; const elapsed = Math.max(1, (stamp - telemetry.sampled.at) / 1000);
    telemetry.sampled.deltaRx = Math.max(0, Math.round((totalRx - telemetry.sampled.rx) / elapsed)); telemetry.sampled.deltaTx = Math.max(0, Math.round((totalTx - telemetry.sampled.tx) / elapsed));
    telemetry.sampled.rx = totalRx; telemetry.sampled.tx = totalTx; telemetry.sampled.at = stamp; updateUi(); emitTelemetry();
  }
  new MutationObserver(() => { mountTerminalUi(); mountRouterMonitor(); }).observe(document.documentElement, { childList: true, subtree: true });
  window.koordynatorRuntimeTelemetry = { snapshot, resetReadable, setMode };
  mountTerminalUi(); updateUi(); setInterval(sample, 1000);
})();
