# P0 Pack Engine + Hiring Wizard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a pack-based agent create flow for **Hiring**, with documents, special questions, human-transfer phones, demo, and subscription agent-count guard — without leaking vendor names in the product UI.

**Architecture:** Extend existing `AgentConfiguration` with `agentType` + pack defaults. A small `packs/` registry maps type → wizard fields and default config slices. Escalation gains transfer phone targets (business-level). UI wizard drives create/update APIs already on agents. Demo reuses existing browser voice/text test behind neutral copy. Telephony/Exotel stays out of P0.

**Tech Stack:** NestJS/Fastify API, Zod configs, Drizzle/Postgres (no new tables in P0 unless quota needs a column — prefer env/org setting), Next.js web, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-16-voice-agent-platform-design.md` (P0 row in §10)

## Global Constraints

- Customer-facing copy never names ElevenLabs, Exotel, Gemini, or other vendors (spec §1, §7).
- No hire/reject recommendations — hiring pack may store criteria labels only (spec §1).
- English default; other languages only when explicitly allowed (spec §3).
- Depend on ports/registries already in the repo style; one implementation is enough (YAGNI / ponytail).
- TDD: failing test → implement → pass → commit per task.
- Do not implement Exotel, custom roles UI, analytics, or non-hiring packs in this plan.

---

## File map (P0)

| File | Responsibility |
|------|----------------|
| `apps/api/src/agents/packs/types.ts` | Pack id union + PackDefinition type |
| `apps/api/src/agents/packs/hiring.ts` | Hiring pack defaults + wizard field descriptors |
| `apps/api/src/agents/packs/registry.ts` | `getPack(id)`, `listPacks()` |
| `apps/api/src/agents/configuration.ts` | Add `agentType`; extend `escalation` with transfer phones |
| `apps/api/src/agents/agents.controller.ts` | Create/update accept pack fields; optional `GET /agents/packs` |
| `apps/api/src/agents/agents.service.ts` | Apply pack defaults on create; enforce agent quota |
| `apps/api/src/agents/quota.ts` | `assertCanCreateAgent(actor)` — count vs limit |
| `apps/api/src/config.ts` | `ORG_AGENT_LIMIT` default (e.g. 5) until billing table exists |
| `apps/web/app/agents/new/page.tsx` (or wizard on `/agents`) | Hiring wizard UI |
| `apps/web/lib/api.ts` | `listPacks`, create agent with pack payload |
| `apps/api/test/agent-packs.test.ts` | Pack + config + quota tests |
| `apps/api/test/production-boundary.test.ts` | Ensure web product strings stay vendor-free (extend if needed) |

**Deferred (later plans):** contacts, resume parse, Job/Task, Exotel ports, inbound, custom roles, analytics, other packs.

---

### Task 1: Pack registry + `agentType` on configuration

**Files:**
- Create: `apps/api/src/agents/packs/types.ts`
- Create: `apps/api/src/agents/packs/hiring.ts`
- Create: `apps/api/src/agents/packs/registry.ts`
- Create: `apps/api/src/agents/packs/index.ts`
- Modify: `apps/api/src/agents/configuration.ts`
- Test: `apps/api/test/agent-packs.test.ts`

**Interfaces:**
- Produces: `AgentType = 'hiring' | 'support' | 'sales' | 'appointments' | 'reminders' | 'custom'`
- Produces: `getPack(type: AgentType): PackDefinition`
- Produces: `AgentConfiguration.agentType: AgentType` (default `'custom'` for backward compat with existing agents)

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/test/agent-packs.test.ts
import { describe, expect, it } from 'vitest';
import { AgentConfiguration } from '../src/agents/configuration.js';
import { getPack, listPacks } from '../src/agents/packs/index.js';

describe('packs registry', () => {
  it('lists hiring pack with neutral labels (no vendor names)', () => {
    const packs = listPacks();
    const hiring = packs.find((p) => p.id === 'hiring');
    expect(hiring).toBeDefined();
    expect(hiring!.label.toLowerCase()).not.toMatch(/eleven|exotel|gemini/);
    const blob = JSON.stringify(hiring).toLowerCase();
    expect(blob).not.toMatch(/elevenlabs|exotel|gemini/);
  });

  it('getPack(hiring) returns mustAskQuestions and transfer fields', () => {
    const pack = getPack('hiring');
    expect(pack.wizardFields.map((f) => f.key)).toEqual(
      expect.arrayContaining(['purpose', 'documentsHint', 'mustAskQuestions', 'transferPhones']),
    );
  });

  it('AgentConfiguration requires agentType and accepts hiring', () => {
    const parsed = AgentConfiguration.parse({
      agentType: 'hiring',
      identity: { displayName: 'Screening assistant', languages: ['en-IN'], primaryLanguage: 'en-IN' },
      purpose: 'Screen candidates against the job description',
    });
    expect(parsed.agentType).toBe('hiring');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @platform/api exec vitest run test/agent-packs.test.ts`  
