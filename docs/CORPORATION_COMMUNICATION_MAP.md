# Corporation Communication Map

Repository: `nikodemklasik-code/koordynator`  
Branch: `feature/corporation-kernel-v2`

This document is the readable communication/dependency map for Corporation v2.
The executable source of truth is `src/corporation/communication.ts`.

## 1. Communication principles

Material cross-department communication is typed and routed through declared
dependencies. Free-form chat may exist for discussion, but it is not sufficient to
move a material task from one corporate stage to another.

A material handoff normally carries:

- task/stage identity;
- sender and receiver department;
- sender/receiver position where relevant;
- message kind and priority;
- Stage Knowledge Package;
- evidence references;
- HLL decision where the dependency requires ratification;
- acknowledgement/receipt;
- QC visibility where required.

Default hierarchy:

```
CEO / Head
  -> Director
  -> Manager
  -> Lead
  -> Agent
```

A normal material cross-department handoff is owned by a Head/Director/Manager/Lead
or an Agent explicitly delegated that decision right. P0 incident/risk escalation
may bypass the normal reporting chain.

## 2. Dependency semantics

| Kind | Meaning | Downstream blocked? |
|---|---|---|
| BLOCKING | required handoff/dependency | yes |
| CONTROL | mandatory review/control relationship | normally yes |
| SERVICE | capability/evidence supplied to another department | no by default |
| ADVISORY | informs a decision | no |
| FEEDBACK | returns evidence/results without reverse blocking cycle | no |
| INFORMATION | traceable informational flow | no |

## 3. Main execution chain

```
CEO Office
   |
   v
Strategy & Portfolio
   |
   v
Product
   |
   v
Production & Engineering
   |
   v
Testing & Verification
   |
   v
Quality Control
   |
   v
Operations & Reliability
```

This is not the only route, but it is the default material product-delivery spine.

## 4. Product knowledge dependencies

```
Research & Intelligence ----+
                            |
Data & Analytics -----------+--> Product
                            |
Sales feedback -------------+
                            |
Customer Success -----------+
```

Product consumes evidence rather than assuming it.

Product sends:

- build package to Production;
- positioning/release facts to Marketing;
- legal questions to Legal;
- material financial questions to Finance;
- security-sensitive matters to Security;
- research/data requests to Research and Data.

## 5. Commercial communication

```
Product
   |
   v
Marketing
   |
   v
Sales & Business Development
   |
   +----> Legal      (contracts / legal commitments)
   |
   +----> Finance    (forecast / commercial economics)
   |
   +----> Product    (market/customer feedback)
```

Marketing material claims remain visible to QC. Legally material public claims route
to Legal.

## 6. Production, testing and QC

```
Product
   |
   | HANDOFF + Knowledge Package + HLL
   v
Production
   |
   | HANDOFF
   v
Testing
   |
   | QUALITY_GATE / evidence
   v
QC
   |
   +---- PASS / closure
   |
   +---- return for correction
```

Testing -> Production is FEEDBACK, not a reverse BLOCKING dependency. This allows
failures to return to Engineering without creating a circular deadlock in the
dependency graph.

Production also routes security-sensitive work to Security before release and sends
a verified release candidate to Operations.

## 7. Cross-cutting Quality Control

QC is independent and cross-corporate. It is below Harmonia Constitution but cannot
be overridden by an ordinary operating department on a mandatory QC gate.

QC observes or controls:

- material Product handoffs;
- Production output;
- Testing evidence;
- material Marketing claims;
- material Sales claims;
- selected HR/Recruitment quality;
- Internal Development/self-improvement;
- material decisions and approvals.

Systemic unresolved quality failures escalate:

```
QC -> CEO Office
```

## 8. Security communication

```
Production --------> Security
Internal Dev ------> Security
Procurement -------> Security
Operations --------> Security  (telemetry/incidents)

Security ----------> Operations (containment/control)
Security ----------> CEO Office (critical escalation)
```

Security receives high-risk and incident communication through a cross-cutting
observer rule even when it is not the direct recipient.

## 9. Legal communication

Legal receives:

- Product legal review;
- Marketing regulated/material claims;
- Sales contracts and legally material commitments;
- Procurement/vendor commitments;
- Compliance & Risk findings with legal significance.

Legally material external-effect decisions can make Legal an observer even when
another department is the direct recipient.

## 10. Finance communication

Finance receives:

- material product spend/unit-economics review;
- pipeline/commercial evidence from Sales;
- vendor/procurement review;
- external spend/commitment decisions.

Material financial-control or budget risk escalates to CEO Office.

A paid provider may be used, but mandatory QC/process closure cannot depend solely
on a paid provider.

## 11. Procurement and provider dependency

```
Procurement
   +----> Legal
   +----> Security
   +----> Finance
```

Provider/vendor onboarding is not complete until the required control branches are
closed.

Provider Fabric then treats approved providers as replaceable capability suppliers,
not as architectural authorities.

## 12. HR and Recruitment

A department with a capability gap creates Recruitment.

```
Department
   |
   v
Koordynator detects capability gap
   |
   v
HR / Recruitment
   |
   v
Role Contract candidate
   |
   v
HLL + capability/effect/tool ceiling
   |
   v
active Role Contract
   |
   v
requesting department
```

HR is a service dependency for departments, not an execution shortcut around HLL.

## 13. Internal Development / Self-Improvement

```
Self-Improvement incident
   |
   v
Internal Development
   +----> Testing
   +----> Security
   +----> QC
```

A self-healing change is not considered complete merely because it changed runtime
state. Material code/platform changes must pass independent verification and QC.

## 14. Compliance & Risk

Compliance & Risk receives material control/risk decisions and may route findings to
Legal.

Enterprise risk beyond a department's mandate escalates:

```
Compliance & Risk -> CEO Office
```

## 15. Escalation topology

Normal hierarchy remains local to the department. Cross-department escalations are
typed messages.

Critical escalation paths:

```
QC --------------------+
Security --------------+--> CEO Office
Finance ---------------+
Compliance & Risk -----+
```

P0 INCIDENT / ESCALATION / RISK_ALERT may bypass the normal Agent -> Lead -> Manager
chain. The bypass must still leave a message receipt and evidence trail.

## 16. Cross-cutting observers

A direct sender/receiver pair is not the whole audience for a material decision.

Default observer rules:

| Trigger | Observer |
|---|---|
| material HANDOFF / QUALITY_GATE / approval / decision | QC |
| high-risk or incident communication | Security |
| legally material external effect | Legal |
| spend/vendor/external financial commitment | Finance |
| material risk/control decision | Compliance & Risk |

Observers do not automatically become decision owners. Their authority comes from
their own Role Contracts, department charter, HLL and control policy.

## 17. Department screen requirements

Every department screen should show:

- Head and management hierarchy;
- current staff/agents and Role Contracts;
- inbound dependencies;
- outbound dependencies;
- blocking messages;
- pending acknowledgements;
- QC/Security/Legal/Finance/Risk observers;
- active escalations;
- knowledge packages received;
- knowledge packages sent;
- task stages owned by the department;
- receipts and decision history.

The user should be able to move from a department to the exact task, stage, HLL
decision, evidence and counterparty department that caused a dependency.

## 18. Runtime rule

A material cross-department transition is executable only when:

```
declared dependency exists
AND required Knowledge Package exists
AND required HLL state is RATIFIED
AND mandatory control/QC gates are satisfied
AND required acknowledgement/authorisation exists
```

Anything else remains WAITING/BLOCKED/INCONCLUSIVE rather than being silently
treated as success.
