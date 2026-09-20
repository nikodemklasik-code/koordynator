import { describe, expect, it } from "vitest";
import { makeHllStatement } from "../src/corporation/hll.js";
import {
  AuthoritativeHllPort,
  REQUIRED_HLL_CONFORMANCE,
  type HllAuthorityCommitRequest,
  type HllAuthorityCommitResponse,
  type HllAuthorityRequest,
  type HllAuthorityResponse,
  type HllAuthorityTransport
} from "../src/corporation/hll-authority-adapter.js";
import { SubprocessHllAuthorityTransport } from "../src/corporation/hll-subprocess-transport.js";

function statement() {
  return makeHllStatement({
    subject: "TASK",
    proposition: "A task request exists with the captured structured payload.",
    payload: {
      taskId: "CORP-1",
      objective: "Implement the bounded improvement"
    },
    provenance: {
      sourceType: "OWNER",
      sourceId: "owner",
      evidenceRefs: ["owner-request:1"],
      observedAt: new Date().toISOString(),
      sourceLocator: "owner://request/1",
      contentHash: "a".repeat(64),
      verified: true
    },
    requestedBrainActions: ["RECORD", "DEFER"]
  });
}

function responseFor(request: HllAuthorityRequest): HllAuthorityResponse {
  return {
    schema: "corporation-hll-authority-response/1",
    statementId: request.statement.statementId,
    statementFingerprint: request.statement.fingerprint,
    subjectId: "HLLCORP:" + request.statement.statementId,
    truthState: "CONFIRMED",
    eligibleForFact: true,
    blockers: [],
    allowedBrainActions: [
      { action: "RECORD", scope: "INTERNAL" },
      { action: "DEFER", scope: "INTERNAL" }
    ],
    provenanceIds: ["PROV:" + request.statement.statementId],
    hllVersion: "HLL/1.0",
    decisionHash: "d".repeat(64),
    semanticHash: "s".repeat(64),
    authority: {
      authorityId: "harmonia-hll",
      epoch: "hll-1.0-corp-v1",
      conformance: [...REQUIRED_HLL_CONFORMANCE]
    }
  };
}

function commitResponseFor(request: HllAuthorityCommitRequest): HllAuthorityCommitResponse {
  return {
    schema: "corporation-hll-authority-commit-response/1",
    statementId: request.statement.statementId,
    statementFingerprint: request.statement.fingerprint,
    decisionHash: request.decisionHash,
    brainDecisionHash: "b".repeat(64),
    canonicalRecordHash: "r".repeat(64),
    truthState: "CONFIRMED",
    hllVersion: "HLL/1.0",
    authority: {
      authorityId: "harmonia-hll",
      epoch: "hll-1.0-corp-v1",
      conformance: [...REQUIRED_HLL_CONFORMANCE]
    }
  };
}

function transport(overrides: Partial<HllAuthorityTransport> = {}): HllAuthorityTransport {
  return {
    assess: async (request) => responseFor(request),
    commit: async (request) => commitResponseFor(request),
    ...overrides
  };
}

