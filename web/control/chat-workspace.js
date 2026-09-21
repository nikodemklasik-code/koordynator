(() => {
  "use strict";

  const path = window.location.pathname;
  const modes = {
    "/corporation": {
      id: "corporation",
      label: "Corporation",
      repository: "nikodemklasik-code/koordynator",
      protectedBranches: ["main", "integration/control-corporation-v1"],
      fixedRepository: true
    },
    "/harmonia-legal": {
      id: "harmonia-legal",
      label: "Harmonia Legal",
      repository: "nikodemklasik-code/Harmonia-Legal-Platform",
      protectedBranches: ["main", "develop"],
      fixedRepository: true
    }
  };

  const workspace = modes[path] || {
    id: "general",
    label: "Live Chat",
    repository: null,
    protectedBranches: [],
    fixedRepository: false
  };

  window.koordynatorWorkspace = Object.freeze(workspace);
  document.documentElement.dataset.workspace = workspace.id;
  document.documentElement.dataset.repositoryMode = workspace.fixedRepository ? "fixed" : "selectable";

  const title = document.querySelector("title");
  if (title && workspace.id !== "general") title.textContent = `Koordynator · ${workspace.label}`;

  const brandTitle = document.querySelector(".v5-brand-title");
  const brandSubtitle = document.querySelector(".v5-brand-subtitle");
  if (workspace.id === "corporation") {
    if (brandTitle) brandTitle.textContent = "CORPORATION";
    if (brandSubtitle) brandSubtitle.textContent = "KOORDYNATOR WORKSPACE";
  } else if (workspace.id === "harmonia-legal") {
    if (brandTitle) brandTitle.textContent = "HARMONIA LEGAL";
    if (brandSubtitle) brandSubtitle.textContent = "LEGAL PLATFORM WORKSPACE";
  }
})();
