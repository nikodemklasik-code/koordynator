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
