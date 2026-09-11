/**
 * Etap 0 zasilany z Live Chat. Harmonia czyta transkrypt sesji (samotne poznanie);
 * Mózg spisuje mapę dopiero po ALLOW. Żaden agent wykonawczy tu nie wchodzi.
 *
 * Źródłem jest rozmowa, nie osobne pole `project` — wklejony brief omijałby chat.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { BrainError, BrainRoadmapWriter, type Roadmap } from "./brain-roadmap.js";
import type { ChatAttachment, ChatSession } from "./chat-service.js";
import { ChatService, ChatServiceError } from "./chat-service.js";
import { HarmoniaCognition, HarmoniaError, type HarmoniaReading } from "./harmonia-cognition.js";

export type StageZeroRun = {
  sessionId: string;
  source: "chat";
  projectChars: number;
  reading: HarmoniaReading;
  /** Null dopóki brama Etapu 0 nie da ALLOW — ręka nie rusza. */
  roadmap: Roadmap | null;
  runAt: string;
};

export class StageZeroError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
    this.name = "StageZeroError";
  }
}

export type StageZeroOptions = {
  stateDir: string;
  chat: ChatService;
  /**
   * Model dla samotnego poznania Harmonii (Etap 0). Harmonia czyta na
   * najsilniejszym poznawczo modelu, niezależnie od modelu sesji chatu.
   * Gdy nieustawiony — fallback na model bieżącej sesji. Mózg (spisanie mapy)
   * zawsze jedzie na modelu sesji: to ręka, nie poznanie.
   */
  harmoniaModel?: string;
  endpoint?: string;
  apiKey?: string;
  apiKeyEnv?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

function attachmentText(attachments: ChatAttachment[] | undefined): string {
  if (!attachments?.length) return "";
  return attachments
    .map((item) => {
      const extracted = item.extractedText?.trim();
      if (!extracted) return "";
      return `[Załącznik: ${item.name}]\n${extracted}`;
    })
    .filter(Boolean)
    .join("\n\n");
}

/** Składa transkrypt sesji w materiał poznania. Puste / error-turny odpadają. */
export function sessionToProject(session: ChatSession): string {
  const parts: string[] = [];
  for (const message of session.messages) {
    if (message.state === "error" || message.state === "streaming") continue;
    const role = message.role === "user" ? "Użytkownik" : "Koordynator";
    const body = [message.content.trim(), attachmentText(message.attachments)].filter(Boolean).join("\n\n");
    if (!body) continue;
    parts.push(`${role}:\n${body}`);
  }
  return parts.join("\n\n").trim();
}

function runFile(root: string, sessionId: string): string {
  return join(resolve(root), "stage-zero", `${sessionId}.json`);
}

export class StageZeroService {
  constructor(private readonly options: StageZeroOptions) {}

  async get(sessionId: string): Promise<StageZeroRun | null> {
    const session = await this.options.chat.getSession(sessionId);
    if (!session) throw new StageZeroError("CHAT_SESSION_NOT_FOUND", 404);
    try {
      const raw = await readFile(runFile(this.options.stateDir, sessionId), "utf8");
      return JSON.parse(raw) as StageZeroRun;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async run(sessionId: string): Promise<StageZeroRun> {
    const session = await this.options.chat.getSession(sessionId);
    if (!session) throw new StageZeroError("CHAT_SESSION_NOT_FOUND", 404);
    if (session.messages.some((message) => message.state === "streaming")) {
      throw new StageZeroError("STAGE_ZERO_CHAT_BUSY", 409);
    }

    const project = sessionToProject(session);
    if (!project) throw new StageZeroError("STAGE_ZERO_NEEDS_INPUT", 400);

    const sessionModel = session.model;
    const shared = {
      ...(this.options.endpoint === undefined ? {} : { endpoint: this.options.endpoint }),
      ...(this.options.apiKey === undefined ? {} : { apiKey: this.options.apiKey }),
      ...(this.options.apiKeyEnv === undefined ? {} : { apiKeyEnv: this.options.apiKeyEnv }),
      ...(this.options.fetchImpl === undefined ? {} : { fetchImpl: this.options.fetchImpl }),
      ...(this.options.timeoutMs === undefined ? {} : { timeoutMs: this.options.timeoutMs })
    };
    // Harmonia poznaje na najsilniejszym modelu (pin przez env), fallback na sesję.
    const harmoniaModel = this.options.harmoniaModel?.trim() || sessionModel;

    let reading: HarmoniaReading;
    try {
      reading = await new HarmoniaCognition({ ...shared, model: harmoniaModel }).read(project);
    } catch (error) {
      if (error instanceof HarmoniaError) throw error;
      throw error;
    }

    let roadmap: Roadmap | null = null;
    if (reading.decision.status === "allow") {
      try {
        // Mózg spisuje mapę na modelu sesji — to ręka wykonawcza, nie poznanie.
        roadmap = await new BrainRoadmapWriter({ ...shared, model: sessionModel }).write(project, reading);
      } catch (error) {
        if (error instanceof BrainError) throw error;
        throw error;
      }
    }

    const run: StageZeroRun = {
      sessionId,
      source: "chat",
      projectChars: project.length,
      reading,
      roadmap,
      runAt: new Date().toISOString()
    };
    await this.persist(run);
    return run;
  }

  private async persist(run: StageZeroRun): Promise<void> {
    const target = runFile(this.options.stateDir, run.sessionId);
    await mkdir(resolve(this.options.stateDir, "stage-zero"), { recursive: true, mode: 0o700 });
    await writeFile(target, `${JSON.stringify(run, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  }
}

export function asStageZeroHttpError(error: unknown): StageZeroError | ChatServiceError | HarmoniaError | BrainError | null {
  if (error instanceof StageZeroError || error instanceof ChatServiceError || error instanceof HarmoniaError || error instanceof BrainError) {
    return error;
  }
  return null;
}
