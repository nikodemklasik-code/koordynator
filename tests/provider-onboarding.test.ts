import { describe, expect, it } from "vitest";
import {
  VerificationActivationService,
  extractAllowlistedActivation,
  providerOnboardingPlan,
  type VerificationInboxPort
} from "../src/control/provider-onboarding.js";

describe("providerOnboardingPlan", () => {
  it("allows only ordinary no-auth refreshes to be automated", () => {
    expect(providerOnboardingPlan({
      family: "opencode-free",
      connectAction: "RETRY",
      connectCommand: "No upstream login required; refresh the OmniRoute catalog."
    })).toMatchObject({
      mode: "NO_AUTH",
      automation: "AUTO_SAFE",
      antiBotBypass: false,
      multiAccountEvasion: false,
      syntheticIdentity: false
    });
  });

  it("keeps OAuth and API-key onboarding behind approval", () => {
    expect(providerOnboardingPlan({
      family: "gemini",
      connectAction: "AUTH",
      connectCommand: "omniroute oauth start --provider gemini-cli"
    })).toMatchObject({
      mode: "OAUTH",
      automation: "USER_APPROVAL",
      nextAction: "OPEN_OFFICIAL_OAUTH"
    });

    expect(providerOnboardingPlan({
      family: "qoder",
      connectAction: "CONNECT",
      connectCommand: "Use a Qoder PAT"
    })).toMatchObject({
      mode: "API_KEY",
      automation: "USER_APPROVAL",
      nextAction: "WAIT_FOR_OPERATOR_API_KEY"
    });
  });
});

describe("verification activation", () => {
  it("extracts only activation links from an explicit provider host allowlist", () => {
    const result = extractAllowlistedActivation({
      messageId: "m1",
      to: "operator@example.test",
      from: "provider@example.test",
      subject: "Verify",
      text: "Ignore https://tracker.bad.test/x and open https://accounts.example.com/activate?token=abc"
    }, ["accounts.example.com"]);

    expect(result?.host).toBe("accounts.example.com");
    expect(result?.url).toContain("/activate?token=abc");
  });

  it("does not auto-open an allowlisted link without approval", async () => {
    let opened = 0;
    const inbox: VerificationInboxPort = {
      poll: async () => [{
        messageId: "m2",
        to: "operator@example.test",
        from: "provider@example.test",
        subject: "Verify",
        text: "https://accounts.example.com/activate?token=xyz"
      }],
      markProcessed: async () => undefined
    };

    const service = new VerificationActivationService(inbox, {
      open: async () => {
        opened += 1;
        return { ok: true, status: 200 };
      }
    });

    const result = await service.processOne(["accounts.example.com"], false);
    expect(result.status).toBe("APPROVAL_REQUIRED");
    expect(opened).toBe(0);
  });

  it("marks a message processed only after an approved successful activation", async () => {
    let marked = 0;
    const inbox: VerificationInboxPort = {
      poll: async () => [{
        messageId: "m3",
        to: "operator@example.test",
        from: "provider@example.test",
        subject: "Verify",
        text: "https://accounts.example.com/activate?token=xyz"
      }],
      markProcessed: async () => { marked += 1; }
    };

    const service = new VerificationActivationService(inbox, {
      open: async () => ({ ok: true, status: 200, detail: "verified" })
    });

    const result = await service.processOne(["accounts.example.com"], true);
    expect(result.status).toBe("PASS");
    expect(marked).toBe(1);
  });
});