Expected: FAIL (module or `agentType` missing)

- [ ] **Step 3: Write minimal implementation**

```typescript
// packs/types.ts
export const AGENT_TYPES = [
  'hiring', 'support', 'sales', 'appointments', 'reminders', 'custom',
] as const;
export type AgentType = (typeof AGENT_TYPES)[number];

export type WizardField = {
  key: string;
  label: string;
  kind: 'text' | 'textarea' | 'string_list' | 'phone_list';
  required: boolean;
};

export type PackDefinition = {
  id: AgentType;
  label: string;
  description: string;
  wizardFields: WizardField[];
  /** Slice merged into new agent configuration defaults */
  defaultConfigSlice: Record<string, unknown>;
};
```

```typescript
// packs/hiring.ts — defaults only; no vendor strings
import type { PackDefinition } from './types.js';

export const hiringPack: PackDefinition = {
  id: 'hiring',
  label: 'Hiring screen',
  description: 'Screen candidates against a job description. Reports fit; never recommends hire or reject.',
  wizardFields: [
    { key: 'purpose', label: 'What should this agent do?', kind: 'textarea', required: true },
    { key: 'documentsHint', label: 'Upload job description and related docs', kind: 'text', required: false },
    { key: 'mustAskQuestions', label: 'Questions to always ask (optional)', kind: 'string_list', required: false },
    { key: 'transferPhones', label: 'Transfer to a human (phone numbers)', kind: 'phone_list', required: false },
  ],
  defaultConfigSlice: {
    agentType: 'hiring',
    guardrails: { refuseWhenNoKnowledge: true },
    escalation: { enabled: true, trigger: 'on_request' },
  },
};
```

```typescript
// packs/registry.ts
import { hiringPack } from './hiring.js';
import type { AgentType, PackDefinition } from './types.js';

const PACKS: Record<AgentType, PackDefinition> = {
  hiring: hiringPack,
  // stubs so getPack never throws for reserved types — minimal placeholders
  support: { ...hiringPack, id: 'support', label: 'Customer support', description: 'Coming soon', wizardFields: hiringPack.wizardFields, defaultConfigSlice: { agentType: 'support' } },
  sales: { ...hiringPack, id: 'sales', label: 'Sales outreach', description: 'Coming soon', wizardFields: [], defaultConfigSlice: { agentType: 'sales' } },
  appointments: { ...hiringPack, id: 'appointments', label: 'Appointments', description: 'Coming soon', wizardFields: [], defaultConfigSlice: { agentType: 'appointments' } },
  reminders: { ...hiringPack, id: 'reminders', label: 'Reminders', description: 'Coming soon', wizardFields: [], defaultConfigSlice: { agentType: 'reminders' } },
  custom: { ...hiringPack, id: 'custom', label: 'Custom', description: 'General-purpose agent', wizardFields: hiringPack.wizardFields, defaultConfigSlice: { agentType: 'custom' } },
};

export function listPacks(): PackDefinition[] {
  return Object.values(PACKS);
}

export function getPack(id: AgentType): PackDefinition {
  const pack = PACKS[id];
  if (!pack) throw new Error(`Unknown pack: ${id}`);
  return pack;
}
```

In `configuration.ts`: add `agentType: z.enum([...]).default('custom')` to `AgentConfiguration` object (keep `.strict()`).

Extend escalation:

```typescript
const Escalation = z.object({
  enabled: z.boolean().default(false),
  trigger: z.enum(['never', 'on_request', 'on_failure', 'on_forbidden_topic']).default('on_request'),
  notifyEmails: z.array(z.string().email()).max(20).default([]),
  /** E.164 or local digits — resolved by telephony adapter later; never store vendor ids here */
  transferPhones: z.array(z.string().trim().min(5).max(20)).max(10).default([]),
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @platform/api exec vitest run test/agent-packs.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/agents/packs apps/api/src/agents/configuration.ts apps/api/test/agent-packs.test.ts
git commit -m "feat(agents): pack registry and agentType on configuration"
```

---

