const projectFileInput = document.getElementById("projectFileInput");
const projectDrop = document.getElementById("projectDrop");
const projectFileList = document.getElementById("projectFileList");
const projectObjective = document.getElementById("projectObjective");
const projectGithub = document.getElementById("projectGithub");
const projectSubmit = document.getElementById("projectSubmit");
const projectError = document.getElementById("projectError");
const projectSources = document.getElementById("projectSources");

const projectFiles = [];
const PROJECT_MAX_FILES = 40;
const PROJECT_MAX_BYTES = 10 * 1024 * 1024;
const PROJECT_MAX_TOTAL = 20 * 1024 * 1024;

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("READ_FAILED"));
    reader.onerror = () => reject(reader.error || new Error("READ_FAILED"));
    reader.readAsDataURL(file);
  });
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function renderProjectFiles() {
  if (!projectFileList) return;
  projectFileList.textContent = "";
  for (const item of projectFiles) {
    const row = document.createElement("div");
    row.className = "project-file-row";
    row.textContent = `${item.name} · ${formatBytes(item.size)}`;
    projectFileList.appendChild(row);
  }
  projectFileList.classList.toggle("hidden", projectFiles.length === 0);
}

async function addProjectFiles(list) {
  const incoming = Array.from(list || []);
  if (!incoming.length) return;
  if (projectError) projectError.textContent = "";
  if (projectFiles.length + incoming.length > PROJECT_MAX_FILES) {
    if (projectError) projectError.textContent = `Maximum ${PROJECT_MAX_FILES} files.`;
    return;
  }
  let total = projectFiles.reduce((sum, item) => sum + item.size, 0);
  for (const file of incoming) {
    if (file.size > PROJECT_MAX_BYTES) {
      if (projectError) projectError.textContent = `${file.name} is larger than 10 MB.`;
      return;
    }
    total += file.size;
    if (total > PROJECT_MAX_TOTAL) {
      if (projectError) projectError.textContent = "Uploads exceed 20 MB.";
      return;
    }
    projectFiles.push({
      name: file.name,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      dataUrl: await readAsDataUrl(file)
    });
  }
  renderProjectFiles();
}

async function loadProjectSources() {
  if (!projectSources) return;
  try {
    const response = await fetch("/api/projects", { headers: { accept: "application/json" } });
    if (!response.ok) return;
    const payload = await response.json();
    const projects = Array.isArray(payload.projects) ? payload.projects : [];
    projectSources.classList.toggle("hidden", projects.length === 0);
    projectSources.innerHTML = projects.slice(0, 12).map((project) => {
      const href = `/chat?project=${encodeURIComponent(project.projectId)}`;
      return `<a class="project-chip" href="${href}"><strong>${escapeHtml(project.taskId)}</strong><span>${escapeHtml(project.name)}</span></a>`;
    }).join("");
  } catch {
    /* listing is optional */
  }
}

if (projectFileInput) projectFileInput.addEventListener("change", () => void addProjectFiles(projectFileInput.files).then(() => { projectFileInput.value = ""; }));
if (projectDrop) {
  projectDrop.addEventListener("dragover", (event) => {
    event.preventDefault();
    projectDrop.classList.add("drag-active");
  });
  projectDrop.addEventListener("dragleave", () => projectDrop.classList.remove("drag-active"));
  projectDrop.addEventListener("drop", (event) => {
    event.preventDefault();
    projectDrop.classList.remove("drag-active");
    void addProjectFiles(event.dataTransfer?.files);
  });
  projectDrop.addEventListener("click", () => projectFileInput?.click());
}
if (projectSubmit) {
  projectSubmit.addEventListener("click", async (event) => {
    event.preventDefault();
    if (projectError) projectError.textContent = "";
    projectSubmit.disabled = true;
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          objective: projectObjective?.value || "",
          githubUrl: projectGithub?.value || "",
          files: projectFiles
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `PROJECT_HTTP_${response.status}`);
      location.href = `/chat?project=${encodeURIComponent(payload.projectId)}`;
    } catch (error) {
      if (projectError) projectError.textContent = error instanceof Error ? error.message : "Upload failed";
      projectSubmit.disabled = false;
    }
  });
}

void loadProjectSources();
