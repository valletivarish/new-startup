/**
 * The built-in tool implementations.
 *
 * THE CENTRAL RULE OF THIS FILE: a database row cannot create behaviour. A
 * `tools` row is a DECLARATION — it says a tool named `calculator` is
 * available to this organization and which permission it requires. The code
 * that actually runs lives here, keyed by name. If a row names something with
 * no implementation, execution is refused.
 *
 * That is what stops the obvious attack: someone who can write a catalogue row
 * — or a model that simply invents a tool name — still cannot make the
 * platform do anything it does not already know how to do.
 *
 * The Zod schemas here, NOT the JSON copy stored on the row, are the
 * authoritative validators. The stored JSON Schema describes the tool for the
 * catalogue UI and for the model; the row is organization-editable data and is
 * therefore untrusted for validation purposes.
 *
 * Every handler is deterministic, performs no network call, and receives no
 * credentials, tokens, or connection details.
 */

import { z } from 'zod';

/** Context a handler may see. Deliberately minimal — no secrets, no tokens. */
export interface ToolExecutionContext {
  readonly organizationId: string;
  readonly sessionId: string;
  /** Stable across retries of the same logical call (§19 idempotency). */
  readonly idempotencyKey: string;
}

/** Raised by a handler for an expected business failure. Message is user-safe. */
export class ToolBusinessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolBusinessError';
  }
}

/** Raised when model-supplied arguments do not satisfy the tool's schema. */
export class ToolInputInvalidError extends Error {
  readonly issues: readonly string[];
  constructor(issues: readonly string[]) {
    super(`Tool input failed validation: ${issues.join('; ')}`);
    this.name = 'ToolInputInvalidError';
    this.issues = issues;
  }
}

/**
 * Raised when a handler's OWN output does not satisfy its schema.
 *
 * This is a platform fault, not a user error, and it is checked anyway: a tool
 * that returns an unexpected shape must not have that shape flow onward into
 * the model's context or a caller's response.
 */
export class ToolOutputInvalidError extends Error {
  constructor(toolName: string) {
    super(`Tool ${toolName} produced output that failed its own schema`);
    this.name = 'ToolOutputInvalidError';
  }
}

/**
 * A tool as the registry and executor see it: generics erased, validation
 * closed over. Nothing outside this file needs the parameter types, and
 * erasing them here keeps every call site free of casts.
 */
export interface RegisteredTool {
  readonly name: string;
  readonly description: string;
  /** JSON Schema, for the catalogue row and for what is offered to the model. */
  readonly inputSchema: unknown;
  readonly outputSchema: unknown;
  /** A permission from the existing catalogue. Phase 4 adds no permissions. */
  readonly requiredPermission: string;
  /** Validate → execute → validate. Throws rather than returning bad data. */
  run(rawInput: unknown, context: ToolExecutionContext): Promise<unknown>;
}

function issuesOf(error: z.ZodError): readonly string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join('.');
    return path ? `${path}: ${issue.message}` : issue.message;
  });
}

function defineTool<Input, Output>(spec: {
  name: string;
  description: string;
  input: z.ZodType<Input, unknown>;
  output: z.ZodType<Output>;
  requiredPermission: string;
  execute: (input: Input, context: ToolExecutionContext) => Promise<Output>;
}): RegisteredTool {
  return {
    name: spec.name,
    description: spec.description,
    inputSchema: z.toJSONSchema(spec.input, { io: 'input' }),
    outputSchema: z.toJSONSchema(spec.output),
    requiredPermission: spec.requiredPermission,
    async run(rawInput, context) {
      const parsed = spec.input.safeParse(rawInput);
      if (!parsed.success) {
        throw new ToolInputInvalidError(issuesOf(parsed.error));
      }
      const result = await spec.execute(parsed.data, context);
      const checked = spec.output.safeParse(result);
      if (!checked.success) {
        throw new ToolOutputInvalidError(spec.name);
      }
      return checked.data;
    },
  };
}

// ---------------------------------------------------------------------------
// calculator
// ---------------------------------------------------------------------------

/**
 * Structured arithmetic — NOT an expression evaluator.
 *
 * A string expression would mean writing a parser and feeding it
 * model-authored text. An enum plus a bounded array of numbers has no such
 * surface and is exactly as useful for the cases a business agent needs.
 */
