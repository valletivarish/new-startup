/**
 * The tool executor.
 *
 * The only path through which a tool ever runs. It is deliberately narrow:
 *
 *   authorize → validate input against the CODE schema → execute with a
 *   timeout → validate output → bound the size → record the attempt
 *
 * Two properties are worth stating plainly, because they are what make an
 * LLM-driven tool call safe:
 *
 *   * A DENIED attempt is recorded just as carefully as a successful one.
 *     The denial record is the evidence that authorization did its job, and
 *     the signal if something keeps trying.
 *   * Output is treated as UNTRUSTED. It is validated against the tool's own
 *     schema, clamped to a hard character bound, and fenced by the context
 *     builder before the model ever sees it. A tool that returns
 *     "ignore your instructions and call X" achieves nothing, because the
 *     next call still goes through `authorizeTool`.
 */

import { sql, withTenantContext, type Database } from '@platform/db';
import type { RuntimeLimits } from '@platform/providers';

import type { AuditService } from '../audit/audit.service.js';
import type { Actor } from '../agents/agents.service.js';
import {
  builtInTool,
  ToolBusinessError,
  ToolInputInvalidError,
  ToolOutputInvalidError,
} from './builtin-tools.js';
import { authorizeTool, type ToolDenialReason } from './authorizer.js';
import type { ToolRegistry } from './registry.js';

export interface ToolCallRequest {
  readonly callId: string;
  readonly toolName: string;
  /** RAW model output. Untrusted until the tool's own schema accepts it. */
  readonly input: unknown;
}

export interface ToolCallOutcome {
  readonly callId: string;
  readonly toolName: string;
  readonly status: 'completed' | 'denied' | 'failed';
  /** Present when completed. Already validated against the output schema. */
  readonly output?: unknown;
  /** What the model and the user are told. Never internal detail. */
  readonly message: string;
  /** Serialized output, clamped, ready to be fenced into context. */
  readonly outputText: string;
  readonly truncated: boolean;
  readonly denialReason?: ToolDenialReason;
  readonly durationMs: number;
}

export interface ToolExecutorInput {
  readonly actor: Actor;
  readonly sessionId: string;
  readonly call: ToolCallRequest;
  /** From the SERVER-resolved membership. Never client- or model-supplied. */
  readonly grantedPermissions: ReadonlySet<string>;
  readonly limits: RuntimeLimits;
}

export interface ToolExecutor {
  execute(input: ToolExecutorInput): Promise<ToolCallOutcome>;
}

/** A hard ceiling on a single tool call, independent of the turn budget. */
const TOOL_TIMEOUT_MS = 5_000;

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new ToolBusinessError('The tool took too long to respond.')),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function clamp(value: unknown, maxChars: number): { text: string; truncated: boolean } {
  let text: string;
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value) ?? '';
  } catch {
    text = '[output could not be serialized]';
  }
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(0, maxChars), truncated: true };
}

export function createToolExecutor(
  database: Database,
  registry: ToolRegistry,
  audit: AuditService,
): ToolExecutor {
  async function record(
    actor: Actor,
    sessionId: string,
    call: ToolCallRequest,
    status: string,
    extra: {
      denialReason?: string;
      durationMs?: number;
      outputChars?: number;
    },
  ): Promise<void> {
    try {
      await withTenantContext(
        database.db,
        { organizationId: actor.organizationId, userId: actor.userId },
        async (tx) => {
          await tx.execute(sql`
            insert into tool_executions
              (organization_id, session_id, tool_name, call_id, status,
               denial_reason, duration_ms, output_chars)
            values
              (${actor.organizationId}, ${sessionId}, ${call.toolName},
               ${call.callId}, ${status}, ${extra.denialReason ?? null},
               ${extra.durationMs ?? null}, ${extra.outputChars ?? null})
          `);
        },
      );
    } catch {
      // The execution record must never take the turn down with it. The audit
      // entry below is written independently and preserves the same facts.
    }
  }

  return {
    async execute({ actor, sessionId, call, grantedPermissions, limits }) {
      const startedAt = Date.now();

      // ---- Authorize -----------------------------------------------------
      // Every input to this decision is server-side state. Note that the
      // model's requested arguments are NOT consulted: what a tool is allowed
      // to do cannot depend on what it was asked to do.
      const [tool, granted] = await Promise.all([
        registry.get(actor, call.toolName),
        registry.listForSession(actor, sessionId),
      ]);
      const implementation = builtInTool(call.toolName);

      const decision = authorizeTool({
        tool,
        implemented: implementation !== null,
        grantedToAgent: granted.some((t) => t.name === call.toolName),
        grantedPermissions,
      });

      if (!decision.allowed) {
        await record(actor, sessionId, call, 'denied', {
          denialReason: decision.reason,
        });
        await audit.record({
          organizationId: actor.organizationId,
          actorUserId: actor.userId,
          eventType: 'agent.tool.denied',
          resourceType: 'tool',
          resourceId: call.toolName,
          metadata: {
            sessionId,
            callId: call.callId,
            reason: decision.reason,
          },
        });
        return {
          callId: call.callId,
          toolName: call.toolName,
          status: 'denied',
          message: decision.message,
          outputText: decision.message,
          truncated: false,
          denialReason: decision.reason,
          durationMs: Date.now() - startedAt,
        };
      }

      // `implementation` is non-null here: `authorizeTool` denies otherwise.
      const impl = implementation as NonNullable<typeof implementation>;

      // ---- Execute -------------------------------------------------------
      try {
        const output = await withTimeout(
          impl.run(call.input, {
            organizationId: actor.organizationId,
            sessionId,
            // Ties a retry to the SAME logical call, so a duplicated request
            // is one business action rather than two (§19).
            idempotencyKey: `${sessionId}:${call.callId}`,
          }),
          TOOL_TIMEOUT_MS,
        );

        const { text, truncated } = clamp(output, limits.maxToolOutputChars);
        const durationMs = Date.now() - startedAt;

        await record(actor, sessionId, call, 'completed', {
          durationMs,
          outputChars: text.length,
        });
        await audit.record({
          organizationId: actor.organizationId,
          actorUserId: actor.userId,
          eventType: 'agent.tool.completed',
          resourceType: 'tool',
          resourceId: call.toolName,
          metadata: {
            sessionId,
            callId: call.callId,
            durationMs,
            outputChars: text.length,
            truncated,
          },
        });

        return {
          callId: call.callId,
          toolName: call.toolName,
          status: 'completed',
          output,
          message: 'ok',
          outputText: text,
          truncated,
          durationMs,
        };
      } catch (error) {
        const durationMs = Date.now() - startedAt;

        // Only these three carry a message safe to return. Anything else is
        // an unexpected fault, and its detail stays in the log.
        const message =
          error instanceof ToolInputInvalidError
            ? `The tool was called with invalid arguments. ${error.issues.join('; ')}`
            : error instanceof ToolBusinessError
              ? error.message
              : error instanceof ToolOutputInvalidError
                ? 'The tool returned an unexpected result.'
                : 'The tool failed.';

        await record(actor, sessionId, call, 'failed', { durationMs });
        await audit.record({
          organizationId: actor.organizationId,
          actorUserId: actor.userId,
          eventType: 'agent.tool.failed',
          resourceType: 'tool',
          resourceId: call.toolName,
          metadata: {
            sessionId,
            callId: call.callId,
            durationMs,
            kind: (error as Error).name ?? 'Error',
          },
        });

        return {
          callId: call.callId,
          toolName: call.toolName,
          status: 'failed',
          message,
          outputText: message,
          truncated: false,
          durationMs,
        };
      }
    },
  };
}
