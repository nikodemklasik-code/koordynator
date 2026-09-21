(() => {
  "use strict";

  const routebar = document.querySelector(".v5-routebar");
  const github = document.getElementById("githubChatButton");
  const footer = document.querySelector(".v5-statusbar");
  const session = document.getElementById("sessionLabel");
  const hermesPane = document.getElementById("hermesPane");
  if (!routebar) return;

  if (session && footer && !document.getElementById("sessionFooter")) {
    const wrap = document.createElement("div");
    wrap.id = "sessionFooter";
    wrap.className = "koord-session-footer";
    wrap.innerHTML = '<span>SESSION</span>';
    session.classList.add("koord-session-value");
    session.removeAttribute("style");
    wrap.appendChild(session);
    footer.appendChild(wrap);
  }

  const access = document.createElement("div");
  access.className = "koord-local-access";
  access.setAttribute("aria-label", "Local Hermes access");
  access.innerHTML = [
    '<button id="localTerminalAccess" class="koord-access-pill checking" type="button"><i></i><span>Terminal</span><strong>…</strong></button>',
    '<button id="localDiskAccess" class="koord-access-pill checking" type="button"><i></i><span>Dyski</span><strong>…</strong></button>'
  ].join("");
  const terminalAuxGroup = document.querySelector('.koord-shell-tool-group[data-tool-group="terminal-aux"]');
  if (terminalAuxGroup) terminalAuxGroup.prepend(access);
  else if (github && routebar.contains(github)) github.before(access);
  else routebar.appendChild(access);

  const terminalButton = document.getElementById("localTerminalAccess");
  const diskButton = document.getElementById("localDiskAccess");

  const dialog = document.createElement("dialog");
  dialog.id = "localAccessDialog";
  dialog.className = "koord-access-dialog";
  dialog.innerHTML = [
    '<form method="dialog" class="koord-access-card">',
    '  <header><div><span class="koord-access-kicker">LOCAL ACCESS</span><strong id="localAccessTitle">Hermes</strong></div><button value="cancel" aria-label="Zamknij">×</button></header>',
    '  <p id="localAccessText"></p>',
    '  <label id="localRootsField" class="koord-roots-field" hidden><span>Dozwolone katalogi, po jednej ścieżce absolutnej w wierszu</span><textarea id="localRootsInput" rows="5" spellcheck="false" placeholder="/Users/.../Documents"></textarea></label>',
    '  <div class="koord-access-error" id="localAccessError" hidden></div>',
    '  <footer><button value="cancel" class="secondary">Anuluj</button><button type="button" class="primary" id="localAccessApprove">Włącz</button></footer>',
    '</form>'
  ].join("");
  document.body.appendChild(dialog);

  const title = document.getElementById("localAccessTitle");
  const text = document.getElementById("localAccessText");
  const rootsField = document.getElementById("localRootsField");
  const rootsInput = document.getElementById("localRootsInput");
  const errorBox = document.getElementById("localAccessError");
  const approve = document.getElementById("localAccessApprove");

  let status = { terminal: false, localFiles: false, localRoots: [] };
  let mode = "terminal";

  function setPill(button, enabled, detail) {
    if (!button) return;
    button.classList.remove("checking", "on", "off");
    button.classList.add(enabled ? "on" : "off");
    const strong = button.querySelector("strong");
    if (strong) strong.textContent = enabled ? "ON" : "OFF";
    button.title = detail || (enabled ? "Access enabled" : "Access disabled");
  }

  function render(next) {
    status = next && typeof next === "object" ? next : status;
    const roots = Array.isArray(status.localRoots) ? status.localRoots : [];
    setPill(terminalButton, status.terminal === true, status.terminal ? "Hermes terminal access is enabled." : "Click to grant Hermes local terminal access.");
    setPill(diskButton, status.localFiles === true && roots.length > 0,
      status.localFiles === true && roots.length > 0
        ? `Hermes local roots: ${roots.join(", ")}`
        : "Click to choose local folders Hermes may access.");
  }

  async function loadStatus() {
    try {
      const response = await fetch("/api/integrations/hermes-grants", { headers: { accept: "application/json" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      render(await response.json());
    } catch {
      terminalButton?.classList.add("checking");
      diskButton?.classList.add("checking");
    }
  }

  function openDialog(nextMode) {
    mode = nextMode;
    errorBox.hidden = true;
    errorBox.textContent = "";
    const roots = Array.isArray(status.localRoots) ? status.localRoots : [];
    if (mode === "terminal") {
      title.textContent = "Dostęp do terminala";
      text.textContent = "Hermes otrzyma lokalny dostęp do terminala. Sam Live Chat nie wykonuje poleceń powłoki.";
      rootsField.hidden = true;
      approve.textContent = status.terminal ? "Terminal aktywny" : "Włącz terminal";
      approve.disabled = status.terminal === true;
    } else {
      title.textContent = "Dostęp do dysków";
      text.textContent = "Podaj wyłącznie katalogi, które Hermes może czytać jako lokalne roots. Dostęp pozostaje ograniczony do jawnie wpisanych ścieżek.";
      rootsField.hidden = false;
      rootsInput.value = roots.join("\n");
      approve.textContent = status.localFiles ? "Zapisz katalogi" : "Włącz dyski";
      approve.disabled = false;
    }
    if (!dialog.open) dialog.showModal();
  }

  async function submit() {
    approve.disabled = true;
    errorBox.hidden = true;
    try {
      const payload = mode === "terminal"
        ? { grant: "terminal", approved: true }
        : {
            grant: "local-files",
            approved: true,
            roots: String(rootsInput.value || "")
              .split(/\r?\n/)
              .map((value) => value.trim())
              .filter(Boolean)
          };
      if (mode === "local-files" && payload.roots.length === 0) {
        throw new Error("Wpisz co najmniej jeden katalog absolutny.");
      }
      const response = await fetch("/api/integrations/hermes-grants", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(payload)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      render(result);
      dialog.close();
    } catch (error) {
      errorBox.textContent = error instanceof Error ? error.message : "Nie udało się zapisać dostępu.";
      errorBox.hidden = false;
    } finally {
      approve.disabled = false;
    }
  }

  terminalButton?.addEventListener("click", () => openDialog("terminal"));
  diskButton?.addEventListener("click", () => openDialog("local-files"));
  approve?.addEventListener("click", () => void submit());
  window.addEventListener("koordynator:hermes-grants-changed", (event) => {
    if (event?.detail && typeof event.detail === "object") render(event.detail);
    else void loadStatus();
  });

  function removeDuplicateTerminalControls() {
    const runtimeToolbar = document.querySelector(".runtime-terminal-toolbar");
    if (!runtimeToolbar) return;
    for (const duplicate of document.querySelectorAll(".terminal-viewbar")) {
      duplicate.hidden = true;
      duplicate.setAttribute("aria-hidden", "true");
    }
  }

  removeDuplicateTerminalControls();
  if (hermesPane) {
    new MutationObserver(removeDuplicateTerminalControls).observe(hermesPane, { childList: true, subtree: true });
  }

  void loadStatus();
})();