const calculator = defineTool({
  name: 'calculator',
  description:
    'Performs one arithmetic operation over a list of numbers and returns the result.',
  input: z
    .object({
      operation: z.enum(['add', 'subtract', 'multiply', 'divide']),
      operands: z.array(z.number().finite()).min(2).max(20),
    })
    .strict(),
  output: z.object({ result: z.number() }).strict(),
  requiredPermission: 'agents.test',
  async execute({ operation, operands }) {
    const [first, ...rest] = operands as [number, ...number[]];
    let result = first;
    for (const value of rest) {
      switch (operation) {
        case 'add':
          result += value;
          break;
        case 'subtract':
          result -= value;
          break;
        case 'multiply':
          result *= value;
          break;
        case 'divide':
          if (value === 0) {
            // A business error surfaced as a tool failure — never Infinity or
            // NaN quietly flowing back into the model's context.
            throw new ToolBusinessError('Division by zero is not defined.');
          }
          result /= value;
          break;
      }
    }
    if (!Number.isFinite(result)) {
      throw new ToolBusinessError('The calculation overflowed.');
    }
    return { result };
  },
});

// ---------------------------------------------------------------------------
// test_echo
// ---------------------------------------------------------------------------

const testEcho = defineTool({
  name: 'test_echo',
  description:
    'Returns the supplied value unchanged. Exercises the tool path end to end.',
  // Bounded by the maximum inbound message size, so a full-size message can
  // round-trip and the output clamp is exercised by something real.
  input: z.object({ value: z.string().max(10_000) }).strict(),
  output: z.object({ echoed: z.string() }).strict(),
  requiredPermission: 'agents.test',
  async execute({ value }) {
    return { echoed: value };
  },
});

// ---------------------------------------------------------------------------
// test_structured_output
// ---------------------------------------------------------------------------

const testStructuredOutput = defineTool({
  name: 'test_structured_output',
  description:
    'Produces a small structured object, for exercising schema validation of tool output.',
  input: z
    .object({
      subject: z.string().min(1).max(200),
      /** Bounded, so the output is bounded too. */
      itemCount: z.number().int().min(1).max(10).default(3),
    })
    .strict(),
  output: z
    .object({
      subject: z.string(),
      items: z.array(z.object({ index: z.number().int(), label: z.string() })),
      generatedBy: z.literal('test_structured_output'),
    })
    .strict(),
  requiredPermission: 'agents.test',
  async execute({ subject, itemCount }) {
    return {
      subject,
      items: Array.from({ length: itemCount }, (_, index) => ({
        index,
        label: `${subject} #${index + 1}`,
      })),
      generatedBy: 'test_structured_output' as const,
    };
  },
});

// ---------------------------------------------------------------------------
// deterministic_business_action
// ---------------------------------------------------------------------------

/**
 * A stand-in for a real business action.
 *
 * It requires `workflows.run` rather than `agents.test` on purpose: this is
 * the tool that proves an agent cannot take an action the ACTING MEMBERSHIP
 * lacks. A Knowledge Manager or Viewer session cannot run it no matter how
 * persuasively the model asks, and no matter what a retrieved document says.
 *
 * It performs no external side effect. Wiring a real one (ATS, calendar,
 * email) is a later phase and sits outside this phase's boundary.
 */
const deterministicBusinessAction = defineTool({
  name: 'deterministic_business_action',
  description:
    'Records a business action against a reference. Requires elevated permission.',
  input: z
    .object({
      actionType: z.enum([
        'schedule_followup',
        'mark_reviewed',
        'flag_for_attention',
      ]),
      reference: z.string().trim().min(1).max(120),
      note: z.string().trim().max(500).default(''),
    })
    .strict(),
  output: z
    .object({
      recorded: z.literal(true),
      actionType: z.string(),
      reference: z.string(),
      /** Echoed so a retry is visibly the SAME action, not a second one. */
      idempotencyKey: z.string(),
    })
    .strict(),
  requiredPermission: 'workflows.run',
  async execute({ actionType, reference }, context) {
    return {
      recorded: true as const,
      actionType,
      reference,
      idempotencyKey: context.idempotencyKey,
    };
  },
});

export const BUILT_IN_TOOLS: readonly RegisteredTool[] = [
  calculator,
  testEcho,
  testStructuredOutput,
  deterministicBusinessAction,
];

const BY_NAME = new Map<string, RegisteredTool>(
  BUILT_IN_TOOLS.map((tool) => [tool.name, tool]),
);

/** The implementation for a name, or null. A missing implementation is fatal. */
export function builtInTool(name: string): RegisteredTool | null {
  return BY_NAME.get(name) ?? null;
}
