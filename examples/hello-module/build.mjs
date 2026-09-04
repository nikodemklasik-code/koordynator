import { mkdir, readFile, writeFile } from "node:fs/promises";
const manifest = JSON.parse(await readFile("module-manifest.json", "utf8"));
await mkdir("dist", { recursive: true });
await writeFile("dist/module.json", JSON.stringify({
  id: manifest.id,
  version: manifest.version,
  capabilities: manifest.requires.capabilities,
  message: "hello from koordynator"
}));
