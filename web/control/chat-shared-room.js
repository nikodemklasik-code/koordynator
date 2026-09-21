(() => {
  "use strict";

  const SESSION_KEY = "koordynator.liveChat.sessionId";
  const addButton = document.getElementById("addAgentButton");
  const dialog = document.getElementById("sharedRoomDialog");
  const topicInput = document.getElementById("sharedRoomTopic");
  const sourceSelect = document.getElementById("sharedRoomSourceSession");
  const secondRole = document.getElementById("sharedRoomSecondRole");
  const currentAgent = document.getElementById("sharedRoomCurrentAgent");
  const createButton = document.getElementById("sharedRoomCreateButton");
  const errorBox = document.getElementById("sharedRoomError");
  const modelRoleFilter = document.getElementById("modelRoleFilter");

  let currentSession = null;
  let sessionSummaries = [];

  function showError(message = "") {
    if (!errorBox) return;
    errorBox.textContent = message;
    errorBox.classList.toggle("hidden", !message);
  }

  function activeSessionId() {
    try { return localStorage.getItem(SESSION_KEY) || ""; } catch { return ""; }
  }

  function roleValue() {
    const value = String(modelRoleFilter?.value || "GENERAL").trim();
    return value === "ALL" ? "GENERAL" : value;
  }

  function shortModel(value) {
    const text = String(value || "");
    return text.length > 36 ? `${text.slice(0, 33)}…` : text;
  }

  function ensureRoomBar() {
    let bar = document.getElementById("sharedRoomBar");
    if (bar) return bar;
    const chatPane = document.getElementById("chatFrame");
    const thread = document.getElementById("chatThread");
    if (!chatPane || !thread) return null;
    bar = document.createElement("div");
    bar.id = "sharedRoomBar";
    bar.className = "shared-room-bar hidden";
    thread.before(bar);
    return bar;
  }

  function renderRoomBar(session) {
    const bar = ensureRoomBar();
    if (!bar) return;
    const room = session?.sharedRoom;
    if (!room) {
      bar.classList.add("hidden");
      bar.replaceChildren();
      if (addButton) {
        addButton.textContent = "＋ AI";
        addButton.title = "Create shared room with another AI agent";
      }
      return;
    }

    bar.classList.remove("hidden");
    bar.replaceChildren();
    const title = document.createElement("div");
    title.className = "shared-room-bar-title";
    title.innerHTML = '<span>SHARED ROOM</span><strong></strong>';
    title.querySelector("strong").textContent = room.topic || "Shared project";

    const participants = document.createElement("div");
    participants.className = "shared-room-participants";
    for (const participant of Array.isArray(room.participants) ? room.participants : []) {
      const chip = document.createElement("span");
      chip.className = "shared-room-participant";
      const label = document.createElement("strong");
      label.textContent = participant.label || "Agent";
      const meta = document.createElement("small");
      meta.textContent = `${participant.role || "GENERAL"} · ${shortModel(participant.model)}`;
      chip.append(label, meta);
      chip.title = `Source conversation: ${participant.sourceSessionId || "unknown"}`;
      participants.appendChild(chip);
    }
    bar.append(title, participants);

    if (addButton) {
      addButton.textContent = `${room.participants?.length || 2} AI`;
      addButton.title = "This is already a shared multi-agent room";
    }
  }

  async function fetchSession(sessionId) {
    if (!sessionId) return null;
    const response = await fetch(`/api/chat/sessions/${encodeURIComponent(sessionId)}`, { headers: { accept: "application/json" } });
    if (!response.ok) return null;
    return response.json();
  }

  async function loadCandidates() {
    const currentId = currentSession?.sessionId || activeSessionId();
    const response = await fetch("/api/chat/sessions?limit=100", { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`CHAT_HISTORY_HTTP_${response.status}`);
    const payload = await response.json();
    sessionSummaries = (Array.isArray(payload.sessions) ? payload.sessions : [])
      .filter((session) => session.sessionId !== currentId && !session.sharedRoom && Number(session.messageCount || 0) > 0);

    sourceSelect.replaceChildren();
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = sessionSummaries.length ? "Choose conversation…" : "No other conversation available";
    sourceSelect.appendChild(placeholder);

    for (const session of sessionSummaries) {
      const option = document.createElement("option");
      option.value = session.sessionId;
      option.textContent = `${session.title || "Untitled"} · ${shortModel(session.model)} · ${session.messageCount} msg`;
      sourceSelect.appendChild(option);
    }
  }

  async function openDialog() {
    showError("");
    const sessionId = activeSessionId();
    currentSession = await fetchSession(sessionId);
    if (!currentSession) {
      showError("Current conversation is unavailable.");
      return;
    }
    renderRoomBar(currentSession);

    if (currentSession.sharedRoom) {
      showError("This conversation is already a Shared Room. Create a new room from a normal source conversation.");
      dialog?.showModal?.();
      return;
    }

    if (currentAgent) {
      currentAgent.replaceChildren();
      const label = document.createElement("strong");
      label.textContent = "Current agent";
      const meta = document.createElement("span");
      meta.textContent = `${currentSession.model || "model"} · ${roleValue()} · ${currentSession.messages?.length || 0} messages`;
      currentAgent.append(label, meta);
    }

    await loadCandidates();
    if (topicInput) topicInput.value = "";
    dialog?.showModal?.();
    requestAnimationFrame(() => topicInput?.focus());
  }

  async function createRoom() {
    showError("");
    if (!currentSession) return;
    const topic = String(topicInput?.value || "").trim();
    const secondSessionId = String(sourceSelect?.value || "").trim();
    if (!topic) return showError("Enter the shared topic, for example WWW / frontend.");
    if (!secondSessionId) return showError("Choose the second source conversation.");

    const second = sessionSummaries.find((item) => item.sessionId === secondSessionId);
    if (!second) return showError("The selected conversation is no longer available.");

    createButton.disabled = true;
    createButton.textContent = "Creating…";
    try {
      const response = await fetch("/api/chat/shared-rooms", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          topic,
          participants: [
            {
              sourceSessionId: currentSession.sessionId,
              role: roleValue()
            },
            {
              sourceSessionId: secondSessionId,
              role: String(secondRole?.value || "GENERAL")
            }
          ]
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `HTTP_${response.status}`);

      try { localStorage.setItem(SESSION_KEY, payload.sessionId); } catch {}
      dialog?.close?.();
      if (typeof window.koordynatorLoadChatSession === "function") {
        await window.koordynatorLoadChatSession(payload.sessionId);
      } else {
        location.reload();
      }
    } catch (error) {
      showError(error instanceof Error ? error.message : "SHARED_ROOM_CREATE_FAILED");
    } finally {
      createButton.disabled = false;
      createButton.textContent = "Create shared room";
    }
  }

  async function refreshCurrent() {
    const id = activeSessionId();
    if (!id) return;
    const session = await fetchSession(id);
    if (!session) return;
    currentSession = session;
    renderRoomBar(session);
  }

  addButton?.addEventListener("click", () => void openDialog());
  createButton?.addEventListener("click", () => void createRoom());
  window.addEventListener("koordynator:chat-session-loaded", (event) => {
    currentSession = event.detail || null;
    renderRoomBar(currentSession);
  });

  void refreshCurrent();
})();