### Task 2: Apply pack defaults + map wizard payload on create

**Files:**
- Modify: `apps/api/src/agents/agents.controller.ts`
- Modify: `apps/api/src/agents/agents.service.ts`
- Modify: `apps/api/test/agent-packs.test.ts` (or extend existing agent integration test)
- Test: prefer harness test in `apps/api/test/agent-packs.test.ts` using existing `startApi` if agents create tests already exist — otherwise extend `apps/api/test/` agent suite

**Interfaces:**
- Consumes: `getPack`, `AgentConfiguration`
- Produces: `POST /agents` body may include `{ name, type?, agentType, purpose, mustAskQuestions?, transferPhones? }`
- Maps `mustAskQuestions: string[]` → `evaluation.criteria` (`id` slug, `label` question, `required: true`)
- Maps `transferPhones` → `escalation.transferPhones` + `escalation.enabled: true` if non-empty

- [ ] **Step 1: Write the failing test**

```typescript
it('create hiring agent stores criteria and transfer phones from wizard fields', async () => {
  // use existing api harness + owner cookie pattern from elevenlabs-voice or agents tests
  const res = await api.request({
    method: 'POST',
    url: '/agents',
    cookie,
    payload: {
      name: 'JD Screener',
      agentType: 'hiring',
      purpose: 'Screen for the open role',
      mustAskQuestions: ['How many years of relevant experience?'],
      transferPhones: ['+919876543210'],
    },
  });
  expect(res.statusCode).toBe(201);
  const agent = JSON.parse(res.body);
  const get = await api.request({ method: 'GET', url: `/agents/${agent.id}`, cookie });
  const body = JSON.parse(get.body);
  const cfg = body.currentVersion?.configuration ?? body.configuration;
  expect(cfg.agentType).toBe('hiring');
  expect(cfg.evaluation.criteria.some((c: { label: string }) => c.label.includes('experience'))).toBe(true);
  expect(cfg.escalation.transferPhones).toContain('+919876543210');
});
```

(Adjust property paths to match actual `get` response shape in `agents.service` — read `toAgent` / version payload before writing the assert.)

- [ ] **Step 2: Run test — expect FAIL** (unknown body fields or criteria empty)

- [ ] **Step 3: Minimal implementation**

Extend `CreateAgent` zod in controller:

```typescript
const CreateAgent = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional(),
  purpose: z.string().trim().min(1).max(2000).optional(),
  type: z.string().trim().max(64).optional(),
  agentType: z.enum(['hiring','support','sales','appointments','reminders','custom']).default('hiring'),
  mustAskQuestions: z.array(z.string().trim().min(1).max(300)).max(30).default([]),
  transferPhones: z.array(z.string().trim().min(5).max(20)).max(10).default([]),
}).strict();
```

In `agents.service` `create`, after building default config:

```typescript
import { getPack } from './packs/index.js';

const pack = getPack(input.agentType);
const criteria = input.mustAskQuestions.map((label, i) => ({
  id: `q${i + 1}`,
  label,
  required: true,
}));
const configuration = AgentConfiguration.parse({
  ...defaultConfiguration(input.name),
  ...pack.defaultConfigSlice,
  agentType: input.agentType,
  purpose: input.purpose ?? pack.description,
  identity: { displayName: input.name, languages: ['en-IN'], primaryLanguage: 'en-IN' },
  evaluation: { enabled: criteria.length > 0, criteria },
  escalation: {
    enabled: input.transferPhones.length > 0,
    trigger: 'on_request',
    transferPhones: input.transferPhones,
  },
});
```

(Merge carefully with existing `defaultConfiguration` helper — do not duplicate identity incorrectly.)

