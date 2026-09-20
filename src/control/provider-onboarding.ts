export type ProviderOnboardingMode =
  | "NO_AUTH"
  | "OAUTH"
  | "ACCOUNT"
  | "API_KEY"
  | "MANUAL";

export type ProviderOnboardingAutomation =
  | "AUTO_SAFE"
  | "USER_APPROVAL";

export type ProviderOnboardingPlan = {
  mode: ProviderOnboardingMode;
  automation: ProviderOnboardingAutomation;
  nextAction: string;
  verificationEmailSupported: boolean;
  allowlistedActivationOnly: true;
  antiBotBypass: false;
  multiAccountEvasion: false;
  syntheticIdentity: false;
};

export type ProviderRouteForOnboarding = {
  family?: string;
  label?: string;
  health?: string;
  connectAction?: string;
  connectCommand?: string;
  detail?: string;
};

function lower(value: unknown): string {
  return String(value ?? "").toLowerCase();
}

/**
 * Converts a provider route into a safe onboarding plan.
 *
 * Deliberately excluded:
 * - stealth / "undetected" browser modes
 * - CAPTCHA or anti-bot bypass
 * - synthetic identities
 * - catch-all multi-account rotation intended to evade provider limits
 *
 * Account creation and activation may only use the provider's ordinary supported
 * flow and remain behind explicit operator approval.
 */
export function providerOnboardingPlan(route: ProviderRouteForOnboarding): ProviderOnboardingPlan {
  const action = String(route.connectAction ?? "").toUpperCase();
  const command = lower(route.connectCommand);
  const detail = lower(route.detail);

  if (
    action === "READY"
    || action === "RETRY"
    || command.includes("no upstream login required")
  ) {
    return {
      mode: "NO_AUTH",
      automation: "AUTO_SAFE",
      nextAction: action === "READY" ? "USE_EXISTING_ROUTE" : "REFRESH_AND_PROBE",
      verificationEmailSupported: false,
      allowlistedActivationOnly: true,
      antiBotBypass: false,
      multiAccountEvasion: false,
      syntheticIdentity: false
    };
  }

  if (
    action === "AUTH"
    || action === "OPEN"
    || command.includes("oauth start")
    || detail.includes("oauth")
  ) {
    return {
      mode: "OAUTH",
      automation: "USER_APPROVAL",
      nextAction: "OPEN_OFFICIAL_OAUTH",
      verificationEmailSupported: false,
      allowlistedActivationOnly: true,
      antiBotBypass: false,
      multiAccountEvasion: false,
      syntheticIdentity: false
    };
  }

  if (
    command.includes("api key")
    || command.includes("apikey")
    || command.includes("pat")
    || detail.includes("api key")
  ) {
    return {
      mode: "API_KEY",
      automation: "USER_APPROVAL",
      nextAction: "WAIT_FOR_OPERATOR_API_KEY",
      verificationEmailSupported: false,
      allowlistedActivationOnly: true,
      antiBotBypass: false,
      multiAccountEvasion: false,
      syntheticIdentity: false
    };
  }

  if (
    action === "CONNECT"
    || detail.includes("account")
    || detail.includes("sign up")
    || detail.includes("signup")
    || detail.includes("register")
  ) {
    return {
      mode: "ACCOUNT",
      automation: "USER_APPROVAL",
      nextAction: "OPEN_OFFICIAL_SIGNUP",
      verificationEmailSupported: true,
      allowlistedActivationOnly: true,
      antiBotBypass: false,
      multiAccountEvasion: false,
      syntheticIdentity: false
    };
  }

  return {
    mode: "MANUAL",
    automation: "USER_APPROVAL",
    nextAction: "REVIEW_PROVIDER_ONBOARDING",
    verificationEmailSupported: false,
    allowlistedActivationOnly: true,
    antiBotBypass: false,
    multiAccountEvasion: false,
    syntheticIdentity: false
  };
}

export type VerificationMessage = {
  messageId: string;
  to: string;
  from: string;
  subject: string;
  text: string;
  html?: string;
};

export type VerificationInboxPort = {
  /**
   * Return new verification candidates. Implementations may use Gmail, IMAP,
   * or another operator-authorized mailbox. Credentials stay in that adapter.
   */
  poll(): Promise<VerificationMessage[]>;
  markProcessed(messageId: string): Promise<void>;
};

export type VerificationActivation = {
  messageId: string;
  url: string;
  host: string;
};

function urls(value: string): string[] {
  return value.match(/https?:\/\/[^\s"'<>]+/gi) ?? [];
}

/**
 * Deterministically extracts an activation URL only when its host is on the
 * provider allowlist. This avoids sending mailbox contents to an LLM and blocks
 * arbitrary links from being auto-opened.
 */
export function extractAllowlistedActivation(
  message: VerificationMessage,
  allowedHosts: string[]
): VerificationActivation | null {
  const allow = new Set(
    allowedHosts
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean)
  );

  if (!allow.size) return null;

  for (const raw of [...urls(message.text), ...urls(message.html ?? "")]) {
    try {
      const parsed = new URL(raw.replace(/&amp;/g, "&"));
      const host = parsed.hostname.toLowerCase();
      if (!allow.has(host)) continue;
      return {
        messageId: message.messageId,
        url: parsed.toString(),
        host
      };
    } catch {
      // Ignore malformed links. No best-effort navigation.
    }
  }

  return null;
}

export type ActivationExecutorPort = {
  open(url: string): Promise<{ ok: boolean; status?: number; detail?: string }>;
};

export class VerificationActivationService {
  constructor(
    private readonly inbox: VerificationInboxPort,
    private readonly executor: ActivationExecutorPort
  ) {}

  /**
   * Activation remains approval-gated even for an allowlisted host.
   * The caller must tie allowedHosts to the provider onboarding record.
   */
  async processOne(allowedHosts: string[], approved: boolean): Promise<{
    status: "NO_MESSAGE" | "APPROVAL_REQUIRED" | "NO_ALLOWLISTED_LINK" | "PASS" | "FAIL";
    activation?: VerificationActivation;
    detail?: string;
  }> {
    const messages = await this.inbox.poll();
    const message = messages[0];
    if (!message) return { status: "NO_MESSAGE" };

    const activation = extractAllowlistedActivation(message, allowedHosts);
    if (!activation) {
      return { status: "NO_ALLOWLISTED_LINK", detail: "No activation URL matched the provider allowlist." };
    }

    if (approved !== true) {
      return { status: "APPROVAL_REQUIRED", activation };
    }

    const result = await this.executor.open(activation.url);
    if (result.ok) {
      await this.inbox.markProcessed(message.messageId);
      return { status: "PASS", activation, detail: result.detail };
    }

    return {
      status: "FAIL",
      activation,
      detail: result.detail ?? (result.status ? `HTTP ${result.status}` : "Activation failed")
    };
  }
}
