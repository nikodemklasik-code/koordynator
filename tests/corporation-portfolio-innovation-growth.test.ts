import { describe, expect, it } from "vitest";
import { GrowthOperations } from "../src/corporation/growth-operations.js";
import { InnovationRadar } from "../src/corporation/innovation.js";
import { NoveltySourceRegistry } from "../src/corporation/novelty-sources.js";
import { defaultOrganizationModel } from "../src/corporation/organization.js";
import { CorporatePortfolio } from "../src/corporation/portfolio.js";
import { createApprovalReceipt } from "../src/corporation/receipts.js";
import type { HllDecision } from "../src/corporation/domain.js";

function ratified(statementId = "HLL-SIGNAL-1"): HllDecision {
  return {
    decisionId: `DEC-${statementId}`,
    statementId,
    truthState: "RATIFIED",
    verdict: "ALLOW",
    reasons: [],
    allowedBrainActions: ["corporation.absorb-innovation"],
    requiredAuthorisations: [],
    decidedAt: new Date().toISOString()
  };
}

describe("full Corporation portfolio", () => {
  it("manages multiple products and projects at once and allocates constrained capacity by portfolio priority", () => {
    const portfolio = new CorporatePortfolio();
    const legal = portfolio.createProduct({
      name: "Harmonia Legal Platform",
      ownerDepartmentId: "DEPT-HARMONIA-LEGAL",
      lifecycle: "BUILD",
      mission: "Legal analysis and workflow platform",
      customerProblem: "Complex legal evidence and drafting workflows",
      strategicFit: ["core-product"],
      evidenceRefs: ["owner:product"]
    });
    const second = portfolio.createProduct({
      name: "Provider Resilience Console",
      ownerDepartmentId: "DEPT-INTERNAL-DEVELOPMENT",
      lifecycle: "DISCOVERY",
      mission: "Reduce external model/provider dependency",
      customerProblem: "Provider outages and cost volatility",
      strategicFit: ["resilience"],
      evidenceRefs: ["incident:providers"]
    });

    const p0 = portfolio.createProject({
      productId: legal.productId,
      name: "HLL production bridge",
      objective: "Connect Corporation to authoritative HLL",
      ownerDepartmentId: "DEPT-INTERNAL-DEVELOPMENT",
      participatingDepartmentIds: ["DEPT-LEGAL", "DEPT-QC"],
      status: "ACTIVE",
      priority: "P0",
      dependencies: [],
      milestones: ["adapter", "tests"],
      successDefinition: "Production HLL path passes",
      capacityDemand: 7,
      risk: "HIGH",
      evidenceRefs: ["architecture:hll"]
    });
    const p2 = portfolio.createProject({
      productId: second.productId,
      name: "Provider discovery",
      objective: "Discover resilient provider options",
      ownerDepartmentId: "DEPT-INNOVATION",
      participatingDepartmentIds: ["DEPT-PROCUREMENT", "DEPT-SECURITY"],
      status: "ACTIVE",
      priority: "P2",
      dependencies: [],
      milestones: ["inventory"],
      successDefinition: "Resilient provider strategies exist",
      capacityDemand: 6,
      risk: "MEDIUM",
      evidenceRefs: ["provider:inventory"]
    });

    const allocations = portfolio.allocateCapacity(10);
    expect(allocations.find((item) => item.projectId === p0.projectId)?.allocatedCapacity).toBe(7);
    expect(allocations.find((item) => item.projectId === p2.projectId)?.allocatedCapacity).toBe(3);
    expect(portfolio.snapshot().products).toHaveLength(2);
  });
});

describe("scientific innovation and novelty absorption", () => {
  it("captures novelty, creates falsifiable hypotheses and absorbs only after supported experiments", () => {
    const radar = new InnovationRadar();
    const signal = radar.captureSignal({
      sourceKind: "SCIENTIFIC_PAPER",
      sourceRef: "paper:123",
      title: "New retrieval method",
      summary: "Potentially useful retrieval method for legal evidence.",
      observedAt: new Date().toISOString(),
      provenance: {
        sourceType: "EXTERNAL",
        sourceId: "paper:123",
        evidenceRefs: ["paper:123"],
        observedAt: new Date().toISOString()
      },
      evidenceRefs: ["paper:123"],
      noveltyScore: 0.9,
      relevanceScore: 0.8,
      confidenceScore: 0.7
    });

    radar.verifySignal(signal.signalId, ratified());

    const hypothesis = radar.createHypothesis({
      signalIds: [signal.signalId],
      statement: "The method improves evidence retrieval precision without unacceptable recall loss.",
      falsificationCriteria: ["precision does not improve", "recall drops below threshold"]
    });

    const opportunity = radar.createOpportunity({
      signalIds: [signal.signalId],
      hypothesisIds: [hypothesis.hypothesisId],
      title: "Evidence Retrieval vNext",
      problem: "Improve legal evidence retrieval quality",
      proposedValue: "Higher precision with controlled recall",
      targetDepartments: ["DEPT-HARMONIA-LEGAL", "DEPT-PRODUCTION"],
      targetProducts: ["Harmonia Legal Platform"],
      requiredExperiments: ["offline benchmark"],
      strategicFit: ["legal-quality"],
      riskNotes: ["benchmark bias"]
    });

    const experiment = radar.createExperiment({
      opportunityId: opportunity.opportunityId,
      hypothesisId: hypothesis.hypothesisId,
      objective: "Compare retrieval precision and recall",
      method: "Offline benchmark against frozen corpus",
      falsificationCriteria: ["no precision gain", "recall below threshold"],
      expectedEvidence: ["benchmark-report"]
    });
    radar.completeExperiment({
      experimentId: experiment.experimentId,
      result: "SUPPORTED",
      evidenceRefs: ["benchmark:pass"]
    });

    expect(radar.absorbOpportunity(opportunity.opportunityId).status).toBe("ABSORBED");
  });
});

