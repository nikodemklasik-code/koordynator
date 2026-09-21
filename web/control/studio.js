(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const panels = [...document.querySelectorAll("[data-studio-panel]")];
  const tabs = [...document.querySelectorAll("[data-studio-tab]")];
  const providerList = $("studioProviderList");
  const connection = $("studioConnection");
  const providers = new Map();
  let imageOutput = null;
  let videoOutputUrl = null;
  let voiceOutputUrl = null;
  let studioContextSession = null;
  let studioContextSelectedIds = new Set();

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("load", () => resolve(String(reader.result || "")), { once: true });
      reader.addEventListener("error", () => reject(reader.error || new Error("FILE_READ_FAILED")), { once: true });
      reader.readAsDataURL(file);
    });
  }

  function eligibleContextMessages(session) {
    return (Array.isArray(session?.messages) ? session.messages : []).filter((message) =>
      message && (message.role === "user" || message.role === "assistant") && String(message.content || "").trim()
    );
  }

  function selectedContextMessages() {
    return eligibleContextMessages(studioContextSession).filter((message) => studioContextSelectedIds.has(message.id));
  }

  function attachmentContext(message) {
    if (!$("studioContextAttachments")?.checked) return [];
    return (Array.isArray(message.attachments) ? message.attachments : []).map((attachment) => {
      const text = String(attachment.extractedText || "").trim();
      return text ? `[ZAŁĄCZNIK: ${attachment.name || "plik"}]\n${text}` : `[ZAŁĄCZNIK: ${attachment.name || "plik"} · treść niedostępna]`;
    });
  }

  function contextText() {
    const selected = selectedContextMessages();
    if (!selected.length) return "";
    return selected.map((message) => {
      const who = message.role === "user" ? "UŻYTKOWNIK" : (message.agentLabel || "AI");
      const attachments = attachmentContext(message);
      return [`[${who}]`, String(message.content || "").trim(), ...attachments].filter(Boolean).join("\n");
    }).join("\n\n");
  }

  function promptWithContext(brief) {
    const context = contextText();
    const clean = String(brief || "").trim();
    if (!context) return clean;
    return [
      "OPIS / POLECENIE UŻYTKOWNIKA:",
      clean,
      "",
      "WYBRANE ELEMENTY ROZMOWY — użyj jako kontekstu, nie kopiuj mechanicznie:",
      context
    ].join("\n");
  }

  function renderContextSummary() {
    const summary = $("studioContextSummary");
    if (!summary) return;
    if (!studioContextSession) {
      summary.textContent = "Brak wybranej rozmowy. Generator użyje tylko opisu z bieżącego ekranu.";
      return;
    }
    const selected = selectedContextMessages();
    const attachments = selected.reduce((total, message) => total + (Array.isArray(message.attachments) ? message.attachments.length : 0), 0);
    summary.textContent = `${studioContextSession.title || "Rozmowa"} · ${selected.length} wybranych wiadomości${$("studioContextAttachments")?.checked ? ` · ${attachments} załączników` : " · załączniki wyłączone"}`;
  }

  function renderContextDialog() {
    const root = $("studioContextMessages");
    if (!root) return;
    root.replaceChildren();
    const messages = eligibleContextMessages(studioContextSession);
    messages.forEach((message, index) => {
      const row = document.createElement("label");
      row.className = "studio-context-message";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = studioContextSelectedIds.has(message.id);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) studioContextSelectedIds.add(message.id);
        else studioContextSelectedIds.delete(message.id);
        $("studioContextCount").textContent = `${studioContextSelectedIds.size} wybranych`;
      });
      const body = document.createElement("span");
      const who = document.createElement("strong");
      who.textContent = `${index + 1}. ${message.role === "user" ? "TY" : (message.agentLabel || "AI")}`;
      const text = document.createElement("span");
      text.textContent = String(message.content || "").replace(/\s+/g, " ").slice(0, 360);
      body.append(who, text);
      if (Array.isArray(message.attachments) && message.attachments.length) {
        const files = document.createElement("small");
        files.textContent = `${message.attachments.length} załącznik${message.attachments.length === 1 ? "" : "i"}`;
        body.appendChild(files);
      }
      row.append(checkbox, body);
      root.appendChild(row);
    });
    $("studioContextCount").textContent = `${studioContextSelectedIds.size} wybranych`;
  }

  async function loadStudioSessions() {
    const select = $("studioContextSession");
    if (!select) return;
    const previous = select.value;
    try {
      const response = await fetch("/api/chat/sessions?limit=100", { headers: { accept: "application/json" } });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `HTTP_${response.status}`);
      const sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
      select.replaceChildren();
      const empty = document.createElement("option");
      empty.value = "";
      empty.textContent = "Bez kontekstu z czatu";
      select.appendChild(empty);
      for (const session of sessions) {
        const option = document.createElement("option");
        option.value = session.sessionId;
        option.textContent = `${session.title || "Bez tytułu"} · ${session.messageCount || 0} wiad.`;
        select.appendChild(option);
      }
      if ([...select.options].some((option) => option.value === previous)) select.value = previous;
    } catch (error) {
      select.innerHTML = '<option value="">Historia czatów niedostępna</option>';
      $("studioContextSummary").textContent = error instanceof Error ? error.message : "CHAT_HISTORY_UNAVAILABLE";
    }
  }

  async function selectStudioSession(sessionId) {
    studioContextSession = null;
    studioContextSelectedIds.clear();
    if (!sessionId) {
      renderContextSummary();
      return;
    }
    const response = await fetch(`/api/chat/sessions/${encodeURIComponent(sessionId)}`, { headers: { accept: "application/json" } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      $("studioContextSummary").textContent = payload.error || `HTTP_${response.status}`;
      return;
    }
    studioContextSession = payload;
    renderContextSummary();
  }

  function setConnection(text, state = "") {
    if (!connection) return;
    connection.textContent = text;
    connection.className = state;
  }

  function activateTab(name) {
    tabs.forEach((button) => {
      const active = button.dataset.studioTab === name;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    panels.forEach((panel) => panel.classList.toggle("active", panel.dataset.studioPanel === name));
    document.querySelector(`.studio-provider-card[data-capability="${CSS.escape(name)}"]`)?.scrollIntoView({ block: "nearest" });
  }

  tabs.forEach((button) => button.addEventListener("click", () => activateTab(button.dataset.studioTab)));

  function providerState(provider) {
    return provider?.state || "NOT_CONFIGURED";
  }

  function providerReady(capability) {
    const state = providerState(providers.get(capability));
    return state === "READY" || state === "ROUTED";
  }

  function renderBindings() {
    for (const [capability, provider] of providers) {
      const binding = document.querySelector(`[data-provider-binding="${capability}"]`);
      if (binding) {
        binding.textContent = `${provider.label} · ${provider.model} · ${provider.state}`;
        binding.classList.toggle("ready", providerReady(capability));
        binding.title = provider.detail || "";
      }
      const model = $(`${capability}Model`);
      if (model && "value" in model && capability !== "frontend") model.value = provider.model || "";
    }

    const imageGenerate = $("imageGenerate");
    if (imageGenerate) {
      imageGenerate.disabled = !providerReady("image");
      imageGenerate.title = imageGenerate.disabled ? "Configure the OpenAI image provider first." : "Generate through the configured OpenAI image provider.";
    }

    const videoGenerate = $("videoGenerate");
    const videoProcess = $("videoProcess");
    if (videoGenerate) {
      videoGenerate.disabled = !providerReady("video");
      videoGenerate.title = videoGenerate.disabled
        ? "Configure FAL_KEY to enable VEED Fabric."
        : "Generate a VEED Fabric talking video from the first selected image and the direction text.";
    }
    if (videoProcess) {
      videoProcess.disabled = true;
      videoProcess.title = "Source-processing workflows remain separate from Fabric generation.";
    }

    const voiceGenerate = $("voiceGenerate");
    if (voiceGenerate) voiceGenerate.disabled = !providerReady("voice");
  }

  function renderProviderList() {
    if (!providerList) return;
    providerList.replaceChildren();
    for (const provider of providers.values()) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "studio-provider-card";
      card.dataset.capability = provider.capability;
      card.dataset.state = provider.state;
      card.innerHTML = "<header><strong></strong><span class=\"state\"></span></header><code></code><p></p>";
      card.querySelector("strong").textContent = provider.label;
      card.querySelector(".state").textContent = provider.state;
      card.querySelector("code").textContent = provider.model;
      card.querySelector("p").textContent = provider.detail;
      card.addEventListener("click", () => activateTab(provider.capability));
      providerList.appendChild(card);
    }
  }

  async function loadProviders() {
    setConnection("CHECKING PROVIDERS");
    try {
      const response = await fetch("/api/studio/providers", { headers: { accept: "application/json" } });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `HTTP_${response.status}`);
      providers.clear();
      for (const provider of Array.isArray(payload.providers) ? payload.providers : []) providers.set(provider.capability, provider);
      renderProviderList();
      renderBindings();
      setConnection("CONNECTED", "ok");
      await Promise.all([loadVoices(), loadFrontendModels()]);
    } catch (error) {
      setConnection(error instanceof Error ? error.message : "PROVIDER_ERROR", "error");
    }
  }

  async function loadVoices() {
    const select = $("voiceSelect");
    if (!select) return;
    if (!providerReady("voice")) {
      select.innerHTML = '<option value="">ElevenLabs not configured</option>';
      return;
    }
    select.innerHTML = '<option value="">Loading voices…</option>';
    try {
      const response = await fetch("/api/studio/voice/voices", { headers: { accept: "application/json" } });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `HTTP_${response.status}`);
      const voices = Array.isArray(payload.voices) ? payload.voices : [];
      select.replaceChildren();
      for (const voice of voices) {
        const option = document.createElement("option");
        option.value = voice.voiceId;
        option.textContent = voice.category ? `${voice.name} · ${voice.category}` : voice.name;
        option.dataset.previewUrl = voice.previewUrl || "";
        select.appendChild(option);
      }
      if (!voices.length) select.innerHTML = '<option value="">No voices returned</option>';
    } catch (error) {
      select.innerHTML = '<option value="">Voice catalogue unavailable</option>';
      $("voiceTruth").textContent = error instanceof Error ? error.message : "Voice catalogue unavailable";
    }
  }

  async function loadFrontendModels() {
    const select = $("frontendModel");
    if (!select) return;
    try {
      const response = await fetch("/api/chat/models", { headers: { accept: "application/json" } });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `HTTP_${response.status}`);
      const models = Array.isArray(payload.models) ? payload.models : [];
      select.replaceChildren();
      for (const model of models) {
        const option = document.createElement("option");
        option.value = model;
        option.textContent = model;
        select.appendChild(option);
      }
      if (!models.length) select.innerHTML = '<option value="">No executable models</option>';
    } catch {
      select.innerHTML = '<option value="">Model catalogue unavailable</option>';
    }
  }

  $("refreshStudioProviders")?.addEventListener("click", () => void loadProviders());
  $("voiceRefresh")?.addEventListener("click", () => void loadVoices());

  $("studioContextSession")?.addEventListener("change", (event) => void selectStudioSession(event.target.value));
  $("studioContextAttachments")?.addEventListener("change", renderContextSummary);
  $("studioContextChoose")?.addEventListener("click", () => {
    if (!studioContextSession) {
      $("studioContextSummary").textContent = "Najpierw wybierz rozmowę.";
      return;
    }
    renderContextDialog();
    $("studioContextDialog")?.showModal?.();
  });
  $("studioContextSelectAll")?.addEventListener("click", () => {
    studioContextSelectedIds = new Set(eligibleContextMessages(studioContextSession).map((message) => message.id));
    renderContextDialog();
  });
  $("studioContextSelectNone")?.addEventListener("click", () => {
    studioContextSelectedIds.clear();
    renderContextDialog();
  });
  $("studioContextApply")?.addEventListener("click", () => {
    $("studioContextDialog")?.close?.();
    renderContextSummary();
  });
  $("studioContextClear")?.addEventListener("click", () => {
    studioContextSession = null;
    studioContextSelectedIds.clear();
    if ($("studioContextSession")) $("studioContextSession").value = "";
    renderContextSummary();
  });

  $("imageInput")?.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const preview = $("imagePreview");
    preview.replaceChildren();
    const image = new Image();
    image.alt = file.name;
    image.src = url;
    image.onload = () => URL.revokeObjectURL(url);
    preview.appendChild(image);
    $("imagePreviewState").textContent = "Source loaded";
  });

  $("imageGenerate")?.addEventListener("click", async () => {
    const rawPrompt = String($("imagePrompt")?.value || "").trim();
    const prompt = promptWithContext(rawPrompt);
    if (!rawPrompt) {
      $("imageTruth").textContent = "Add an image prompt first.";
      return;
    }
    const button = $("imageGenerate");
    button.disabled = true;
    $("imagePreviewState").textContent = "Generating…";
    $("imageTruth").textContent = "Sending prompt through the configured OpenAI image provider.";
    try {
      const response = await fetch("/api/studio/image/generate", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          prompt,
          model: $("imageModel")?.value || "gpt-image-2.5-sunburst",
          size: "1024x1024",
          quality: "medium"
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `HTTP_${response.status}`);
      const src = payload.dataUrl || payload.url;
      if (!src) throw new Error("IMAGE_RESULT_EMPTY");
      imageOutput = src;
      const preview = $("imagePreview");
      preview.replaceChildren();
      const image = new Image();
      image.src = src;
      image.alt = "Generated image";
      preview.appendChild(image);
      $("imagePreviewState").textContent = "Generated";
      $("imageTruth").textContent = "Generated by the configured OpenAI image provider.";
    } catch (error) {
      $("imagePreviewState").textContent = "Failed";
      $("imageTruth").textContent = error instanceof Error ? error.message : "Image generation failed";
    } finally {
      button.disabled = !providerReady("image");
    }
  });

  $("imageEdit")?.addEventListener("click", () => {
    $("imageTruth").textContent = "Reference-image editing remains separate from generation. Load a source image above; the edit transport will use the image edit endpoint in the next adapter revision.";
  });

  $("imageExport")?.addEventListener("click", () => {
    if (!imageOutput) return;
    const link = document.createElement("a");
    link.href = imageOutput;
    link.download = "studio-image.png";
    link.click();
  });

  $("voiceGenerate")?.addEventListener("click", async () => {
    const text = String($("voiceText")?.value || "").trim();
    const voiceId = $("voiceSelect")?.value || "";
    if (!text || !voiceId) {
      $("voiceTruth").textContent = "Enter text and choose an ElevenLabs voice.";
      return;
    }
    const button = $("voiceGenerate");
    button.disabled = true;
    $("voicePreviewState").textContent = "Synthesizing…";
    try {
      const response = await fetch("/api/studio/voice/tts", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "audio/mpeg" },
        body: JSON.stringify({ text, voiceId, modelId: $("voiceModel")?.value || "eleven_multilingual_v2" })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || `HTTP_${response.status}`);
      }
      const blob = await response.blob();
      if (voiceOutputUrl) URL.revokeObjectURL(voiceOutputUrl);
      voiceOutputUrl = URL.createObjectURL(blob);
      $("voicePlayer").src = voiceOutputUrl;
      $("voiceMeta").textContent = `${$("voiceSelect").selectedOptions?.[0]?.textContent || "Voice"} · ${$("voiceModel").value}`;
      $("voicePreviewState").textContent = "Ready";
      $("voiceTruth").textContent = "Audio generated through ElevenLabs.";
      await $("voicePlayer").play().catch(() => {});
    } catch (error) {
      $("voicePreviewState").textContent = "Failed";
      $("voiceTruth").textContent = error instanceof Error ? error.message : "Voice generation failed";
    } finally {
      button.disabled = !providerReady("voice");
    }
  });

  $("voiceExport")?.addEventListener("click", () => {
    if (!voiceOutputUrl) return;
    const link = document.createElement("a");
    link.href = voiceOutputUrl;
    link.download = "studio-voice.mp3";
    link.click();
  });

  function updateFrontendPreview() {
    const code = String($("frontendCode")?.value || "");
    $("frontendFrame").srcdoc = code || "<!doctype html><html><body style='font-family:system-ui;padding:32px'><h1>Frontend preview</h1><p>Paste HTML/CSS in the editor.</p></body></html>";
    $("frontendPreviewState").textContent = code ? "Updated" : "Empty prototype";
  }

  $("frontendPreview")?.addEventListener("click", updateFrontendPreview);
  $("frontendCode")?.addEventListener("input", () => {
    clearTimeout(window.__studioPreviewTimer);
    window.__studioPreviewTimer = setTimeout(updateFrontendPreview, 180);
  });
  $("frontendExportHtml")?.addEventListener("click", () => {
    const code = String($("frontendCode")?.value || "");
    if (!code) return;
    const url = URL.createObjectURL(new Blob([code], { type: "text/html" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "studio-frontend.html";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  $("frontendOpenChat")?.addEventListener("click", () => {
    const brief = promptWithContext(String($("frontendPrompt")?.value || "").trim());
    try { sessionStorage.setItem("koordynator.studio.frontendBrief", brief); } catch {}
    window.location.href = "/chat?studio=frontend";
  });

  $("videoInput")?.addEventListener("change", (event) => {
    const files = [...(event.target.files || [])];
    const images = files.filter((file) => String(file.type || "").startsWith("image/"));
    $("videoPreviewState").textContent = files.length ? `${files.length} source file${files.length === 1 ? "" : "s"} loaded` : "No output";
    $("videoTruth").textContent = providerReady("video")
      ? (images.length ? "VEED Fabric is ready. The first image will be animated from your direction and selected chat context." : "VEED Fabric needs at least one image source.")
      : "Configure FAL_KEY before video execution.";
  });

  $("videoGenerate")?.addEventListener("click", async () => {
    const rawPrompt = String($("videoPrompt")?.value || "").trim();
    const prompt = promptWithContext(rawPrompt);
    const files = [...($("videoInput")?.files || [])];
    const imageFile = files.find((file) => String(file.type || "").startsWith("image/"));
    if (!rawPrompt) {
      $("videoTruth").textContent = "Add a video direction first.";
      return;
    }
    if (!imageFile) {
      $("videoTruth").textContent = "Add an image source for VEED Fabric.";
      return;
    }
    const button = $("videoGenerate");
    button.disabled = true;
    $("videoPreviewState").textContent = "Generating…";
    $("videoTruth").textContent = "Sending image + direction to VEED Fabric through the server-side fal.ai adapter.";
    try {
      const imageDataUrl = await fileToDataUrl(imageFile);
      const response = await fetch("/api/studio/video/generate", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ prompt, imageDataUrl, resolution: "720p" })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `HTTP_${response.status}`);
      if (!payload.url) throw new Error("VIDEO_RESULT_EMPTY");
      videoOutputUrl = payload.url;
      const preview = $("videoPreview");
      preview.replaceChildren();
      const video = document.createElement("video");
      video.src = videoOutputUrl;
      video.controls = true;
      video.playsInline = true;
      preview.appendChild(video);
      $("videoPreviewState").textContent = "Ready";
      $("videoTruth").textContent = "Video generated through VEED Fabric.";
    } catch (error) {
      $("videoPreviewState").textContent = "Failed";
      $("videoTruth").textContent = error instanceof Error ? error.message : "Video generation failed";
    } finally {
      button.disabled = !providerReady("video");
    }
  });

  $("videoExport")?.addEventListener("click", () => {
    if (!videoOutputUrl) {
      $("videoTruth").textContent = "There is no rendered video to export yet.";
      return;
    }
    const link = document.createElement("a");
    link.href = videoOutputUrl;
    link.download = "studio-video.mp4";
    link.target = "_blank";
    link.rel = "noopener";
    link.click();
  });

  updateFrontendPreview();
  renderContextSummary();
  void Promise.all([loadProviders(), loadStudioSessions()]);
})();
