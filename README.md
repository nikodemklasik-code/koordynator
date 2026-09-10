# Koordynator Orchestrator

Deterministic orchestration runtime with signed WorkOrders, provider routing, execution evidence and a local Control UI.

## Control UI

The local Control UI exposes task, release, provider and Live Chat surfaces. Live Chat now includes:

- persistent multi-turn chat sessions with a browsable history panel;
- file and image attachments via the `+` control, drag-and-drop and clipboard paste;
- bounded attachment validation on both browser and server boundaries;
- a dynamic model list loaded from the authenticated OmniRoute model catalog, with the built-in list retained only as a fallback when the catalog cannot be reached;
- GitHub repository connection status and explicit consent gating before `gh auth login` is started;
- reuse of an existing authenticated GitHub CLI session without repeated approval prompts;
- provider screens with independently scrollable content rather than viewport-expanding static rows.

Repository access and AI execution remain separate capabilities. `github-copilot-sub` is an AI provider seat; the GitHub repository connection uses the official `gh` CLI authentication flow. The browser never collects GitHub passwords, browser cookies or provider API keys.

## Provider commands

```bash
orchestrator provider doctor
orchestrator provider connect openai-codex-sub
orchestrator provider connect claude-code-sub
orchestrator provider connect gemini-cli-sub
orchestrator provider connect github-copilot-sub
```

Provider authentication is delegated to each provider's official CLI. Subscription credentials are not copied into the Control UI.

## Verification

The repository CI runs dependency audit, TypeScript checking, unit/integration tests, build verification, end-to-end smoke tests and golden-path checks.

Typical local verification:

```bash
npm ci --ignore-scripts
npm audit --audit-level=high
npm run typecheck
npm test
npm run build
npm run e2e
npm run golden
npm run provider-golden
```

## Safety boundary

Live Chat is a conversational surface. It does not bypass signed WorkOrders or the deterministic execution policy. Repository authentication only establishes the GitHub transport; write operations remain subject to the applicable orchestration and authorization rules.
