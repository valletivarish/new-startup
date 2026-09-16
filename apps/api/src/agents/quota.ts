import { ApiError } from '../errors.js';

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
