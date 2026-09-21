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
    const text = normalise(el.textContent);
    const aria = normalise(el.getAttribute("aria-label"));
    const title = normalise(el.getAttribute("title"));
    const label = text && !/^[^a-z0-9ąćęłńóśźż]+$/i.test(text) ? text : (aria || title || text);
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
    if (/^home$/.test(label)) return "home";
    if (/live chat/.test(label) || href === "/chat") return "live-chat";
    if (/^tasks?$/.test(label)) return "tasks";
    if (/^providers?$/.test(label) || href === "/providers") return "providers";
    if (/^(releases?|readiness)$/.test(label) || href === "/releases") return "releases";
    if (/harmonia legal/.test(label) || href === "/harmonia-legal") return "harmonia-legal";
    if (/^corporation$/.test(label) || href === "/corporation") return "corporation";
    if (/job app/.test(label)) return "job-app";
    if (/ustr[oó]j/.test(label) || href === "/ustroj") return "ustroj";
    if (/^contracts?$/.test(label)) return "contracts";
    if (/^routing$/.test(label)) return "routing";
    if (/^billing$/.test(label)) return "billing";
    if (/^studio$/.test(label)) return "studio";
    if (id === "githubchatbutton" || /^github\b/.test(label)) return "github";
    if (/^settings$/.test(label)) return "settings";
    return id ? `id:${id}` : label ? `label:${label}` : "";
  };

  const shell = document.createElement("header");
  shell.id = "koordShell";
  shell.className = "koord-shell";
  shell.innerHTML = [
    '<div class="koord-shell-row koord-shell-row-primary">',
    '  <nav class="koord-shell-primary" id="koordShellPrimary" aria-label="Screens and conversation actions"></nav>',
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

  const primary = document.getElementById("koordShellPrimary");
  const tools = document.getElementById("koordShellTools");
  const exportMenu = document.getElementById("koordShellExportMenu");
  const exportDetails = document.getElementById("koordShellExport");

  const makeLink = (label, href, key, current = false) => {
    const link = document.createElement("a");
    link.href = href;
    link.textContent = label;
    link.dataset.shellKey = key;
    link.className = `koord-shell-button importance-2${current ? " active" : ""}`;
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

  const currentPath = window.location.pathname;
  const canonicalScreens = [
    ["home", "Home", "/"],
    ["live-chat", "Live Chat", "/chat"],
    ["corporation", "Corporation", "/corporation"],
    ["tasks", "Tasks", "/"],
    ["providers", "Providers", "/providers"],
    ["releases", "Releases", "/releases"],
    ["harmonia-legal", "Harmonia Legal", "/harmonia-legal"],
    ["job-app", "Job App", ""],
    ["ustroj", "Ustrój", "/ustroj"]
  ];

  for (const [key, label, href] of canonicalScreens) {
    let el = preferred.get(key);
    if (!el && href) el = makeLink(label, href, key, currentPath === href);
    if (!el && key === "job-app") {
      const placeholder = document.createElement("button");
      placeholder.type = "button";
      placeholder.textContent = label;
      placeholder.disabled = true;
      placeholder.title = `${label} launcher is not configured in this runtime`;
      placeholder.className = "product-placeholder";
      el = placeholder;
    }
    if (!el) continue;
    el.hidden = false;
    el.dataset.shellKey = key;
    el.classList.add("koord-shell-button", "importance-2");
    el.classList.remove("importance-1", "importance-3", "primary");
    if (href && currentPath === href) {
      el.classList.add("active");
      el.setAttribute("aria-current", "page");
    } else {
      el.classList.remove("active");
      el.removeAttribute("aria-current");
    }
    primary.appendChild(el);
  }

  const separator = document.createElement("span");
  separator.className = "koord-shell-divider";
  separator.setAttribute("aria-hidden", "true");
  primary.appendChild(separator);

  for (const key of ["conversations", "new-conversation"]) {
    const el = preferred.get(key);
    if (!el) continue;
    el.hidden = false;
    el.dataset.shellKey = key;
    el.classList.add("koord-shell-button", "importance-2");
    el.classList.remove("importance-1", "importance-3", "primary");
    primary.appendChild(el);
  }

  const toolOrder = [
    "contracts",
    "routing",
    "billing",
    "studio",
    "create-document",
    "stage-zero",
    "settings",
    "github",
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

  // GitHub starts inside the runtime strip, so it is not part of the pre-workspace
  // clickable scan. Move the single canonical GitHub control into the tools row.
  const githubControl = document.getElementById("githubChatButton");
  if (githubControl && !tools.contains(githubControl)) {
    githubControl.hidden = false;
    githubControl.dataset.shellKey = "github";
    githubControl.classList.add("koord-shell-button", "importance-3");
    tools.appendChild(githubControl);
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

  for (const child of [...main.children]) {
    if (child === shell || child === workspace) continue;
    const relation = child.compareDocumentPosition(workspace);
    if (relation & Node.DOCUMENT_POSITION_FOLLOWING) child.dataset.shellRetired = "true";
  }

  const rail = document.querySelector(".v5-rail");
  if (rail) rail.dataset.shellRetired = "true";

  document.body.classList.add("koord-shell-active");

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
