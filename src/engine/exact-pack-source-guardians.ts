import { spawn } from "node:child_process";
import { canonicalDigest } from "../crypto/canonical-digest.js";
import type { MaterializationOrder } from "./autonomous-recovery.js";
import type { GuardianComparator, GuardianComparison, MaterializationResult } from "./materialization-loop.js";
import type { OrchestratorRunRequest } from "../orchestrator/orchestrator.js";
import { ExactPackAgentMaterializer } from "./exact-pack-agent-materializer.js";

export type SourceQc1Spec = {
  name: string;
  command: string;
  args: string[];
  proposedSolution: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  envAllowList?: string[];
};

type CommandOutcome = {
  code: number;
  timedOut: boolean;
  outputExceeded: boolean;
};

async function runCommand(spec: SourceQc1Spec, cwd: string): Promise<CommandOutcome> {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: cwd,
    TMPDIR: cwd,
    KOORDYNATOR_PREBUILD_QC: "1"
  };
  for (const key of spec.envAllowList ?? []) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }

  return await new Promise((resolve) => {
    const child = spawn(spec.command, spec.args, {
      cwd,
      env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let size = 0;
    let timedOut = false;
    let outputExceeded = false;
    const limit = spec.maxOutputBytes ?? 1024 * 1024;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, spec.timeoutMs ?? 60_000);
    const collect = (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        outputExceeded = true;
        child.kill("SIGKILL");
      }
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ code: 1, timedOut: false, outputExceeded: false });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, timedOut, outputExceeded });
    });
  });
}

function qcFailureKind(outcome: CommandOutcome): string {
  if (outcome.timedOut) return "przekroczony czas kontroli";
  if (outcome.outputExceeded) return "przekroczony limit wyjścia kontroli";
  return "niezaliczona kontrola źródła";
}

export class ExactPackSourceGuardians implements GuardianComparator<OrchestratorRunRequest> {
  constructor(
    private readonly sourceDir: string,
    private readonly materializer: ExactPackAgentMaterializer,
    private readonly qc1: SourceQc1Spec[]
  ) {
    if (qc1.length === 0) throw new Error("PREBUILD_QC1_REQUIRED");
    for (const spec of qc1) {
      if (!spec.name.trim()) throw new Error("PREBUILD_QC1_NAME_REQUIRED");
      if (!spec.command.trim()) throw new Error(`PREBUILD_QC1_COMMAND_REQUIRED:${spec.name}`);
      if (!spec.proposedSolution.trim()) throw new Error(`PREBUILD_QC1_SOLUTION_REQUIRED:${spec.name}`);
    }
  }

  async compare(
    order: Readonly<MaterializationOrder>,
    result: Readonly<MaterializationResult<OrchestratorRunRequest>>
  ): Promise<GuardianComparison> {
    const record = this.materializer.records().at(-1);
    let opposing: GuardianComparison["opposing"];

    if (!record) {
      opposing = {
        value: 0,
        issue: {
          element: order.taskId,
          location: "materializacja",
          kind: "brak historii wykonania",
          expected: "dokładny zapis materializacji",
          actual: "brak zapisu",
          detectedBy: "Zespół przeciwny"
        },
        reason: "Nie ma dowodu, że Agent wykonał dokładnie dostarczoną paczkę.",
        proposedSolution: "Wykonaj materializację ponownie z pełnym zapisem paczki i fingerprintów."
      };
    } else if (record.sourceAfterFp !== result.artifact.buildVector.sourceFp || record.receipts.length === 0) {
      opposing = {
        value: 0,
        issue: {
          element: order.taskId,
          location: "materializacja",
          kind: "wynik nie odpowiada drodze wykonania",
          expected: record.sourceAfterFp,
          actual: result.artifact.buildVector.sourceFp,
          detectedBy: "Zespół przeciwny"
        },
        reason: "Wynik przekazany do kontroli nie odpowiada zapisanej materializacji dokładnej paczki.",
        proposedSolution: "Ponownie zastosuj dokładną paczkę i przekaż wynik zmierzony bezpośrednio po zapisie."
      };
    } else {
      opposing = { value: 1 };
    }

    for (const spec of this.qc1) {
      const outcome = await runCommand(spec, this.sourceDir);
      if (outcome.code !== 0 || outcome.timedOut || outcome.outputExceeded) {
        return {
          opposing,
          qc1: {
            value: 0,
            issue: {
              element: order.taskId,
              location: `prebuild:${spec.name}`,
              kind: qcFailureKind(outcome),
              expected: "exit 0",
              actual: outcome.timedOut ? "timeout" : outcome.outputExceeded ? "output-limit" : `exit ${outcome.code}`,
              detectedBy: "QC1"
            },
            reason: `Kontrola przed buildem nie została zaliczona: ${spec.name}.`,
            proposedSolution: spec.proposedSolution
          }
        };
      }
    }

    return { opposing, qc1: { value: 1 } };
  }

  definitionFp(): ReturnType<typeof canonicalDigest> {
    return canonicalDigest({
      kind: "exact-pack-source-guardians-v1",
      qc1: this.qc1.map((spec) => ({
        name: spec.name,
        command: spec.command,
        args: spec.args,
        proposedSolution: spec.proposedSolution,
        timeoutMs: spec.timeoutMs ?? 60_000,
        maxOutputBytes: spec.maxOutputBytes ?? 1024 * 1024,
        envAllowList: [...(spec.envAllowList ?? [])].sort()
      }))
    });
  }
}
