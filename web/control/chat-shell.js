(() => {
  "use strict";

  const workspace = document.getElementById("chatWorkspace") || document.querySelector(".v5-workspace");
  const main = workspace?.closest("main") || document.querySelector(".v5-main") || document.querySelector("main");
  if (!workspace || !main || document.getElementById("koordShell")) return;

  const normalise = (value) => String(value || "")
    .replace(/[+↗•••…]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  const semanticKey = (el) => {
    const id = String(el.id || "").toLowerCase();
    const label = normalise(el.textContent || el.getAttribute("aria-label") || el.getAttribute("title"));
    const href = el instanceof HTMLAnchorElement ? (el.getAttribute("href") || "") : "";

    if (id === "historybutton" || /^(history|conversations)$/.test(label)) return "conversations";
    if (id === "newchatbutton" || /new (chat|conversation)/.test(label)) return "new-conversation";
    if (id === "stagezerobutton" || label === "etap 0") return "stage-zero";
    if (id === "mutehermesbutton" || /(hide|show|wycisz|pokaż|zamknij).*terminal|hermes/.test(label)) return "terminal";
    if (id === "popoutchatbutton" || label === "pop out chat") return "popout";
    if (id === "createdocumentbutton" || /create document|utwórz dokument/.test(label)) return "create-document";
    if (id === "exportmdbutton" || /export (markdown|md)/.test(label)) return "export-md";
    if (id === "exportpdfbutton" || /export pdf/.test(label)) return "export-pdf";
    if (id === "exportzipbutton" || /export zip/.test(label)) return "export-zip";
    if (/^home$/.test(label) || href === "/") return "home";
    if (/live chat/.test(label) || href === "/chat") return "live-chat";
    if (/harmonia legal/.test(label)) return "harmonia-legal";
    if (/job app/.test(label)) return "job-app";
    if (/ustr[oó]j/.test(label) || href === "/ustroj") return "ustroj";
    if (/^contracts?$/.test(label)) return "contracts";
    if (/^tasks?$/.test(label)) return "tasks";
    if (/^providers?$/.test(label)) return "providers";
    if (/^routing$/.test(label)) return "routing";
    if (/^billing$/.test(label)) return "billing";
    if (/^studio$/.test(label)) return "studio";
    if (/^releases?$/.test(label)) return "releases";
    if (/^settings$/.test(label)) return "settings";
    return id ? `id:${id}` : label ? `label:${label}` : "";
  };

  const shell = document.createElement("header");
  shell.id = "koordShell";
  shell.className = "koord-shell";
  shell.innerHTML = [
    '<div class="koord-shell-row koord-shell-row-primary">',
    '  <nav class="koord-shell-products" id="koordShellProducts" aria-label="Products"></nav>',
    '  <div class="koord-shell-conversation" id="koordShellConversation"></div>',
    '</div>',
    '<div class="koord-shell-row koord-shell-row-secondary">',
    '  <div class="koord-shell-tools" id="koordShellTools"></div>',
    '  <details class="koord-shell-export" id="koordShellExport">',
    '    <summary class="koord-shell-button importance-3" aria-label="Export options">Export</summary>',
    '    <div class="koord-shell-export-menu" id="koordShellExportMenu"></div>',
    '  </details>',
    '</div>'
  ].join("");

  main.insertBefore(shell, workspace);

  const products = document.getElementById("koordShellProducts");
  const conversation = document.getElementById("koordShellConversation");
  const tools = document.getElementById("koordShellTools");
  const exportMenu = document.getElementById("koordShellExportMenu");
  const exportDetails = document.getElementById("koordShellExport");

  const makeLink = (label, href, key, current = false) => {
    const link = document.createElement("a");
    link.href = href;
    link.textContent = label;
    link.dataset.shellKey = key;
    link.className = `koord-shell-button importance-${current ? "1" : "2"}${current ? " active" : ""}`;
    if (current) link.setAttribute("aria-current", "page");
    return link;
  };

  const existingHeaderClickables = [...main.querySelectorAll("a, button, summary")]
    .filter((el) => !shell.contains(el))
    .filter((el) => {
      const relation = el.compareDocumentPosition(workspace);
      return Boolean(relation & Node.DOCUMENT_POSITION_FOLLOWING);
    });

  const preferred = new Map();
  for (const el of existingHeaderClickables) {
    const key = semanticKey(el);
    if (!key) continue;
    const current = preferred.get(key);
    const score = (el.id ? 4 : 0) + (el instanceof HTMLButtonElement ? 2 : 0) + (el instanceof HTMLAnchorElement ? 1 : 0);
    const currentScore = current
      ? (current.id ? 4 : 0) + (current instanceof HTMLButtonElement ? 2 : 0) + (current instanceof HTMLAnchorElement ? 1 : 0)
      : -1;
    if (!current || score > currentScore) preferred.set(key, el);
  }

  for (const el of existingHeaderClickables) {
    const key = semanticKey(el);
    if (!key || preferred.get(key) === el) continue;
    el.hidden = true;
    el.dataset.shellDuplicate = key;
  }

  const canonicalProducts = [
    ["home", "Home", "/"],
    ["live-chat", "Live Chat", "/chat"],
    ["harmonia-legal", "Harmonia Legal", ""],
    ["job-app", "Job App", ""],
    ["ustroj", "Ustrój", "/ustroj"]
  ];

  for (const [key, label, href] of canonicalProducts) {
    let el = preferred.get(key);
    if (!el && href) el = makeLink(label, href, key, key === "live-chat");
    if (!el) continue;
    el.hidden = false;
    el.dataset.shellKey = key;
    el.classList.add("koord-shell-button");
    el.classList.add(key === "live-chat" ? "importance-1" : "importance-2");
    if (key === "live-chat") el.classList.add("active");
    products.appendChild(el);
  }

  const conversationKeys = ["conversations", "new-conversation"];
  for (const key of conversationKeys) {
    const el = preferred.get(key);
    if (!el) continue;
    el.hidden = false;
    el.dataset.shellKey = key;
    el.classList.add("koord-shell-button", key === "new-conversation" ? "importance-1" : "importance-2");
    conversation.appendChild(el);
  }

  const toolOrder = [
    "contracts",
    "tasks",
    "providers",
    "routing",
    "billing",
    "studio",
    "releases",
    "create-document",
    "stage-zero",
    "settings",
    "terminal",
    "popout"
  ];
  for (const key of toolOrder) {
    const el = preferred.get(key);
    if (!el) continue;
    el.hidden = false;
    el.dataset.shellKey = key;
    el.classList.add("koord-shell-button", key === "stage-zero" ? "importance-2" : "importance-3");
    tools.appendChild(el);
  }

  for (const key of ["export-md", "export-pdf", "export-zip"]) {
    const el = preferred.get(key);
    if (!el) continue;
    el.hidden = false;
    el.dataset.shellKey = key;
    el.classList.add("koord-shell-export-item");
    exportMenu.appendChild(el);
  }
  if (!exportMenu.childElementCount) exportDetails.hidden = true;

  const originalTopbar = main.querySelector(".v5-topbar");
  const originalToolbar = main.querySelector(".v5-toolbar");
  if (originalTopbar) originalTopbar.dataset.shellRetired = "true";
  if (originalToolbar) originalToolbar.dataset.shellRetired = "true";

  const rail = document.querySelector(".v5-rail");
  if (rail) rail.dataset.shellRetired = "true";

  document.body.classList.add("koord-shell-active");

  // A final defensive pass: no two visible header controls may represent the same action.
  const seen = new Set();
  for (const el of shell.querySelectorAll("a, button, summary")) {
    const key = semanticKey(el);
    if (!key) continue;
    if (seen.has(key)) {
      el.hidden = true;
      el.dataset.shellDuplicate = key;
      continue;
    }
    seen.add(key);
  }
})();