describe("growth operations", () => {
  it("supports real channel discovery and outreach planning but blocks external sends without authorisation", () => {
    const growth = new GrowthOperations();
    const policy = growth.createPolicy({
      name: "B2B legal-tech growth",
      objectives: ["discover law-firm demand"],
      targetSegments: ["small and mid-size law firms"],
      permittedChannels: ["EMAIL", "PARTNERSHIP", "CONTENT"],
      prohibitedClaims: ["unsupported accuracy claims"],
      evidenceRequiredForClaims: true,
      legalReviewRequiredForExternalClaims: true,
      financeReviewThreshold: 0.4
    });
    const channel = growth.discoverChannel({
      kind: "EMAIL",
      name: "Direct law-firm outreach",
      hypothesis: "Targeted evidence-backed email creates qualified discovery calls.",
      targetAudience: "UK law firms",
      evidenceRefs: ["research:channel"],
      expectedValue: 0.8,
      expectedCost: 0.2,
      confidence: 0.6
    });
    const contact = growth.registerContact({
      organization: "Example Law",
      email: "contact@example.test",
      sourceRef: "directory:example",
      lawfulBasisRef: "legal-basis:legitimate-interest-reviewed",
      jurisdiction: "UK",
      relevance: "legal-tech target",
      evidenceRefs: ["directory:example"],
      status: "CONTACTABLE"
    });
    const campaign = growth.createCampaign({
      policyId: policy.policyId,
      channelId: channel.channelId,
      name: "Discovery outreach",
      objective: "Book product discovery calls",
      audienceDefinition: "relevant law firms",
      contactIds: [contact.contactId]
    });

    const blocked = growth.planExecution({
      campaignId: campaign.campaignId,
      contactId: contact.contactId,
      action: "SEND_EMAIL"
    });
    expect(blocked.status).toBe("BLOCKED");

    const reviewed = growth.markCampaignReviewed({
      campaignId: campaign.campaignId,
      legalReviewRef: "legal:pass",
      qcReviewRef: "qc:pass"
    });
    growth.authoriseCampaign(reviewed.campaignId, "owner-auth:campaign-plan");

    const authority = { authorityId: "outreach-owner", epoch: "1" };
    const approval = createApprovalReceipt({
      authority,
      action: "outreach.send_email",
      subjectId: contact.contactId,
      payload: {
        campaignId: campaign.campaignId,
        contactId: contact.contactId,
        action: "SEND_EMAIL",
        messageArtifactRef: null
      },
      scope: {
        policyId: policy.policyId,
        channelId: channel.channelId,
        recipient: contact.contactId,
        jurisdiction: "UK"
      },
      validUntil: new Date(Date.now() + 60_000).toISOString()
    });

    const authorised = growth.planExecution({
      campaignId: campaign.campaignId,
      contactId: contact.contactId,
      action: "SEND_EMAIL",
      approvalReceipt: approval,
      approvalAuthority: authority
    });
    expect(authorised.status).toBe("AUTHORISED");
    expect(authorised.approvalReceiptId).toBe(approval.receiptId);
  });
});


describe("novelty source absorption", () => {
  it("ingests new external novelty through replaceable connectors and deduplicates repeated items", async () => {
    const registry = new NoveltySourceRegistry();
    registry.registerConnector({
      connectorId: "official-docs",
      fetch: async (source) => [{
        intakeId: "",
        sourceId: source.sourceId,
        externalId: "release-1",
        title: "New model release",
        summary: "Official release introduces a relevant capability.",
        publishedAt: new Date().toISOString(),
        sourceRef: "official:release-1",
        evidenceRefs: ["official:release-1"],
        observedAt: new Date().toISOString()
      }]
    });
    const source = registry.registerSource({
      name: "Official provider releases",
      kind: "MODEL_RELEASE",
      connectorId: "official-docs",
      topics: ["models", "tool calling"],
      enabled: true,
      externalDependency: true,
      costClass: "FREE",
      trustClass: "OFFICIAL",
      pollingPolicy: "DAILY"
    });

    expect((await registry.ingest(source.sourceId))).toHaveLength(1);
    expect((await registry.ingest(source.sourceId))).toHaveLength(0);
    expect(registry.coverage().primaryOrOfficial).toBe(1);
  });
});

describe("expanded organization", () => {
  it("contains scientific research, innovation intake, venture incubation, growth and intelligence", () => {
    const ids = defaultOrganizationModel().departments.map((item) => item.departmentId);
    expect(ids).toEqual(expect.arrayContaining([
      "DEPT-SCIENCE-INNOVATION",
      "DEPT-INNOVATION",
      "DEPT-VENTURE-STUDIO",
      "DEPT-GROWTH",
      "DEPT-CORPORATE-INTELLIGENCE",
      "DEPT-HARMONIA-LEGAL"
    ]));
  });
});
