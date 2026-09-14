# Normal chat and manual roles

Normal startup uses direct model streaming and a JSON-lines adapter importing Hermes model_tools, never its CLI or AIAgent. Existing terminal grants are checked before file/terminal calls; role selection does not grant access. Skills are discovered by the installed Hermes registry. Missing tools produce an explicit message in the same chat and leave text conversation available.

Roles are loaded from repository roles/contracts/skills and local .agents/.hermes/.codex skill roots. Source files remain unchanged. Derived chat instructions remove workflow blocks and apply an ad hoc conversation policy. Bundled role descriptions derive from the owner's conversation and Harmonia_Kanon_Rol.pdf, not a claim that all local contracts were inspected.

Each Markdown contract can specify models: ["exact/provider-model-id"] in frontmatter. Ordered explicit assignments are shown first; otherwise the UI labels catalog suggestions as heuristic. No model is silently changed. All local roles cannot be certified present until the local catalog has been checked. Role selection persists per conversation. Reopening the conversation restores it.

Install: npm ci && npm run build. Start: npm run start:all.
If Hermes Python cannot be detected, set KOORDYNATOR_HERMES_PYTHON to its venv/bin/python. This Python environment must import model_tools. API compatibility was inspected against NousResearch/hermes-agent commit de2d6a1b. Installed extensions and credentials still need a local smoke test.

Validation: npm run verify. New tests cover procedural-contract adaptation, tool/result continuation, incomplete-stream side-effect rejection, and session-local error persistence. CI results, not this document, determine test status.
Limitations: direct bridge exposes installed skills_list/skill_view and granted core file/terminal tools, not all Hermes integrations. It does not claim terminal parity for image tool results. These are remaining live integration cases.