- [ ] **Step 4: Run test — PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(agents): apply hiring pack defaults on create"
```

---

### Task 3: Agent quota (subscription stand-in)

**Files:**
- Create: `apps/api/src/agents/quota.ts`
- Modify: `apps/api/src/config.ts` — `ORG_AGENT_LIMIT` coerce number default `5`
- Modify: `apps/api/src/agents/agents.service.ts` — call assert before insert
- Test: `apps/api/test/agent-packs.test.ts`

**Interfaces:**
- Produces: `async function assertCanCreateAgent(db, orgId: string, limit: number): Promise<void>`
- Throws `ApiError.conflict('Agent limit reached for your plan')` when `count(*) >= limit`

- [ ] **Step 1: Failing test** — create agents in a loop until limit; next create returns 409 with message about plan/limit (no vendor names).

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement**

```typescript
// quota.ts
export async function assertCanCreateAgent(
  countAgents: () => Promise<number>,
  limit: number,
): Promise<void> {
  const n = await countAgents();
  if (n >= limit) {
    throw ApiError.conflict(
      'Agent limit reached for your plan. Upgrade to create more agents.',
    );
  }
}
```

Wire count query with RLS/org scope same as list agents.

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit** `feat(agents): enforce org agent creation quota`

---

### Task 4: `GET /agents/packs` + wizard UI (hiring)

**Files:**
- Modify: `apps/api/src/agents/agents.controller.ts` — `GET packs` with `agents.read` or `agents.create`
- Modify: `apps/web/lib/api.ts`
- Create: `apps/web/app/agents/new/page.tsx` (wizard)
- Modify: `apps/web/app/agents/page.tsx` — “Create agent” → `/agents/new`
- Test: API test for packs endpoint; optional Playwright skipped — assert API + that page source has no vendor strings via grep in `production-boundary` or a small web unit check

**Interfaces:**
- `GET /agents/packs` → `{ packs: PackDefinition[] }` (hiring fully described; others `comingSoon: true` if you add that flag — or filter list to `hiring` + `custom` only in P0)

P0 list only **enabled** packs:

```typescript
export function listEnabledPacks(): PackDefinition[] {
  return [getPack('hiring'), getPack('custom')];
}
```

- [ ] **Step 1: API test** — authenticated GET returns hiring; body has no `elevenlabs|exotel`

- [ ] **Step 2: FAIL then implement controller method**

- [ ] **Step 3: Web wizard** — steps matching hiring `wizardFields`; submit `createAgent`; on success link to agent detail **Demo** (existing voice/text test panel). Buttons: “Try a demo conversation” — never “ElevenLabs test”.

- [ ] **Step 4: Grep web for vendor leaks**

Run: `rg -i 'elevenlabs|exotel|gemini' apps/web/app apps/web/lib --glob '!**/integrations/**'`  
Expected: no matches in product routes/lib (integrations folder may still hold SDK — OK per MVP-01 boundary).

- [ ] **Step 5: Commit** `feat(web): hiring agent create wizard`

---

### Task 5: Document binding hint (knowledge) without new product surface sprawl

**Files:**
- Modify: wizard to link “Add documents” → existing `/knowledge` + agent knowledge bind API if one exists
- If bind API exists on agent: call it after create with selected source ids
- Test: skip full upload E2E; one API test that creating agent with `knowledgeSourceIds: uuid[]` attaches refs in configuration.knowledge

**Interfaces:**
- Optional `knowledgeSourceIds` on create → `configuration.knowledge[]`

- [ ] Steps: failing test → wire ids into config knowledge array → pass → commit `feat(agents): attach knowledge sources on hiring create`

If knowledge bind is only via separate endpoints today, wizard Step “documents” = CTA to knowledge page + copy “attach on agent after upload” — document that as intentional P0 deferral in commit message; still show the step in UI.

---

### Task 6: P0 verification

- [ ] **Step 1:** `pnpm --filter @platform/api exec vitest run test/agent-packs.test.ts`
- [ ] **Step 2:** `pnpm --filter @platform/api run typecheck` && `pnpm --filter @platform/web run typecheck`
- [ ] **Step 3:** Manual checklist in PR/notes: create hiring agent → see criteria + transfer phones on version → open demo with neutral label → hit agent quota 409
- [ ] **Step 4:** Commit any fixups; do not start P1/Exotel

---

## Spec coverage (self-review)

| Spec item | Task |
|-----------|------|
| Pack-based wizard, hiring first | 1, 2, 4 |
| Documents | 5 (bind or CTA) |
| Special questions | 2 |
| Transfer phones | 1–2 |
| Demo without vendor branding | 4 |
| Subscription agent limit | 3 |
| Hide vendors | 1, 4 grep |
| English default | 2 identity languages |
| No hire recommendation copy | hiring pack description |
| Exotel / other packs / custom roles / analytics | Out of plan (P1+) |

## Placeholder scan

None intentional. Stub packs in registry are labeled “Coming soon” and not enabled in `listEnabledPacks`.

---

## Follow-on plans (do not implement here)

- **P1:** Contacts, resume→phone, Job/Task, result review widgets  
- **P2:** `TelephonyPort` + outbound live calls + metering  
- **P3:** Inbound + custom roles + analytics  
- **P4:** Support / Sales / Appointments / Reminders packs  
