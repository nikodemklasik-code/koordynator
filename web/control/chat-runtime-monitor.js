(() => {
  const encoder = new TextEncoder();
  const NativeEventSource = window.EventSource;
  const nativeFetch = window.fetch.bind(window);
  const STALL_MS = 90_000;
  const ACTIVE_MS = 12_000;
  const MAX_READABLE_LINES = 500;

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

  const byteLength = (value) => encoder.encode(String(value ?? "")).byteLength;
  const now = () => Date.now();

  function pathOf(input) {
    try {
      const raw = typeof input === "string" ? input : input?.url || String(input || "");
      return new URL(raw, window.location.href).pathname;
    } catch { return ""; }
  }

  function requestBodyBytes(init) {
    const body = init?.body;
    return typeof body === "string" ? byteLength(body) : 0;
  }

  function snapshot() {
    return JSON.parse(JSON.stringify(telemetry));
  }

  function emitTelemetry() {
    window.dispatchEvent(new CustomEvent("koordynator:runtime-telemetry", { detail: snapshot() }));
  }

  window.fetch = async function monitoredFetch(input, init) {
    const pathname = pathOf(input);
    const method = String(init?.method || (typeof Request !== "undefined" && input instanceof Request ? input.method : "GET") || "GET").toUpperCase();
    const outgoing = requestBodyBytes(init);

    if (method === "POST" && /^\/api\/chat\/sessions\/[0-9a-f-]+\/messages$/i.test(pathname)) {
      telemetry.chat.tx += outgoing;
      telemetry.chat.generating = true;
      telemetry.chat.error = false;
      telemetry.chat.lastActivity = now();
      emitTelemetry();
    }
    if (method === "POST" && /^\/api\/hermes\/pty\/[0-9a-f-]+\/input$/i.test(pathname)) {
      telemetry.hermes.tx += outgoing;
      telemetry.hermes.busySince = now();
      telemetry.hermes.lastActivity = now();
      telemetry.hermes.error = false;
      emitTelemetry();
    }

    const response = await nativeFetch(input, init);

    if (method === "POST" && pathname === "/api/hermes/pty" && response.ok) {
      response.clone().json().then((payload) => {
        telemetry.hermes.sessionId = payload?.sessionId || null;
        telemetry.hermes.pid = Number.isInteger(payload?.pid) ? payload.pid : null;
        telemetry.hermes.startedAt = now();
        telemetry.hermes.lastActivity = now();
        telemetry.hermes.alive = true;
        telemetry.hermes.busySince = 0;
        telemetry.hermes.error = false;
        resetReadable("Hermes uruchomiony. Widok czytelny pokazuje odpowiedzi i pytania, a techniczny szum zostaje w Raw PTY.");
        setMode("readable");
        emitTelemetry();
      }).catch(() => undefined);
    }

    if (method === "POST" && /^\/api\/hermes\/pty\/[0-9a-f-]+\/stop$/i.test(pathname) && response.ok) {
      telemetry.hermes.alive = false;
      telemetry.hermes.busySince = 0;
      telemetry.hermes.lastActivity = now();
      emitTelemetry();
    }
    if (method === "POST" && /^\/api\/chat\/sessions\/[0-9a-f-]+\/stop$/i.test(pathname) && response.ok) {
      telemetry.chat.generating = false;
      telemetry.chat.lastActivity = now();
      emitTelemetry();
    }

    return response;
  };

  function stripAnsi(value) {
    return String(value || "")
      .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, "")
      .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
      .replace(/\x1B[@-_]/g, "");
  }

  function compactLine(value) {
    return String(value || "")
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
      .replace(/^[│┃┆┊┌└├┤╭╰─━\s]+/, "")
      .replace(/[│┃┆┊┌└├┤╭╰─━\s]+$/, "")
      .replace(/\s{3,}/g, "  ")
      .trim();
  }

  function isNoise(text) {
    if (!text) return true;
    if (/^[╭╰┌└├┤│┃─━\s]+$/.test(text)) return true;
    if (/^(?:Window too small\.{0,3}|Plan a feature, then build it step by step)$/i.test(text)) return true;
    if (/^(?:Initializing agent|Welcome to Hermes Agent|Available Tools|Available Skills|Tip:)\b/i.test(text)) return true;
    if (/(?:contemplating|processing|mulling|reflecting|preparing terminal)/i.test(text)) return true;
    if (/^(?:⚕\s*)?(?:❯\s*)?msg=interrupt\b/i.test(text)) return true;
    if (/\bctx\s+--\b/i.test(text) && /[│┤]/.test(text)) return true;
    if (/^(?:The user (?:wants|asked|is asking|requested)|I (?:need to|should|will now)|We need to|Need to)\b/i.test(text)) return true;
    if (/\bI have all the facts\. Reply in Polish\b/i.test(text)) return true;
    return false;
  }

  function classify(text) {
    if (/\b(ERROR|FAIL(?:ED)?|DENIED|DENY|TIMEOUT|EXCEPTION|TRACEBACK|HARMONIA_HTTP_\d+|CHAT_UPSTREAM_\d+|WORKER_PROCESS_FAILED)\b/i.test(text)) return ["error", "BŁĄD"];
    if (/\b(ALLOW|PASS|COMPLETE|COMPLETED|SUCCESS|DONE)\b/i.test(text)) return ["success", "WYNIK"];
    if (/^(?:▶|❯|➜|\$|>)\s*/.test(text)) return ["command", "TY"];
    if (/\?\s*$/.test(text) || /^(?:czy|chcesz|mam|mogę|możesz|potwierdź|wybierz|do you|would you|should i|which|what|where|when|how)\b.*\?/i.test(text)) return ["question", "PYTANIE"];
    if (/^(?:\+\s*\d+\s+commands?|model fallback|authentication failed|npm |node |git |gh |cd |curl |npx )/i.test(text)) return ["meta", "SYSTEM"];
    return ["answer", "ODPOWIEDŹ"];
  }

  function addReadableLine(raw) {
    const text = compactLine(raw);
    if (isNoise(text)) return;
    const stamp = now();
    if (text === lastReadableLine && stamp - lastReadableAt < 900) return;
    lastReadableLine = text;
    lastReadableAt = stamp;

    mountTerminalUi();
    if (!readableRoot) return;
    const empty = readableRoot.querySelector(".runtime-readable-empty");
    empty?.remove();

    const [kind, tag] = classify(text);
    const row = document.createElement("div");
    row.className = `runtime-line ${kind}`;
    const label = document.createElement("span");
    label.className = "runtime-line-tag";
    label.textContent = tag;
    const body = document.createElement("span");
    body.className = "runtime-line-text";
    body.textContent = text;
    row.append(label, body);
    readableRoot.appendChild(row);

    while (readableRoot.children.length > MAX_READABLE_LINES) readableRoot.firstElementChild?.remove();
    const nearBottom = readableRoot.scrollHeight - readableRoot.scrollTop - readableRoot.clientHeight < 120;
    if (nearBottom || kind === "question") readableRoot.scrollTop = readableRoot.scrollHeight;
  }

  function flushReadableBuffer() {
    const pending = compactLine(readableBuffer);
    readableBuffer = "";
    if (pending) addReadableLine(pending);
  }

  function ingestHermesOutput(text) {
    const clean = stripAnsi(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    readableBuffer += clean;
    const lines = readableBuffer.split("\n");
    readableBuffer = lines.pop() || "";
    for (const line of lines) addReadableLine(line);
    clearTimeout(readableFlushTimer);
    readableFlushTimer = setTimeout(flushReadableBuffer, 450);

    if (/[❯➜$]\s*$/.test(clean.trim())) telemetry.hermes.busySince = 0;
  }

  function resetReadable(message) {
    mountTerminalUi();
    if (!readableRoot) return;
    readableRoot.innerHTML = "";
    readableBuffer = "";
    lastReadableLine = "";
    const empty = document.createElement("div");
    empty.className = "runtime-readable-empty";
    empty.textContent = message || "Czekam na wyjście Hermesa…";
    readableRoot.appendChild(empty);
  }

  function handleSse(kind, event) {
    const bytes = byteLength(event.data);
    let payload = null;
    try { payload = JSON.parse(event.data); } catch { /* raw event */ }

    if (kind === "chat") {
      telemetry.chat.rx += bytes;
      telemetry.chat.lastActivity = now();
      telemetry.chat.connected = true;
      if (payload?.type === "assistant_start") telemetry.chat.generating = true;
      if (payload?.type === "assistant_done" || payload?.type === "stopped") telemetry.chat.generating = false;
      if (payload?.type === "error") { telemetry.chat.generating = false; telemetry.chat.error = true; }
    } else if (kind === "hermes") {
      telemetry.hermes.rx += bytes;
      telemetry.hermes.lastActivity = now();
      telemetry.hermes.alive = true;
      if (payload?.type === "out" && typeof payload.text === "string") ingestHermesOutput(payload.text);
      if (payload?.type === "exit") {
        telemetry.hermes.alive = false;
        telemetry.hermes.busySince = 0;
        addReadableLine(`Hermes zakończył proces (exit ${payload.code ?? "?"}).`);
      }
    }
    emitTelemetry();
  }

  if (typeof NativeEventSource === "function") {
    function MonitoredEventSource(url, options) {
      const source = new NativeEventSource(url, options);
      const pathname = pathOf(url);
      const kind = /^\/api\/hermes\/pty\/[0-9a-f-]+\/events$/i.test(pathname)
        ? "hermes"
        : /^\/api\/chat\/sessions\/[0-9a-f-]+\/events$/i.test(pathname) ? "chat" : null;
      if (kind) {
        source.addEventListener("open", () => {
          if (kind === "chat") telemetry.chat.connected = true;
          if (kind === "hermes") telemetry.hermes.alive = true;
          emitTelemetry();
        });
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
    MonitoredEventSource.CONNECTING = NativeEventSource.CONNECTING;
    MonitoredEventSource.OPEN = NativeEventSource.OPEN;
    MonitoredEventSource.CLOSED = NativeEventSource.CLOSED;
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
    if (seconds < 2) return "teraz";
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
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
    currentMode = mode === "raw" ? "raw" : "readable";
    mountTerminalUi();
    const raw = document.getElementById("hermesTerm");
    const readableButton = terminalToolbar?.querySelector('[data-runtime-mode="readable"]');
    const rawButton = terminalToolbar?.querySelector('[data-runtime-mode="raw"]');
    readableRoot?.classList.toggle("active", currentMode === "readable");
    raw?.classList.toggle("runtime-raw-hidden", currentMode !== "raw");
    readableButton?.classList.toggle("active", currentMode === "readable");
    rawButton?.classList.toggle("active", currentMode === "raw");
    readableButton?.setAttribute("aria-pressed", String(currentMode === "readable"));
    rawButton?.setAttribute("aria-pressed", String(currentMode === "raw"));
    if (currentMode === "raw") {
      requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
    }
  }

  function mountTerminalUi() {
    const pane = document.getElementById("hermesPane");
    const raw = document.getElementById("hermesTerm");
    const header = pane?.querySelector(".v5-terminal-head");
    if (!pane || !raw || !header) return false;

    pane.classList.add("runtime-monitor-installed");
    if (!readableRoot) {
      readableRoot = document.createElement("div");
      readableRoot.id = "hermesReadableRuntime";
      readableRoot.className = "runtime-readable";
      readableRoot.setAttribute("role", "log");
      readableRoot.setAttribute("aria-live", "polite");
      readableRoot.innerHTML = '<div class="runtime-readable-empty">Czekam na wyjście Hermesa…</div>';
      raw.before(readableRoot);
    }

    if (!terminalToolbar) {
      terminalToolbar = document.createElement("div");
      terminalToolbar.className = "runtime-terminal-toolbar";
      terminalToolbar.innerHTML = `
        <button class="runtime-terminal-button" data-runtime-mode="readable" type="button" aria-pressed="false">Readable</button>
        <button class="runtime-terminal-button active" data-runtime-mode="raw" type="button" aria-pressed="true">Raw PTY</button>
        <span class="runtime-terminal-spacer"></span>
        <span class="runtime-terminal-summary dead" id="runtimeTerminalSummary"><i class="runtime-terminal-heartbeat"></i><strong>OFF</strong><span>RX 0 B · TX 0 B</span></span>
        <button class="runtime-terminal-button" data-runtime-action="expand" type="button">Expand</button>
        <button class="runtime-terminal-button" data-runtime-action="copy" type="button">Copy</button>`;
      readableRoot.before(terminalToolbar);
      terminalSummary = terminalToolbar.querySelector("#runtimeTerminalSummary");
      terminalToolbar.addEventListener("click", async (event) => {
        const button = event.target.closest("button");
        if (!button) return;
        if (button.dataset.runtimeMode) setMode(button.dataset.runtimeMode);
        if (button.dataset.runtimeAction === "expand") {
          pane.classList.toggle("runtime-expanded");
          button.textContent = pane.classList.contains("runtime-expanded") ? "Collapse" : "Expand";
          requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
        }
        if (button.dataset.runtimeAction === "copy") {
          const text = readableRoot?.innerText || "";
          try {
            await navigator.clipboard.writeText(text);
            const old = button.textContent;
            button.textContent = "Copied";
            setTimeout(() => { button.textContent = old; }, 1000);
          } catch { button.textContent = "Copy failed"; }
        }
      });
    }
    return true;
  }

  function mountRouterMonitor() {
    const headCopy = document.querySelector("#routerInspectorDrawer .router-head-copy");
    if (!headCopy) return false;
    if (document.getElementById("routerRuntimeStrip")) return true;
    const strip = document.createElement("div");
    strip.id = "routerRuntimeStrip";
    strip.className = "router-runtime-strip";
    strip.innerHTML = `
      <span class="router-runtime-pill dead" id="runtimeChatProcess"><i class="router-runtime-dot"></i>CHAT <strong>OFFLINE</strong></span>
      <span class="router-runtime-pill dead" id="runtimeHermesProcess"><i class="router-runtime-dot"></i>HERMES <strong>OFF</strong></span>
      <span class="router-runtime-pill router-runtime-bytes" id="runtimeBytes">RX 0 B · TX 0 B</span>
      <span class="router-runtime-pill router-runtime-delta" id="runtimeDelta">Δ 0 B/s · 0 B/s</span>
      <span class="router-runtime-pill" id="runtimeLastActivity">last n/a</span>`;
    headCopy.appendChild(strip);
    return true;
  }

  function updateUi() {
    mountTerminalUi();
    mountRouterMonitor();

    const totalRx = telemetry.chat.rx + telemetry.hermes.rx;
    const totalTx = telemetry.chat.tx + telemetry.hermes.tx;
    const [cStatus, cClass] = chatStatus();
    const [hStatus, hClass] = hermesStatus();
    const latest = Math.max(telemetry.chat.lastActivity || 0, telemetry.hermes.lastActivity || 0);

    const chatPill = document.getElementById("runtimeChatProcess");
    const hermesPill = document.getElementById("runtimeHermesProcess");
    const bytesPill = document.getElementById("runtimeBytes");
    const deltaPill = document.getElementById("runtimeDelta");
    const activityPill = document.getElementById("runtimeLastActivity");

    if (chatPill) {
      chatPill.className = `router-runtime-pill ${cClass}`;
      chatPill.querySelector("strong").textContent = cStatus;
      chatPill.title = `Chat activity: ${ageLabel(telemetry.chat.lastActivity)}`;
    }
    if (hermesPill) {
      hermesPill.className = `router-runtime-pill ${hClass}`;
      hermesPill.querySelector("strong").textContent = hStatus;
      const pid = telemetry.hermes.pid ? ` · PID ${telemetry.hermes.pid}` : " · PID N/A";
      hermesPill.title = `Hermes ${hStatus}${pid} · activity ${ageLabel(telemetry.hermes.lastActivity)}`;
    }
    if (bytesPill) bytesPill.textContent = `RX ${formatBytes(totalRx)} · TX ${formatBytes(totalTx)}`;
    if (deltaPill) deltaPill.textContent = `Δ ${formatBytes(telemetry.sampled.deltaRx)}/s · ${formatBytes(telemetry.sampled.deltaTx)}/s`;
    if (activityPill) activityPill.textContent = `last ${ageLabel(latest)}`;

    if (terminalSummary) {
      terminalSummary.className = `runtime-terminal-summary ${hClass}`;
      const strong = terminalSummary.querySelector("strong");
      const detail = terminalSummary.querySelector("span");
      if (strong) strong.textContent = hStatus;
      if (detail) detail.textContent = `RX ${formatBytes(telemetry.hermes.rx)} · TX ${formatBytes(telemetry.hermes.tx)} · ${ageLabel(telemetry.hermes.lastActivity)}`;
      terminalSummary.title = telemetry.hermes.pid ? `PID ${telemetry.hermes.pid}` : "PID unavailable in current PTY API";
    }
  }

  function sample() {
    const stamp = now();
    const totalRx = telemetry.chat.rx + telemetry.hermes.rx;
    const totalTx = telemetry.chat.tx + telemetry.hermes.tx;
    const elapsed = Math.max(1, (stamp - telemetry.sampled.at) / 1000);
    telemetry.sampled.deltaRx = Math.max(0, Math.round((totalRx - telemetry.sampled.rx) / elapsed));
    telemetry.sampled.deltaTx = Math.max(0, Math.round((totalTx - telemetry.sampled.tx) / elapsed));
    telemetry.sampled.rx = totalRx;
    telemetry.sampled.tx = totalTx;
    telemetry.sampled.at = stamp;
    updateUi();
    emitTelemetry();
  }

  const observer = new MutationObserver(() => {
    mountTerminalUi();
    mountRouterMonitor();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  window.koordynatorRuntimeTelemetry = { snapshot, resetReadable, setMode };
  mountTerminalUi();
  updateUi();
  setInterval(sample, 1000);
})();
