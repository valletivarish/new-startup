/**
 * Re-runnable PO Q3 migrator: baked agent JD/must-ask → Job screening.
 *
 * Prefer `pnpm db:migrate` (applies 0021 once). Use this to re-run safely —
 * jobs that already have Job screening are left alone.
 *
 * Requires DATABASE_MIGRATION_URL (platform_migrator), same as db:migrate.
 */

import { createDatabase } from '../client.js';
import { backfillJobScreeningFromAgents } from '../backfill-job-screening-from-agents.js';

const url = process.env['DATABASE_MIGRATION_URL'];
if (!url) {
  console.error(
    'DATABASE_MIGRATION_URL is not set. Copy .env.example to .env, or export it.',
  );
  process.exit(1);
}

const database = createDatabase({ url, maxConnections: 1 });
try {
  console.log(
    'backfill-job-screening: copying agent must-ask / knowledge → empty jobs…',
  );
  const result = await backfillJobScreeningFromAgents(database.db);
  console.log(
    `backfill-job-screening: done — jobsQuestionsFilled=${result.jobsQuestionsFilled} knowledgeLinksCreated=${result.knowledgeLinksCreated}`,
  );
} catch (error) {
  console.error('backfill-job-screening failed:', error);
  process.exitCode = 1;
} finally {
  await database.close();
}
