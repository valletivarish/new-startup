import { sql } from '@platform/db';

import { ApiError } from '../errors.js';

type AdvisoryLockTx = {
  execute(query: ReturnType<typeof sql>): Promise<unknown[]>;
};

export async function assertCanCreateAgent(
  tx: AdvisoryLockTx,
  orgId: string,
  countAgents: () => Promise<number>,
  limit: number,
): Promise<void> {
  await tx.execute(sql`
    select pg_advisory_xact_lock(hashtext('agent-create:' || ${orgId}))
  `);
  const n = await countAgents();
  if (n >= limit) {
    throw ApiError.conflict(
      'Agent limit reached for your plan. Upgrade to create more agents.',
    );
  }
}
