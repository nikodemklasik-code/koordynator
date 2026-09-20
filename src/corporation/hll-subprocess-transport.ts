import { spawn } from "node:child_process";
import type {
  HllAuthorityRequest,
  HllAuthorityResponse,
  HllAuthorityTransport
} from "./hll-authority-adapter.js";

export type HllSubprocessCommand = {
  executable: string;
  args: string[];
  cwd?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
};

function cleanCommand(input: HllSubprocessCommand): Required<Omit<HllSubprocessCommand, "cwd">> & { cwd?: string } {
  const executable = input.executable.trim();
  if (!executable) throw new Error("HLL_AUTHORITY_EXECUTABLE_REQUIRED");
  if (input.args.some((arg) => arg.includes("\0"))) throw new Error("HLL_AUTHORITY_ARG_INVALID");

  return {
    executable,
    args: [...input.args],
    timeoutMs: Math.max(1_000, Math.min(input.timeoutMs ?? 30_000, 120_000)),
    maxOutputBytes: Math.max(4_096, Math.min(input.maxOutputBytes ?? 2_000_000, 10_000_000)),
    ...(input.cwd === undefined ? {} : { cwd: input.cwd })
  };
}

/**
 * Cross-language transport to the authoritative HLL Engine.
 *
 * Security properties:
 * - no shell;
 * - fixed argv supplied by trusted runtime configuration;
 * - JSON request on stdin;
 * - bounded stdout/stderr;
 * - hard timeout;
 * - non-zero exit is fail-closed;
 * - exactly one JSON object is accepted as authority response.
 */
export class SubprocessHllAuthorityTransport implements HllAuthorityTransport {
  private readonly command: ReturnType<typeof cleanCommand>;

  constructor(command: HllSubprocessCommand) {
    this.command = cleanCommand(command);
  }

  async assess(request: HllAuthorityRequest): Promise<HllAuthorityResponse> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.command.executable, this.command.args, {
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        ...(this.command.cwd === undefined ? {} : { cwd: this.command.cwd }),
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          LANG: process.env.LANG,
          LC_ALL: process.env.LC_ALL,
          PYTHONUNBUFFERED: "1"
        }
      });

      let stdout = Buffer.alloc(0);
      let stderr = Buffer.alloc(0);
      let settled = false;

      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.kill("SIGKILL");
        reject(error);
      };

      const timer = setTimeout(() => {
        fail(new Error("HLL_AUTHORITY_TIMEOUT"));
      }, this.command.timeoutMs);

      const append = (current: Buffer, chunk: Buffer, stream: "stdout" | "stderr"): Buffer => {
        const next = Buffer.concat([current, chunk]);
        if (next.length > this.command.maxOutputBytes) {
          fail(new Error(`HLL_AUTHORITY_${stream.toUpperCase()}_LIMIT_EXCEEDED`));
          return current;
        }
        return next;
      };

      child.stdout.on("data", (chunk: Buffer) => {
        stdout = append(stdout, chunk, "stdout");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = append(stderr, chunk, "stderr");
      });
      child.on("error", (error) => fail(error));

      child.on("close", (code, signal) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);

        if (code !== 0) {
          reject(new Error(
            `HLL_AUTHORITY_PROCESS_FAILED:code=${code ?? "null"}:signal=${signal ?? "null"}:${stderr.toString("utf8").trim().slice(0, 4000)}`
          ));
          return;
        }

        const text = stdout.toString("utf8").trim();
        if (!text) {
          reject(new Error("HLL_AUTHORITY_EMPTY_RESPONSE"));
          return;
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          reject(new Error("HLL_AUTHORITY_INVALID_JSON"));
          return;
        }

        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          reject(new Error("HLL_AUTHORITY_RESPONSE_NOT_OBJECT"));
          return;
        }

        resolve(parsed as HllAuthorityResponse);
      });

      child.stdin.on("error", (error) => fail(error));
      child.stdin.end(`${JSON.stringify(request)}\n`, "utf8");
    });
  }
}

export function hllSubprocessCommandFromEnv(
  env: NodeJS.ProcessEnv = process.env
): HllSubprocessCommand {
  const raw = env.CORPORATION_HLL_AUTHORITY_COMMAND_JSON;
  if (!raw) throw new Error("CORPORATION_HLL_AUTHORITY_COMMAND_JSON_REQUIRED");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("CORPORATION_HLL_AUTHORITY_COMMAND_JSON_INVALID");
  }

  if (!Array.isArray(parsed) || !parsed.length || parsed.some((item) => typeof item !== "string")) {
    throw new Error("CORPORATION_HLL_AUTHORITY_COMMAND_JSON_INVALID");
  }

  const [executable, ...args] = parsed as string[];
  if (!executable) throw new Error("HLL_AUTHORITY_EXECUTABLE_REQUIRED");

  return {
    executable,
    args,
    ...(env.CORPORATION_HLL_AUTHORITY_CWD ? { cwd: env.CORPORATION_HLL_AUTHORITY_CWD } : {})
  };
}
