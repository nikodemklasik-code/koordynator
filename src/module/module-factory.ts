import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export type ModuleFactorySpec = {
  moduleId: string;
  targetDir: string;
  capabilities: string[];
};

export type GeneratedModule = {
  root: string;
  files: string[];
};

function assertModuleId(moduleId: string): void {
  if (!/^[a-z][a-z0-9-]{1,62}$/.test(moduleId)) throw new Error("INVALID_MODULE_ID");
}

function uniqueCapabilities(values: string[]): string[] {
  const unique = [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
  if (unique.some((value) => !/^[a-z][a-z0-9.-]+$/.test(value))) throw new Error("INVALID_CAPABILITY_ID");
  return unique;
}

export async function generateModule(spec: ModuleFactorySpec): Promise<GeneratedModule> {
  assertModuleId(spec.moduleId);
  const capabilities = uniqueCapabilities(spec.capabilities);
  const root = resolve(spec.targetDir);
  const src = join(root, "src");
  const tests = join(root, "tests");
  await mkdir(src, { recursive: true, mode: 0o700 });
  await mkdir(tests, { recursive: true, mode: 0o700 });

  const manifest = {
    id: spec.moduleId,
    version: "0.1.0",
    core: { min: "0.1.1" },
    requires: { capabilities },
    permissions: capabilities,
    entry: "dist/module.json",
    health: { kind: "file", path: "dist/module.json" }
  };

  const platformTs = `export type CapabilityCall = {\n  capability: string;\n  input: unknown;\n  purposeId: string;\n};\n\nexport interface CapabilityApi {\n  execute<T = unknown>(request: CapabilityCall): Promise<T>;\n}\n`;
  const indexTs = `import type { CapabilityApi } from "./platform.js";\n\nexport async function run(platform: CapabilityApi, input: unknown): Promise<unknown> {\n  return platform.execute({ capability: ${JSON.stringify(capabilities[0] ?? "core.echo")}, input, purposeId: ${JSON.stringify(`${spec.moduleId}.run`)} });\n}\n`;
  const buildMjs = `import { mkdir, readFile, writeFile } from "node:fs/promises";\nconst manifest = JSON.parse(await readFile("module-manifest.json", "utf8"));\nawait mkdir("dist", { recursive: true });\nawait writeFile("dist/module.json", JSON.stringify({ id: manifest.id, version: manifest.version, capabilities: manifest.requires.capabilities }));\n`;
  const unitMjs = `import { readFile } from "node:fs/promises";\nconst x = JSON.parse(await readFile("dist/module.json", "utf8"));\nif (x.id !== ${JSON.stringify(spec.moduleId)} || !Array.isArray(x.capabilities)) process.exit(2);\n`;
  const securityMjs = `import { readFile } from "node:fs/promises";\nconst files = ["src/index.ts", "src/platform.ts", "module-manifest.json"];\nfor (const file of files) { const s = await readFile(file, "utf8"); if (/from\\s+["'](?:openai|@anthropic-ai|@google\\/generative-ai|@github\\/copilot)|require\\(["'](?:openai|@anthropic-ai|@google\\/generative-ai|@github\\/copilot)/i.test(s)) process.exit(3); }\n`;
  const pkg = {
    name: `@koordynator-module/${spec.moduleId}`,
    version: "0.1.0",
    private: true,
    type: "module",
    scripts: { build: "node build.mjs", test: "node tests/unit.mjs", security: "node tests/security.mjs" }
  };

  const files: Array<[string, string]> = [
    ["module-manifest.json", `${JSON.stringify(manifest, null, 2)}\n`],
    ["package.json", `${JSON.stringify(pkg, null, 2)}\n`],
    ["src/platform.ts", platformTs],
    ["src/index.ts", indexTs],
    ["build.mjs", buildMjs],
    ["tests/unit.mjs", unitMjs],
    ["tests/security.mjs", securityMjs]
  ];
  for (const [relativePath, content] of files) await writeFile(join(root, relativePath), content, { encoding: "utf8", mode: 0o600, flag: "wx" });
  return { root, files: files.map(([path]) => path) };
}
