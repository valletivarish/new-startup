/**
 * Deterministic EmbeddingProvider.
 *
 * NOT a production embedding model, and deliberately so: no embedding
 * provider is selected (ADR-006 condition, 12_ARCHITECTURE_DECISIONS_FINAL
 * §D2), and installing one now would embed a vendor choice the architecture
 * exists to defer.
 *
 * What it IS: a real implementation of the real interface that produces
 * stable, content-derived unit vectors. That makes the whole pipeline —
 * chunking, vector storage, similarity search, thresholds, re-indexing —
 * testable and demonstrable today, with EXACT expected results rather than
 * "the numbers look plausible".
 *
 * The vectors carry genuine lexical signal: each token is hashed into a bag
 * of dimensions, so documents sharing vocabulary score higher than documents
 * that do not. That is enough to verify retrieval ranking is wired correctly.
 * It is not semantic similarity, and this file does not pretend otherwise.
 */

import { createHash } from 'node:crypto';
import type { EmbeddingProvider } from '@platform/providers';

const DIMENSIONS = 1536;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

/** Stable 32-bit hash of a token, used to pick its dimensions. */
function hashToken(token: string): number {
  const digest = createHash('sha256').update(token).digest();
  return digest.readUInt32BE(0);
}

export function createDeterministicEmbeddingProvider(): EmbeddingProvider {
  return {
    name: 'deterministic-hash-v1',
    dimensions: DIMENSIONS,

    async embed(texts) {
      const vectors = texts.map((text) => {
        const vector = new Array<number>(DIMENSIONS).fill(0);
        const tokens = tokenize(text);

        for (const token of tokens) {
          const h = hashToken(token);
          // Three dimensions per token: enough overlap for shared vocabulary
          // to register, sparse enough that unrelated text stays far apart.
          const slots = [h % DIMENSIONS, (h >>> 8) % DIMENSIONS, (h >>> 16) % DIMENSIONS];
          const sign = (h >>> 24) % 2 === 0 ? 1 : -1;
          for (const slot of slots) vector[slot] = (vector[slot] ?? 0) + sign;
        }

        // Unit-normalise so cosine similarity is well behaved. An empty or
        // stopword-only text yields a zero vector, which is a legitimate
        // "nothing to match" rather than an error.
        const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
        if (magnitude === 0) return vector;
        return vector.map((v) => v / magnitude);
      });

      return {
        vectors,
        usage: {
          serviceType: 'embedding',
          provider: 'deterministic-hash-v1',
          quantity: texts.reduce((n, t) => n + t.length, 0),
          unit: 'characters',
        },
      };
    },
  };
}
