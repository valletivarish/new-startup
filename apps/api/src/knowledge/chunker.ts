/**
 * Deterministic chunking.
 *
 * Splits on structure first (markdown headings, then blank lines), packing
 * paragraphs up to a target size and carrying a small overlap so a fact
 * spanning a boundary is not lost to both chunks.
 *
 * Deliberately NOT semantic chunking: that needs a model, which this phase
 * does not have, and getting it wrong silently degrades every retrieval. The
 * `Chunker` interface makes the strategy replaceable when there is something
 * better to replace it with.
 *
 * Determinism matters beyond tidiness — the same document must produce the
 * same chunks on every re-index, or a retry would churn the vector store.
 */

import type { Chunker, TextChunk } from '@platform/providers';

/** Rough token estimate. Good enough for budgeting, not for billing. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

interface Block {
  readonly text: string;
  readonly section: string | null;
}

/** Splits into blocks, tracking the nearest markdown heading as the section. */
function toBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let section: string | null = null;

  for (const raw of text.split(/\n{2,}/)) {
    const block = raw.trim();
    if (block.length === 0) continue;

    const heading = /^(#{1,6})\s+(.+)$/m.exec(block);
    if (heading?.[2] && block.startsWith('#')) {
      section = heading[2].trim();
      // A heading alone is not content, but it labels what follows.
      const remainder = block.replace(/^#{1,6}\s+.+$/m, '').trim();
      if (remainder.length === 0) continue;
      blocks.push({ text: remainder, section });
      continue;
    }
    blocks.push({ text: block, section });
  }
  return blocks;
}

export function createChunker(): Chunker {
  return {
    name: 'structural-v1',

    chunk({ text, targetChars, overlapChars }) {
      const blocks = toBlocks(text);
      const chunks: TextChunk[] = [];

      let buffer = '';
      let bufferSection: string | null = null;

      const flush = () => {
        const content = buffer.trim();
        if (content.length === 0) return;
        chunks.push({
          index: chunks.length,
          content,
          section: bufferSection,
          tokenEstimate: estimateTokens(content),
        });
        // Carry a tail of the previous chunk so a sentence split across the
        // boundary remains retrievable from either side.
        buffer =
          overlapChars > 0 && content.length > overlapChars
            ? content.slice(-overlapChars)
            : '';
      };

      for (const block of blocks) {
        // A single oversized block is hard-split rather than emitted whole.
        if (block.text.length > targetChars) {
          flush();
          bufferSection = block.section;
          for (let i = 0; i < block.text.length; i += targetChars) {
            const slice = block.text.slice(i, i + targetChars);
            chunks.push({
              index: chunks.length,
              content: slice.trim(),
              section: block.section,
              tokenEstimate: estimateTokens(slice),
            });
          }
          buffer = '';
          continue;
        }

        if (buffer.length + block.text.length + 2 > targetChars) flush();
        if (buffer.length === 0) bufferSection = block.section;
        buffer = buffer.length > 0 ? `${buffer}\n\n${block.text}` : block.text;
      }
      flush();

      // Re-index after the hard-split path may have interleaved.
      return chunks.map((c, i) => ({ ...c, index: i }));
    },
  };
}
