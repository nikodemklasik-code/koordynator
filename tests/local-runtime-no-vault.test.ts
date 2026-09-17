import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const LOCAL = ["src/control", "src/runtime", "src/cli", "src/engine", "src/orchestrator", "src/api"];
const VAULT = /vault-overlay-contract|vault-secret-source|resolveVaultOnlySecret|VAULT_ADDR_NEW|chooseVaultAuth/;

async function tsFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) out.push(...await tsFiles(path));
    else if (entry.name.endsWith(".ts")) out.push(path);
  }
  return out;
}

describe("Local Mac runtime does not talk to Vault", () => {
  it("Control/Hermes/engine never import the VPS Vault overlay", async () => {
    const hits: string[] = [];
    for (const dir of LOCAL) {
      for (const file of await tsFiles(dir)) {
        const text = await readFile(file, "utf8");
        if (VAULT.test(text)) hits.push(file);
      }
    }
    expect(hits).toEqual([]);
  });
});
