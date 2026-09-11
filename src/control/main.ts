#!/usr/bin/env node
import { resolve } from "node:path";
import { createControlServer } from "./server.js";
import { VERSION } from "../version.js";
import { loadLocalConfig, omniRouteSettings } from "../runtime/local-config.js";

loadLocalConfig();
const route = omniRouteSettings();

function port(): number {
  const value = Number(process.env.KOORDYNATOR_CONTROL_PORT ?? "8787");
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error("INVALID_CONTROL_PORT");
  return value;
}

const host = process.env.KOORDYNATOR_CONTROL_HOST ?? "127.0.0.1";
const loopback = host === "127.0.0.1" || host === "::1" || host === "localhost";
const controlToken = process.env.KOORDYNATOR_CONTROL_TOKEN?.trim() || undefined;
if (!loopback && !controlToken) throw new Error("CONTROL_TOKEN_REQUIRED_FOR_NON_LOOPBACK");

const server = createControlServer({
  stateDir: resolve(process.env.KOORDYNATOR_STATE_DIR ?? ".orchestrator"),
  ...(process.env.KOORDYNATOR_WEB_ROOT === undefined ? {} : { webRoot: resolve(process.env.KOORDYNATOR_WEB_ROOT) }),
  ...(process.env.KOORDYNATOR_ENVIRONMENT === undefined ? {} : { environment: process.env.KOORDYNATOR_ENVIRONMENT }),
  ...(process.env.KOORDYNATOR_REGION === undefined ? {} : { region: process.env.KOORDYNATOR_REGION }),
  ...(process.env.KOORDYNATOR_ZONE === undefined ? {} : { zone: process.env.KOORDYNATOR_ZONE }),
  ...(process.env.KOORDYNATOR_OPERATOR === undefined ? {} : { operator: process.env.KOORDYNATOR_OPERATOR }),
  chatEndpoint: route.endpoint,
  ...(controlToken === undefined ? {} : { controlToken }),
  chatAllowRepositoryExecution: process.env.KOORDYNATOR_CHAT_REPO_EXECUTION === "1",
  chatAllowGithubContext: process.env.KOORDYNATOR_CHAT_GITHUB_CONTEXT === "1",
  chatApiKeyEnv: "OMNIROUTE_API_KEY",
  chatDefaultModel: route.model,
  ciVerify: process.env.KOORDYNATOR_CI_VERIFY === "PASS" ? "PASS" : process.env.KOORDYNATOR_CI_VERIFY === "FAIL" ? "FAIL" : "UNKNOWN",
  version: process.env.KOORDYNATOR_VERSION ?? VERSION
});

server.listen(port(), host, () => {
  process.stdout.write(`KOORDYNATOR_CONTROL http://${host}:${port()}\n`);
});
