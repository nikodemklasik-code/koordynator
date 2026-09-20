import { randomUUID } from "node:crypto";

export type GrowthChannelKind =
  | "EMAIL"
  | "PARTNERSHIP"
  | "COMMUNITY"
  | "CONTENT"
  | "SEARCH"
  | "EVENT"
  | "DIRECTORY"
  | "MARKETPLACE"
  | "AFFILIATE"
  | "OUTBOUND"
  | "INBOUND"
  | "CUSTOM";

export type ChannelOpportunity = {
  channelId: string;
  kind: GrowthChannelKind;
  name: string;
  hypothesis: string;
  targetAudience: string;
  evidenceRefs: string[];
  expectedValue: number;
  expectedCost: number;
  confidence: number;
  status: "DISCOVERED" | "RESEARCHING" | "READY_FOR_EXPERIMENT" | "ACTIVE" | "REJECTED" | "PAUSED";
  createdAt: string;
  updatedAt: string;
};

export type ContactRecord = {
  contactId: string;
  organization?: string;
  name?: string;
  email?: string;
  sourceRef: string;
  lawfulBasisRef?: string;
  consentRef?: string;
  relevance: string;
  status: "DISCOVERED" | "VERIFIED" | "DO_NOT_CONTACT" | "CONTACTABLE";
  evidenceRefs: string[];
  createdAt: string;
  updatedAt: string;
};

export type MarketingPolicy = {
  policyId: string;
  name: string;
  objectives: string[];
  targetSegments: string[];
  permittedChannels: GrowthChannelKind[];
  prohibitedClaims: string[];
  evidenceRequiredForClaims: boolean;
  legalReviewRequiredForExternalClaims: boolean;
  financeReviewThreshold: number;
  createdAt: string;
  updatedAt: string;
};

export type OutreachCampaign = {
  campaignId: string;
  policyId: string;
  channelId: string;
  name: string;
  objective: string;
  audienceDefinition: string;
  messageArtifactRef?: string;
  contactIds: string[];
  status: "DRAFT" | "REVIEW" | "READY" | "RUNNING" | "PAUSED" | "DONE" | "BLOCKED";
  externalAuthorisationRef?: string;
  legalReviewRef?: string;
  qcReviewRef?: string;
  financeReviewRef?: string;
  createdAt: string;
  updatedAt: string;
};

export type OutreachExecution = {
  executionId: string;
  campaignId: string;
  contactId: string;
  action: "SEND_EMAIL" | "SEND_MESSAGE" | "CREATE_LEAD" | "BOOK_FOLLOWUP";
  status: "PLANNED" | "AUTHORISED" | "EXECUTED" | "BLOCKED";
  externalAuthorisationRef?: string;
  receiptRef?: string;
};

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function iso(): string {
  return new Date().toISOString();
}

export class GrowthOperations {
  private readonly channels = new Map<string, ChannelOpportunity>();
  private readonly contacts = new Map<string, ContactRecord>();
  private readonly policies = new Map<string, MarketingPolicy>();
  private readonly campaigns = new Map<string, OutreachCampaign>();

  createPolicy(input: Omit<MarketingPolicy, "policyId" | "createdAt" | "updatedAt">): MarketingPolicy {
    const at = iso();
    const policy: MarketingPolicy = {
      ...input,
      policyId: `MKTPOL-${randomUUID().slice(0, 10).toUpperCase()}`,
      objectives: [...new Set(input.objectives)],
      targetSegments: [...new Set(input.targetSegments)],
      permittedChannels: [...new Set(input.permittedChannels)],
      prohibitedClaims: [...new Set(input.prohibitedClaims)],
      createdAt: at,
      updatedAt: at
    };
    this.policies.set(policy.policyId, policy);
    return structuredClone(policy);
  }

  discoverChannel(input: Omit<ChannelOpportunity, "channelId" | "status" | "createdAt" | "updatedAt">): ChannelOpportunity {
    const at = iso();
    const channel: ChannelOpportunity = {
      ...input,
      channelId: `CHANNEL-${randomUUID().slice(0, 10).toUpperCase()}`,
      evidenceRefs: [...new Set(input.evidenceRefs)],
      expectedValue: clamp(input.expectedValue),
      expectedCost: clamp(input.expectedCost),
      confidence: clamp(input.confidence),
      status: "DISCOVERED",
      createdAt: at,
      updatedAt: at
    };
    this.channels.set(channel.channelId, channel);
    return structuredClone(channel);
  }

  registerContact(input: Omit<ContactRecord, "contactId" | "status" | "createdAt" | "updatedAt"> & {
    status?: ContactRecord["status"];
  }): ContactRecord {
    const at = iso();
    const contact: ContactRecord = {
      ...input,
      contactId: `CONTACT-${randomUUID().slice(0, 10).toUpperCase()}`,
      status: input.status ?? "DISCOVERED",
      evidenceRefs: [...new Set(input.evidenceRefs)],
      createdAt: at,
      updatedAt: at
    };
    this.contacts.set(contact.contactId, contact);
    return structuredClone(contact);
  }

