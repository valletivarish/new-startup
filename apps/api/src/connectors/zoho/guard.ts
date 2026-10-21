/**
 * Nobody rejected, hired or closed in Zoho Recruit is ever called: every dial
 * (dashboard, /v1, link, test line, Zoho auto-call) passes through
 * startOutboundPhoneCall, which runs this first. A disconnect deletes the
 * applicant rows, so after it these people are ordinary candidates again.
 */

import { sql, withTenantContext, type Database } from '@platform/db';

import { ApiError } from '../../errors.js';

export async function assertNotClosedInZoho(
  database: Database,
  actor: { organizationId: string; userId: string },
  candidateId: string,
): Promise<void> {
  const rows = await withTenantContext(database.db, actor, (tx) =>
    tx.execute(sql`
      select 1 from zoho_applicants
      where organization_id = ${actor.organizationId} and candidate_id = ${candidateId} and closed
      limit 1
    `),
  );
  if (rows.length > 0) {
    throw new ApiError(
      'closed_in_ats',
      'This person was rejected, hired or closed in Zoho Recruit, so they can’t be called.',
    );
  }
}
