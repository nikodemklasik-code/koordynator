(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const panels = [...document.querySelectorAll("[data-studio-panel]")];
  const tabs = [...document.querySelectorAll("[data-studio-tab]")];
  const providerList = $("studioProviderList");
  const connection = $("studioConnection");
  const providers = new Map();
  let imageOutput = null;
  let voiceOutputUrl = null;

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

  tabs.forEach((button) => button.addEventListener("click", () => {
    const tab = button.dataset.studioTab;
    activateTab(tab);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    history.replaceState(null, "", url);
  }));

  const requestedTab = new URLSearchParams(window.location.search).get("tab");
  if (requestedTab && panels.some((panel) => panel.dataset.studioPanel === requestedTab)) {
    activateTab(requestedTab);
  }

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
    for (const button of [videoGenerate, videoProcess]) {
      if (!button) continue;
      button.disabled = true;
      button.title = providerReady("video")
        ? "VEED/Fabric binding is configured; the queued execution adapter is not exposed in this Control build yet."
        : "Configure FAL_KEY / VEED provider first.";
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
    const prompt = String($("imagePrompt")?.value || "").trim();
    if (!prompt) {
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
    const brief = String($("frontendPrompt")?.value || "").trim();
    try { sessionStorage.setItem("koordynator.studio.frontendBrief", brief); } catch {}
    window.location.href = "/chat?studio=frontend";
  });

  $("videoInput")?.addEventListener("change", (event) => {
    const files = [...(event.target.files || [])];
    $("videoPreviewState").textContent = files.length ? `${files.length} source file${files.length === 1 ? "" : "s"} loaded` : "No output";
    $("videoTruth").textContent = providerReady("video")
      ? "VEED/Fabric provider is configured. Source files are staged in the Studio UI; queued execution remains fail-closed until the server adapter is enabled."
      : "Configure FAL_KEY / VEED provider before video execution.";
  });

  $("videoExport")?.addEventListener("click", () => {
    $("videoTruth").textContent = "There is no rendered video to export yet.";
  });

  updateFrontendPreview();
  void loadProviders();
})();
