#!/usr/bin/env node
import { resolve } from "node:path";
import { createControlServer } from "./server.js";

function port(): number {
  const value = Number(process.env.KOORDYNATOR_CONTROL_PORT ?? "8787");
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error("INVALID_CONTROL_PORT");
  return value;
}

const host = process.env.KOORDYNATOR_CONTROL_HOST ?? "127.0.0.1";
const server = createControlServer({
  stateDir: resolve(process.env.KOORDYNATOR_STATE_DIR ?? ".orchestrator"),
  ...(process.env.KOORDYNATOR_WEB_ROOT === undefined ? {} : { webRoot: resolve(process.env.KOORDYNATOR_WEB_ROOT) }),
  ...(process.env.KOORDYNATOR_ENVIRONMENT === undefined ? {} : { environment: process.env.KOORDYNATOR_ENVIRONMENT }),
  ...(process.env.KOORDYNATOR_REGION === undefined ? {} : { region: process.env.KOORDYNATOR_REGION }),
  ...(process.env.KOORDYNATOR_ZONE === undefined ? {} : { zone: process.env.KOORDYNATOR_ZONE }),
  ...(process.env.KOORDYNATOR_OPERATOR === undefined ? {} : { operator: process.env.KOORDYNATOR_OPERATOR }),
  ciVerify: process.env.KOORDYNATOR_CI_VERIFY === "PASS" ? "PASS" : process.env.KOORDYNATOR_CI_VERIFY === "FAIL" ? "FAIL" : "UNKNOWN",
  version: process.env.KOORDYNATOR_VERSION ?? "0.1.0"
});

server.listen(port(), host, () => {
  process.stdout.write(`KOORDYNATOR_CONTROL http://${host}:${port()}\n`);
});
