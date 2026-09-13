# Start with free routes

Stop the previous Control server, then run `npm run start:free` from the repository.
The command builds the current source, starts OmniRoute if necessary, reads its live
catalog and probes up to six catalog-confirmed free routes with a small tool call.
It saves a working primary and up to two working free fallbacks in `.env`, preserving
the other settings. Failed discovery leaves route settings unchanged and exits with
`FREE_ROUTE_UNAVAILABLE`; it does not start a subscription route. No vendor signup
or interactive authentication is started.

`KOORDYNATOR_FREE_ONLY=1` applies to the chat billing gate, every direct chat fallback,
Etap 0, Hermes inference proxy and OpenCode worker. The browser uses the same policy
and prefers the server default. OpenCode receives a temporary ticket through a custom
OpenAI-compatible provider; it no longer tries an unrelated hard-coded model list.
The provider setup follows the [OpenCode provider documentation](https://opencode.ai/docs/providers/)
and [runtime configuration precedence](https://opencode.ai/docs/config/).

The successful probe proves a tool call worked at startup. Billing labels come from
OmniRoute's catalog/pricing; they are not an independent audit of the provider's bill.
Quotas and availability can change. Unknown prices and free-looking names alone do
not qualify. Subsequent free-mode setup preserves this policy. To deliberately return
to configured subscription routes, run `KOORDYNATOR_FREE_ONLY=0 npm run ai:always-on`.

## Issue 40 status

Existing role bindings, mandate checks, write leases and advisory post-build reviews
remain. This change does not complete issue 40: isolated worktrees/sandboxes,
PostgreSQL/Redis/BullMQ execution infrastructure and independent verification on all
production paths remain outstanding. The tests use fixture workers and gateways;
they do not prove that the operator's 52 local skills or all provider accounts ran.

## Local V5 integration

The local snapshot `ee415d36b2338035b667fb68a342b962c8acc8cc` is merged with
`de1c562ae0d004323d27ce7f2fc620763b495d6e`, retaining the range selector for Etap 0,
large-upload limits, readable UI sizing, router drawer, materialisation readiness
and Control instance detection. The missing range dialog is restored in V5 HTML;
chat and Harmonia retain capacity fallback, including HTTP 504. Free-only billing
also applies to Harmonia's added fallback chain. Provider aliases identify families
but require live pricing evidence before they qualify as confirmed free.

Validation: `npm run verify` passed with 110 test files and 439 tests, plus
typecheck, build, e2e, golden and provider-golden checks. This is fixture-based
verification; live Mac account quotas and browser geometry still need local checks.
