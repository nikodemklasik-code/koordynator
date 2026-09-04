import { readFile } from "node:fs/promises";
const value = JSON.parse(await readFile("dist/module.json", "utf8"));
if (value.id !== "hello-module") process.exit(2);
if (value.message !== "hello from koordynator") process.exit(3);
if (!Array.isArray(value.capabilities) || value.capabilities[0] !== "ai.reasoning") process.exit(4);
