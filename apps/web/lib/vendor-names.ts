/**
 * Vendor names the UI must never show. This is a redaction list, the opposite
 * of a dependency: errors.ts drops any server text that matches it. Declared
 * in the production-boundary test as the one web file allowed to name them.
 */
export const VENDOR_NAME =
  /\b(?:eleven[\s-]?labs|11\s?labs|exotel|gemini|sarvam|deepgram|cartesia|plivo|twilio|open ?ai|anthropic|google|claude|gpt|azure|aws|postgres(?:ql)?|redis)\b/i;
