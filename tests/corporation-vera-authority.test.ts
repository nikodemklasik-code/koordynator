import { describe, expect, it } from "vitest";
import { authoriseVeraEffect } from "../src/corporation/action-gate.js";
import { makeHllStatement } from "../src/corporation/hll.js";
import type { HllDecision } from "../src/corporation/domain.js";
import {
  createApprovalReceipt,
  createDecisionReceipt,
  createHllRecordReceipt
} from "../src/corporation/receipts.js";
import {
  VeraCoreAuthority,
  type VeraEffectAuthorityPort,
  type VeraPrepareEffectInput,
  type VeraRpcMethod,
  type VeraRpcPort
} from "../src/corporation/vera-authority.js";
import { SubprocessVeraRpcTransport } from "../src/corporation/vera-subprocess-transport.js";

function externalStatement() {
  return makeHllStatement({
    subject: "OUTREACH",
    proposition: "The bounded outreach effect is semantically admissible.",
    payload: { contactId: "CONTACT-1", messageHash: "msg-1" },
    provenance: {
      sourceType: "DEPARTMENT",
      sourceId: "DEPT-GROWTH",
      evidenceRefs: ["campaign:1"],
      observedAt: new Date().toISOString()
    },
    requestedBrainActions: ["RECORD", "EXTERNAL_SEND"]
  });
}

function confirmedDecision(statement: ReturnType<typeof externalStatement>): HllDecision {
  return {
    decisionId: "d".repeat(64),
    statementId: statement.statementId,
    subjectId: "HLLCORP:" + statement.statementId,
    truthState: "CONFIRMED",
    eligibleForFact: true,
    blockers: [],
    allowedBrainActions: [
      { action: "RECORD", scope: "INTERNAL" },
      { action: "EXTERNAL_SEND", scope: "EXTERNAL" }
    ],
    provenanceIds: ["PROV:" + statement.statementId],
    hllVersion: "HLL/1.0",
    semanticHash: "s".repeat(64)
  };
}