describe("AuthoritativeHllPort", () => {
  it("accepts only a conformance-complete authoritative assessment", async () => {
    const port = new AuthoritativeHllPort(transport());
    const input = statement();

    const assessment = await port.assess(input);

    expect(assessment.decision.truthState).toBe("CONFIRMED");
    expect(assessment.decision.decisionId).toBe("d".repeat(64));
    expect(assessment.decision.allowedBrainActions).toContainEqual({
      action: "RECORD",
      scope: "INTERNAL"
    });
    expect(assessment.receipt.statementFingerprint).toBe(input.fingerprint);
    expect(assessment.receipt.authorityId).toBe("harmonia-hll");
  });

  it("fails closed if the authority omits K1/K2 conformance", async () => {
    const port = new AuthoritativeHllPort(transport({
      assess: async (request) => {
        const response = responseFor(request);
        response.authority.conformance = ["HLL/1.0", "CORPORATION_EXTENSION_V1"];
        return response;
      }
    }));

    await expect(port.assess(statement()))
      .rejects.toThrow("HLL_AUTHORITY_CONFORMANCE_MISSING:K1_PUBLIC_RATIFIED_INGRESS_BLOCKED");
  });

  it("separates assessment from canonical commit and binds the write receipt", async () => {
    const port = new AuthoritativeHllPort(transport());
    const input = statement();
    const assessment = await port.assess(input);

    const committed = await port.commit({
      statement: input,
      assessment,
      action: "RECORD",
      rationale: "record confirmed proposition",
      targetLedger: "CORPORATION_TASKS"
    });

    expect(committed.brainDecisionHash).toBe("b".repeat(64));
    expect(committed.canonicalRecordHash).toBe("r".repeat(64));
    expect(committed.receipt.statementFingerprint).toBe(input.fingerprint);
    expect(committed.receipt.decisionId).toBe(assessment.decision.decisionId);
  });

  it("rejects a commit from a different authority epoch than the assessment", async () => {
    const port = new AuthoritativeHllPort(transport({
      commit: async (request) => ({
        ...commitResponseFor(request),
        authority: {
          ...commitResponseFor(request).authority,
          epoch: "different-epoch"
        }
      })
    }));
    const input = statement();
    const assessment = await port.assess(input);

    await expect(port.commit({
      statement: input,
      assessment,
      action: "RECORD",
      rationale: "record"
    })).rejects.toThrow("HLL_AUTHORITY_COMMIT_AUTHORITY_EPOCH_MISMATCH");
  });

  it("rejects a commit that is rebound to another Harmonia decision", async () => {
    const port = new AuthoritativeHllPort(transport({
      commit: async (request) => ({
        ...commitResponseFor(request),
        decisionHash: "wrong"
      })
    }));
    const input = statement();
    const assessment = await port.assess(input);

    await expect(port.commit({
      statement: input,
      assessment,
      action: "RECORD",
      rationale: "record"
    })).rejects.toThrow("HLL_AUTHORITY_COMMIT_DECISION_MISMATCH");
  });



  it("keeps one authority process alive across assess -> commit", async () => {
    const script = [
      "let data='';",
      "const decisions=new Map();",
      "process.stdin.setEncoding('utf8');",
      "const send=(v)=>process.stdout.write(JSON.stringify(v)+'\\n');",
      "const handle=(line)=>{",
      " if(!line.trim()) return;",
      " const req=JSON.parse(line);",
      " const s=req.statement;",
      " if(req.schema==='corporation-hll-authority-request/1'){",
      "   const decision='d'.repeat(64);",
      "   decisions.set(s.statementId,decision);",
      "   send({ok:true,response:{",
      "     schema:'corporation-hll-authority-response/1',",
      "     statementId:s.statementId,",
      "     statementFingerprint:s.fingerprint,",
      "     subjectId:'HLLCORP:'+s.statementId,",
      "     truthState:'CONFIRMED',",
      "     eligibleForFact:true,",
      "     blockers:[],",
      "     allowedBrainActions:[{action:'RECORD',scope:'INTERNAL'}],",
      "     provenanceIds:['PROV:'+s.statementId],",
      "     hllVersion:'HLL/1.0',",
      "     decisionHash:decision,",
      "     semanticHash:'s'.repeat(64),",
      "     authority:{authorityId:'harmonia-hll',epoch:'pid-'+process.pid,conformance:['HLL/1.0','K1_PUBLIC_RATIFIED_INGRESS_BLOCKED','K2_COMMIT_TIME_REVALIDATION','CORPORATION_EXTENSION_V1']}",
      "   }});",
      "   return;",
      " }",
      " if(req.schema==='corporation-hll-authority-commit-request/1'){",
      "   if(decisions.get(s.statementId)!==req.decisionHash){",
      "     send({ok:false,error:{type:'ConstitutionalViolation',message:'missing assessment binding'}});",
      "     return;",
      "   }",
      "   send({ok:true,response:{",
      "     schema:'corporation-hll-authority-commit-response/1',",
      "     statementId:s.statementId,",
      "     statementFingerprint:s.fingerprint,",
      "     decisionHash:req.decisionHash,",
      "     brainDecisionHash:'b'.repeat(64),",
      "     canonicalRecordHash:'r'.repeat(64),",
      "     truthState:'CONFIRMED',",
      "     hllVersion:'HLL/1.0',",
      "     authority:{authorityId:'harmonia-hll',epoch:'pid-'+process.pid,conformance:['HLL/1.0','K1_PUBLIC_RATIFIED_INGRESS_BLOCKED','K2_COMMIT_TIME_REVALIDATION','CORPORATION_EXTENSION_V1']}",
      "   }});",
      "   return;",
      " }",
      " send({ok:false,error:{type:'ProtocolError',message:'unsupported schema'}});",
      "};",
      "process.stdin.on('data', c => {",
      " data += c;",
      " let i;",
      " while((i=data.indexOf('\\n'))>=0){",
      "   const line=data.slice(0,i);",
      "   data=data.slice(i+1);",
      "   handle(line);",
      " }",
      "});"
    ].join("");

    const transport = new SubprocessHllAuthorityTransport({
      executable: process.execPath,
      args: ["-e", script],
      timeoutMs: 5_000
    });
    const port = new AuthoritativeHllPort(transport);

    try {
      const input = statement();
      const assessed = await port.assess(input);
      const committed = await port.commit({
        statement: input,
        assessment: assessed,
        action: "RECORD",
        rationale: "stateful commit"
      });

      expect(assessed.decision.truthState).toBe("CONFIRMED");
      expect(assessed.receipt.authorityEpoch).toMatch(/^pid-/);
      expect(committed.canonicalRecordHash).toBe("r".repeat(64));
      expect(committed.receipt.authorityEpoch).toBe(assessed.receipt.authorityEpoch);
    } finally {
      transport.close();
    }
  });

  it("fails closed when the long-lived authority reports lost assess state", async () => {
    const script = [
      "let data='';",
      "process.stdin.setEncoding('utf8');",
      "process.stdin.on('data', c => {",
      " data += c;",
      " let i;",
      " while((i=data.indexOf('\\n'))>=0){",
      "   const line=data.slice(0,i);",
      "   data=data.slice(i+1);",
      "   if(!line.trim()) continue;",
      "   const req=JSON.parse(line);",
      "   if(req.schema==='corporation-hll-authority-request/1'){",
      "     const s=req.statement;",
      "     process.stdout.write(JSON.stringify({ok:true,response:{schema:'corporation-hll-authority-response/1',statementId:s.statementId,statementFingerprint:s.fingerprint,subjectId:'HLLCORP:'+s.statementId,truthState:'CONFIRMED',eligibleForFact:true,blockers:[],allowedBrainActions:[{action:'RECORD',scope:'INTERNAL'}],provenanceIds:['P'],hllVersion:'HLL/1.0',decisionHash:'d'.repeat(64),authority:{authorityId:'harmonia-hll',epoch:'test',conformance:['HLL/1.0','K1_PUBLIC_RATIFIED_INGRESS_BLOCKED','K2_COMMIT_TIME_REVALIDATION','CORPORATION_EXTENSION_V1']}}})+'\\n');",
      "   } else {",
      "     process.stdout.write(JSON.stringify({ok:false,error:{type:'ConstitutionalViolation',message:'statement has not been assessed by Harmonia'}})+'\\n');",
      "   }",
      " }",
      "});"
    ].join("");

    const transport = new SubprocessHllAuthorityTransport({
      executable: process.execPath,
      args: ["-e", script],
      timeoutMs: 5_000
    });
    const port = new AuthoritativeHllPort(transport);

    try {
      const input = statement();
      const assessed = await port.assess(input);
      await expect(port.commit({
        statement: input,
        assessment: assessed,
        action: "RECORD",
        rationale: "must fail"
      })).rejects.toThrow("HLL_AUTHORITY_REMOTE_ERROR:ConstitutionalViolation:statement has not been assessed by Harmonia");
    } finally {
      transport.close();
    }
  });

  it("rejects a response bound to another statement fingerprint", async () => {
    const port = new AuthoritativeHllPort(transport({
      assess: async (request) => ({
        ...responseFor(request),
        statementFingerprint: "tampered"
      })
    }));

    await expect(port.assess(statement()))
      .rejects.toThrow("HLL_AUTHORITY_STATEMENT_FINGERPRINT_MISMATCH");
  });
});
