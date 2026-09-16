#!/usr/bin/env node
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import process from "node:process";

const root = resolve(import.meta.dirname, "..");
const keeper = spawn(process.execPath, [resolve(root, "scripts", "omniroute-keeper.mjs")], {
  cwd: root,
  env: process.env,
  detached: true,
  stdio: "ignore"
});
keeper.unref();

const requested = process.argv.slice(2);
const hermesArgs = requested[0] === "hermes" ? requested.slice(1) : requested;

const child = spawn(process.execPath, [
  resolve(root, "dist", "runtime", "main.js"),
  "hermes",
  ...hermesArgs
], {
  cwd: root,
  env: process.env,
  stdio: "inherit",
  shell: false
});

child.once("error", () => {
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
