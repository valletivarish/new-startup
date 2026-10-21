/**
 * Language pieces of an own-loop call plan, decided once when the call starts:
 *
 *   sttProviderFor     Deepgram Nova-3 has every launch language except Malayalam;
 *                      those calls listen with Google Speech-to-Text (apps/voice).
 *   localizeGreeting   the job's opening line, translated by Gemini into the call
 *                      language. Null on any failure: the caller keeps the English line.
 */

import { GEMINI_BASE } from '../gemini/endpoint.js';
import type { ScreeningLanguage } from '../../hiring/jobs.service.js';

export type SttProvider = 'deepgram' | 'google';

export const LANGUAGE_NAMES: Record<ScreeningLanguage, string> = {
  en: 'English', hi: 'Hindi', bn: 'Bengali', mr: 'Marathi', te: 'Telugu', ta: 'Tamil',
  gu: 'Gujarati', ur: 'Urdu', kn: 'Kannada', ml: 'Malayalam', pa: 'Punjabi',
};

/** Launch languages Deepgram Nova-3 cannot transcribe. */
const GOOGLE_STT_LANGUAGES: ReadonlySet<string> = new Set(['ml']);

export function sttProviderFor(language: string): SttProvider {
  return GOOGLE_STT_LANGUAGES.has(language) ? 'google' : 'deepgram';
}

export interface GreetingDeps {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  fetchFn?: typeof fetch;
}

export async function localizeGreeting(
  english: string,
  language: string,
  deps: GreetingDeps,
  /** Who speaks it, for languages that gender the speaker's verbs (Hindi "bol rahi hoon"). */
  speaker?: 'woman' | 'man',
): Promise<string | null> {
  const name = LANGUAGE_NAMES[language as ScreeningLanguage];
  if (!english.trim() || !name || language === 'en' || !deps.apiKey.trim()) return null;
  const model = deps.model?.trim() || 'gemini-2.5-flash-lite';
  const url = `${deps.baseUrl || GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent`;
  const prompt = [
    `Translate this phone greeting into natural, polite spoken ${name}, written in ${name} script.`,
    ...(speaker ? [`The speaker is a ${speaker}: use the grammatical gender that matches when the speaker refers to themself.`] : []),
    'Keep person and company names exactly as written, in English letters; never transliterate them.',
    'English words people normally say in India (CTC, notice period, Java) may stay in English.',
    'Reply with the translated greeting only: no quotes, notes or alternatives.',
    '',
    english.trim(),
  ].join('\n');
  try {
    const res = await (deps.fetchFn ?? fetch)(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': deps.apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 400 },
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = (body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '')
      .trim()
      .replace(/^["'“”]+|["'“”]+$/g, '')
      .trim();
    // No Indic (or Urdu) letters means the model did not translate it.
    const indic = [...text].some((ch) => {
      const c = ch.codePointAt(0) ?? 0;
      return (c >= 0x600 && c <= 0x6ff) || (c >= 0x900 && c <= 0xdff);
    });
    return text && text.length <= 1000 && indic ? text : null;
  } catch {
    return null;
  }
}
