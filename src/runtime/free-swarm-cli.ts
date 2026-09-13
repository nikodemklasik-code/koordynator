#!/usr/bin/env node
import { bootstrapFreeSwarm } from "./free-swarm.js";
import { loadLocalConfig } from "./local-config.js";

loadLocalConfig();

bootstrapFreeSwarm().catch(error => {
  const message = error instanceof Error ? error.message : "FREE_SWARM_FAILED";
  console.error(/^[A-Z][A-Z0-9_:]*$/.test(message) ? message : "FREE_SWARM_FAILED");
  process.exitCode = 1;
});