describe("VERA authority boundary", () => {
  it("keeps capability state in one long-lived T0 process", async () => {
    const script = [
      "let data='';",
      "const caps=new Set();",
      "process.stdin.setEncoding('utf8');",
      "const send=(v)=>process.stdout.write(JSON.stringify(v)+'\\n');",
      "const handle=(line)=>{",
      " if(!line.trim()) return;",
      " const req=JSON.parse(line);",
      " if(req.method==='core.health'){send({id:req.id,ok:true,result:{status:'READY',trust:'T0',legal_semantics:false},error:null});return;}",
      " if(req.method==='capability.issue'){const id='cap-'+(caps.size+1);caps.add(id);send({id:req.id,ok:true,result:id,error:null});return;}",
      " if(req.method==='access.evaluate'){",
      "   if(!caps.has(req.params.capability_id)){send({id:req.id,ok:false,result:null,error:{code:'CORE_DENIED',message:'CORE_DENIED:ACCESS'}});return;}",
      "   send({id:req.id,ok:true,result:{id:req.params.capability_id,right:req.params.right,scope:req.params.scope_id,policy:{}},error:null});return;",
      " }",
      " send({id:req.id,ok:false,result:null,error:{code:'CORE_METHOD_NOT_REGISTERED',message:'unsupported'}});",
      "};",
      "process.stdin.on('data',c=>{data+=c;let i;while((i=data.indexOf('\\n'))>=0){const line=data.slice(0,i);data=data.slice(i+1);handle(line);}});"
    ].join("");

    const transport = new SubprocessVeraRpcTransport({
      executable: process.execPath,
      args: ["-e", script],
      timeoutMs: 5_000
    });
    const vera = new VeraCoreAuthority(transport);

    try {
      await expect(vera.health()).resolves.toMatchObject({ status: "READY", trust: "T0" });
      const capabilityId = await vera.issueCapability({
        subject: "executor-1",
        issuer: "harmonia-corporation",
        scope: "stage:1",
        rights: ["ExecuteEffect"],
        object_bound: null,
        policy: { id: "policy-1" },
        not_before: 1,
        expires_at: 2
      });
      expect(capabilityId).toBe("cap-1");

      await expect(vera.evaluateAccess({
        capabilityId,
        actorId: "executor-1",
        scopeId: "stage:1",
        right: "ExecuteEffect"
      })).resolves.toMatchObject({ id: "cap-1", right: "ExecuteEffect" });
    } finally {
      transport.close();
    }
  });

  it("forwards the closed VERA method contract without inventing authority fields", async () => {
    const calls: Array<{ method: VeraRpcMethod; params: Record<string, unknown> }> = [];
    const rpc: VeraRpcPort = {
      call: async <T>(method: VeraRpcMethod, params: Record<string, unknown>) => {
        calls.push({ method, params: structuredClone(params) });
        if (method === "effect.prepare") return "permit-1" as T;
        throw new Error("unexpected");
      }
    };
    const vera = new VeraCoreAuthority(rpc);
    const intent = {
      intent_ref: { id: "intent-1" },
      actor: "executor-1",
      scope: "stage:1",
      kind: "EmailSend" as const,
      adapter: "customer-email-airlock",
      payload_ref: { id: "payload-1" },
      target_hash: "target-hash"
    };

    await expect(vera.prepareEffect({
      intent,
      actorId: "executor-1",
      capabilityId: "cap-1",
      policyRef: { id: "effect-policy" },
      verifiedEffectReceiptIds: ["receipt-1"],
      requestedTtlMs: 30_000
    })).resolves.toEqual({ permitId: "permit-1" });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("effect.prepare");
    expect(calls[0]?.params).toMatchObject({
      actor_id: "executor-1",
      capability_id: "cap-1",
      requested_ttl_ms: 30_000
    });
    expect(calls[0]?.params).not.toHaveProperty("issued_at");
    expect(calls[0]?.params).not.toHaveProperty("expires_at");
    expect(calls[0]?.params).not.toHaveProperty("current_time");
  });

  it("requires a canonical HLL record before asking VERA for an effect permit", async () => {
    const statement = externalStatement();
    const decision = confirmedDecision(statement);
    const authority = { authorityId: "harmonia-hll", epoch: "hll-1.0-corp-v1" };
    const decisionReceipt = createDecisionReceipt({ statement, decision, authority });
    const hllRecordReceipt = createHllRecordReceipt({
      statement,
      decision,
      brainDecisionHash: "b".repeat(64),
      canonicalRecordHash: "r".repeat(64),
      authority
    });
    const approval = createApprovalReceipt({
      authority: { authorityId: "owner", epoch: "1" },
      action: "owner.external-send",
      subjectId: "CONTACT-1",
      payload: { contactId: "CONTACT-1", messageHash: "msg-1" },
      scope: { channel: "email" },
      validUntil: new Date(Date.now() + 60_000).toISOString()
    });

    const effect: VeraPrepareEffectInput = {
      intent: {
        intent_ref: { id: "intent-1" },
        actor: "executor-1",
        scope: "outreach:CONTACT-1",
        kind: "EmailSend",
        adapter: "customer-email-airlock",
        payload_ref: { id: "payload-1" },
        target_hash: "recipient-hash"
      },
      actorId: "executor-1",
      capabilityId: "cap-1",
      policyRef: { id: "policy-1" },
      verifiedEffectReceiptIds: ["check-1"],
      requestedTtlMs: 30_000
    };

    let calls = 0;
    const vera: VeraEffectAuthorityPort = {
      prepareEffect: async () => {
        calls += 1;
        return { permitId: "permit-1" };
      }
    };

    await expect(authoriseVeraEffect({
      statement,
      decision,
      decisionReceipt,
      hllRecordReceipt,
      brainAction: "EXTERNAL_SEND",
      subjectId: "CONTACT-1",
      payload: { contactId: "CONTACT-1", messageHash: "msg-1" },
      scope: { channel: "email" },
      requiredAuthorisations: ["owner.external-send"],
      approvals: [approval],
      authorities: {
        "owner.external-send": { authorityId: "owner", epoch: "1" }
      },
      vera,
      effect
    })).resolves.toMatchObject({ permitId: "permit-1" });
    expect(calls).toBe(1);

    const tamperedRecord = {
      ...hllRecordReceipt,
      canonicalRecordHash: "tampered"
    };
    await expect(authoriseVeraEffect({
      statement,
      decision,
      decisionReceipt,
      hllRecordReceipt: tamperedRecord,
      brainAction: "EXTERNAL_SEND",
      subjectId: "CONTACT-1",
      payload: { contactId: "CONTACT-1", messageHash: "msg-1" },
      scope: { channel: "email" },
      requiredAuthorisations: ["owner.external-send"],
      approvals: [approval],
      authorities: {
        "owner.external-send": { authorityId: "owner", epoch: "1" }
      },
      vera,
      effect
    })).rejects.toThrow("HLL_RECORD_RECEIPT_TAMPERED");
    expect(calls).toBe(1);
  });
});
