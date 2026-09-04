import { readFile } from "node:fs/promises";
for (const file of ["src/index.ts", "src/platform.ts", "module-manifest.json"]) {
  const source = await readFile(file, "utf8");
  if (/from\s+["'](?:openai|@anthropic-ai|@google\/generative-ai|@github\/copilot)|require\(["'](?:openai|@anthropic-ai|@google\/generative-ai|@github\/copilot)/i.test(source)) process.exit(3);
  if (/api[_-]?key|secret|password/i.test(source)) process.exit(4);
}