  createCampaign(input: Omit<OutreachCampaign, "campaignId" | "status" | "createdAt" | "updatedAt">): OutreachCampaign {
    if (!this.policies.has(input.policyId)) throw new Error("GROWTH_POLICY_NOT_FOUND");
    const channel = this.channels.get(input.channelId);
    if (!channel) throw new Error("GROWTH_CHANNEL_NOT_FOUND");

    const policy = this.policies.get(input.policyId)!;
    if (!policy.permittedChannels.includes(channel.kind)) {
      throw new Error("GROWTH_CHANNEL_NOT_PERMITTED_BY_POLICY");
    }

    input.contactIds.forEach((contactId) => {
      if (!this.contacts.has(contactId)) throw new Error("GROWTH_CONTACT_NOT_FOUND");
    });

    const at = iso();
    const campaign: OutreachCampaign = {
      ...input,
      campaignId: `CAMPAIGN-${randomUUID().slice(0, 10).toUpperCase()}`,
      contactIds: [...new Set(input.contactIds)],
      status: "DRAFT",
      createdAt: at,
      updatedAt: at
    };
    this.campaigns.set(campaign.campaignId, campaign);
    return structuredClone(campaign);
  }

  markCampaignReviewed(input: {
    campaignId: string;
    legalReviewRef?: string;
    qcReviewRef?: string;
    financeReviewRef?: string;
  }): OutreachCampaign {
    const campaign = this.requireCampaign(input.campaignId);
    const policy = this.policies.get(campaign.policyId)!;

    if (policy.legalReviewRequiredForExternalClaims && !input.legalReviewRef) {
      throw new Error("GROWTH_LEGAL_REVIEW_REQUIRED");
    }
    if (!input.qcReviewRef) throw new Error("GROWTH_QC_REVIEW_REQUIRED");

    campaign.legalReviewRef = input.legalReviewRef;
    campaign.qcReviewRef = input.qcReviewRef;
    campaign.financeReviewRef = input.financeReviewRef;
    campaign.status = "READY";
    campaign.updatedAt = iso();
    return structuredClone(campaign);
  }

  authoriseCampaign(campaignId: string, externalAuthorisationRef: string): OutreachCampaign {
    const campaign = this.requireCampaign(campaignId);
    if (campaign.status !== "READY") throw new Error("GROWTH_CAMPAIGN_NOT_READY");
    if (!externalAuthorisationRef.trim()) throw new Error("GROWTH_EXTERNAL_AUTHORISATION_REQUIRED");
    campaign.externalAuthorisationRef = externalAuthorisationRef.trim();
    campaign.updatedAt = iso();
    return structuredClone(campaign);
  }

  planExecution(input: {
    campaignId: string;
    contactId: string;
    action: OutreachExecution["action"];
  }): OutreachExecution {
    const campaign = this.requireCampaign(input.campaignId);
    const contact = this.contacts.get(input.contactId);
    if (!contact) throw new Error("GROWTH_CONTACT_NOT_FOUND");
    if (!campaign.contactIds.includes(input.contactId)) throw new Error("GROWTH_CONTACT_NOT_IN_CAMPAIGN");

    const externallyEffective = ["SEND_EMAIL", "SEND_MESSAGE", "BOOK_FOLLOWUP"].includes(input.action);
    if (externallyEffective) {
      if (!campaign.externalAuthorisationRef) {
        return {
          executionId: `OUTREACH-${randomUUID().slice(0, 10).toUpperCase()}`,
          campaignId: campaign.campaignId,
          contactId: contact.contactId,
          action: input.action,
          status: "BLOCKED"
        };
      }
      if (!["VERIFIED", "CONTACTABLE"].includes(contact.status)) {
        return {
          executionId: `OUTREACH-${randomUUID().slice(0, 10).toUpperCase()}`,
          campaignId: campaign.campaignId,
          contactId: contact.contactId,
          action: input.action,
          status: "BLOCKED",
          externalAuthorisationRef: campaign.externalAuthorisationRef
        };
      }
    }

    return {
      executionId: `OUTREACH-${randomUUID().slice(0, 10).toUpperCase()}`,
      campaignId: campaign.campaignId,
      contactId: contact.contactId,
      action: input.action,
      status: externallyEffective ? "AUTHORISED" : "PLANNED",
      ...(campaign.externalAuthorisationRef === undefined
        ? {}
        : { externalAuthorisationRef: campaign.externalAuthorisationRef })
    };
  }

  snapshot() {
    return {
      policies: [...this.policies.values()].map((item) => structuredClone(item)),
      channels: [...this.channels.values()].map((item) => structuredClone(item)),
      contacts: [...this.contacts.values()].map((item) => structuredClone(item)),
      campaigns: [...this.campaigns.values()].map((item) => structuredClone(item))
    };
  }

  private requireCampaign(campaignId: string): OutreachCampaign {
    const campaign = this.campaigns.get(campaignId);
    if (!campaign) throw new Error("GROWTH_CAMPAIGN_NOT_FOUND");
    return campaign;
  }
}
