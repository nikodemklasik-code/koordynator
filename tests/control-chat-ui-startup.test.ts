import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

class FakeElement {
  dataset: Record<string, string> = {};
  disabled = false;
  value = "";
  title = "";
  className = "";
  children: FakeElement[] = [];
  private _textContent = "";

  constructor(readonly tagName = "div") {}

  get textContent(): string { return this._textContent; }
  set textContent(value: string) {
    this._textContent = value;
    if (value === "") this.children = [];
  }

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }

  addEventListener(): void {}
}

describe("Live Chat browser startup", () => {
  it("holds session creation until an executable model route is loaded", async () => {
    const source = await readFile(new URL("../web/control/chat-models.js", import.meta.url), "utf8");
    let releaseCatalog!: () => void;
    const catalogReleased = new Promise<void>((resolve) => { releaseCatalog = resolve; });
    const sessionBodies: Array<Record<string, unknown>> = [];

    const modelSelect = new FakeElement("select");
    modelSelect.disabled = true;
    const billingNote = new FakeElement();
    const billingBadge = new FakeElement();
    const sendButton = new FakeElement("button");
    sendButton.disabled = true;
    const messageInput = new FakeElement("textarea");

    const nativeFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const path = new URL(url, "http://127.0.0.1:8787").pathname;
      if (path === "/api/chat/models") {
        await catalogReleased;
        return new Response(JSON.stringify({
          models: ["cc/claude-sonnet-5"],
          entries: [{
            id: "cc/claude-sonnet-5",
            name: "claude-sonnet-5",
            provider: "claude-code",
            family: "ANTHROPIC",
            transport: "OMNIROUTE_OAUTH",
            subscriptionHarnessUsed: true,
            billingSource: "SUBSCRIPTION_HARNESS"
          }],
          billing: {
            modelSources: { "cc/claude-sonnet-5": "SUBSCRIPTION_HARNESS" },
            modelRoutes: {
              "cc/claude-sonnet-5": {
                provider: "claude-code",
                family: "ANTHROPIC",
                transport: "OMNIROUTE_OAUTH",
                subscriptionHarnessUsed: true,
                billingSource: "SUBSCRIPTION_HARNESS"
              }
            }
          }
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (path === "/api/health") {
        return new Response(JSON.stringify({
          paidApiAllowedByDefault: false,
          unknownBillingAllowedByDefault: false,
          unconfirmedFreeAllowedByDefault: false
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (path === "/api/chat/sessions" && String(init?.method || "GET").toUpperCase() === "POST") {
        sessionBodies.push(JSON.parse(String(init?.body || "{}")) as Record<string, unknown>);
        return new Response(JSON.stringify({ sessionId: "00000000-0000-4000-8000-000000000000" }), {
          status: 201,
          headers: { "content-type": "application/json" }
        });
      }
      return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
    };

    const document = {
      getElementById(id: string) {
        return ({ modelSelect, billingBadge, sendButton, messageInput } as Record<string, FakeElement>)[id] ?? null;
      },
      querySelector(selector: string) { return selector === ".composer-note" ? billingNote : null; },
      createElement(tag: string) { return new FakeElement(tag); },
      addEventListener() {}
    };
    class FakeMutationObserver {
      constructor(_callback: () => void) {}
      observe(): void {}
    }
    class FakeCustomEvent {
      constructor(readonly type: string, readonly init?: unknown) {}
    }
    const windowObject: Record<string, unknown> = {
      fetch: nativeFetch,
      location: { href: "http://127.0.0.1:8787/chat" },
      dispatchEvent() {}
    };
    const context = vm.createContext({
      window: windowObject,
      document,
      localStorage: { getItem: () => null },
      MutationObserver: FakeMutationObserver,
      CustomEvent: FakeCustomEvent,
      Request,
      Response,
      URL,
      console
    });

    vm.runInContext(source, context, { filename: "chat-models.js" });

    const gatedFetch = windowObject.fetch as typeof fetch;
    const pendingSession = gatedFetch("/api/chat/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "" })
    });

    await Promise.resolve();
    expect(sessionBodies).toHaveLength(0);

    releaseCatalog();
    const response = await pendingSession;
    expect(response.status).toBe(201);
    expect(sessionBodies).toEqual([{ model: "cc/claude-sonnet-5" }]);
    expect(modelSelect.dataset.catalog).toBe("omniroute");
    expect(modelSelect.value).toBe("cc/claude-sonnet-5");
    expect(modelSelect.disabled).toBe(false);
  });

  it("does not self-write disabled=true inside the mutation guard", async () => {
    const source = await readFile(new URL("../web/control/chat-models.js", import.meta.url), "utf8");
    expect(source).toContain("!chatSendButton.disabled");
    expect(source).toContain("!chatModelSelect.disabled");
    expect(source).toContain("const modelSet = new Set(models)");
  });
});
