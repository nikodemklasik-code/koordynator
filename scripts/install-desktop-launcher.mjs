#!/usr/bin/env node
import { chmodSync, existsSync, lstatSync, readlinkSync, renameSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const source = resolve(root, "scripts", "Koordynator-Start.command");
const desktop = join(homedir(), "Desktop");
const destination = join(desktop, "Koordynator-Start.command");

chmodSync(source, 0o755);

if (existsSync(destination)) {
  const stat = lstatSync(destination);
  if (stat.isSymbolicLink()) {
    const target = resolve(desktop, readlinkSync(destination));
    if (target === source) {
      console.log(`DESKTOP_LAUNCHER=READY ${destination}`);
      process.exit(0);
    }
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = `${destination}.backup-${stamp}`;
  renameSync(destination, backup);
  console.log(`Existing launcher backed up: ${backup}`);
}

symlinkSync(source, destination);
console.log(`DESKTOP_LAUNCHER=INSTALLED ${destination}`);
console.log("The Desktop launcher now follows the repo script, so startup improvements do not require recopying the icon.");
