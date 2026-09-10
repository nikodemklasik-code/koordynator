async function loadProjectSource() {
  const projectId = new URLSearchParams(location.search).get("project");
  if (!projectId) return;
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, { headers: { accept: "application/json" } });
  if (!response.ok) return;
  const project = await response.json();
  const bytes = new TextEncoder().encode(String(project.context || ""));
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  if (typeof state !== "undefined" && Array.isArray(state.pendingAttachments)) {
    state.pendingAttachments.push({
      clientId: (typeof createClientId === "function" ? createClientId() : `project-${Date.now()}`),
      name: `${String(project.name || "project").replace(/[^\w.-]+/g, "-")}.context.txt`,
      mimeType: "text/plain",
      size: bytes.length,
      dataUrl: `data:text/plain;base64,${btoa(binary)}`
    });
    if (typeof renderPendingAttachments === "function") renderPendingAttachments();
    if (typeof updateControls === "function") updateControls();
  }
  const input = document.getElementById("messageInput");
  if (input && !input.value.trim()) input.value = [project.objective, project.githubUrl].filter(Boolean).join("\n\n");
}

window.addEventListener("load", () => { void loadProjectSource(); });
