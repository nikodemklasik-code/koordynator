export type StudioCapability = "image" | "video" | "voice" | "frontend";

export type StudioProviderStatus = {
  capability: StudioCapability;
  providerId: string;
  label: string;
  model: string;
  state: "READY" | "NOT_CONFIGURED" | "ROUTED";
  source: "environment" | "omniroute";
  detail: string;
};

function configured(...names: string[]): boolean {
  return names.some((name) => Boolean(process.env[name]?.trim()));
}

export function studioProviderCatalog(frontendModels: string[] = []): StudioProviderStatus[] {
  const imageReady = configured("OPENAI_API_KEY", "KOORDYNATOR_IMAGE_PROVIDER");
  const videoReady = configured("FAL_KEY", "VEED_API_KEY", "KOORDYNATOR_VIDEO_PROVIDER");
  const voiceReady = configured("ELEVENLABS_API_KEY", "HARMONIA_ELEVEN_API_KEY");
  const frontendReady = frontendModels.length > 0;

  return [
    {
      capability: "image",
      providerId: "openai-image",
      label: "OpenAI Image",
      model: process.env.KOORDYNATOR_IMAGE_MODEL?.trim() || "gpt-image-2.5-sunburst",
      state: imageReady ? "READY" : "NOT_CONFIGURED",
      source: "environment",
      detail: imageReady
        ? "Image provider binding is configured for generation/edit workflows."
        : "Set OPENAI_API_KEY or KOORDYNATOR_IMAGE_PROVIDER to enable image execution."
    },
    {
      capability: "video",
      providerId: "veed-fabric",
      label: "VEED Fabric",
      model: process.env.KOORDYNATOR_VIDEO_MODEL?.trim() || "veed/fabric-1.0",
      state: videoReady ? "READY" : "NOT_CONFIGURED",
      source: "environment",
      detail: videoReady
        ? "VEED/Fabric provider binding is configured for video workflows."
        : "Set FAL_KEY, VEED_API_KEY or KOORDYNATOR_VIDEO_PROVIDER to enable video execution."
    },
    {
      capability: "voice",
      providerId: "elevenlabs",
      label: "ElevenLabs",
      model: process.env.ELEVENLABS_MODEL?.trim() || "eleven_multilingual_v2",
      state: voiceReady ? "READY" : "NOT_CONFIGURED",
      source: "environment",
      detail: voiceReady
        ? "ElevenLabs voice catalogue and TTS are available through Control."
        : "Set ELEVENLABS_API_KEY or HARMONIA_ELEVEN_API_KEY to enable voice generation."
    },
    {
      capability: "frontend",
      providerId: "omniroute",
      label: "OmniRoute model fabric",
      model: frontendModels[0] || "working-set",
      state: frontendReady ? "ROUTED" : "NOT_CONFIGURED",
      source: "omniroute",
      detail: frontendReady
        ? `${frontendModels.length} executable frontend-capable model routes available.`
        : "No executable model route is currently available."
    }
  ];
}

export function elevenLabsKey(): string {
  return process.env.ELEVENLABS_API_KEY?.trim()
    || process.env.HARMONIA_ELEVEN_API_KEY?.trim()
    || "";
}
