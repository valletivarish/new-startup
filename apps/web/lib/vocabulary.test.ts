import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// The old job/fit words must not come back (redesign spec, "Stages and words").
// Agent-domain "Live" (app/agents/**) stays; so do the stored values (`check`, `not_screened`).
const OLD_WORDS: [string, RegExp][] = [
  ['Open for calls', /Open for calls/],
  ['Open · test calls only', /Open · test/],
  ['Live and ready to call', /Live and ready to call|Live\. Ready for test calls/],
  ['Check as a fit lane', /['"`]Check['"`]|Check and Doesn/],
  ['Not screened', /Not screened/],
  ['LANE_LABEL.not_screened rendered', /LANE_LABEL\.not_screened/],
  ['No answer', /\bNo answer\b(?! recorded)/],
  ['Reached voicemail', /Reached voicemail/],
  ['Number not valid', /Number not valid/],
  ['Calling now', /Calling now/],
  ['Call didn’t connect', /Call didn[’']t connect/],
  ['On call', /\bOn call\b/],
];

const root = join(__dirname, '..');

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' || p === join(root, 'app/agents') ? [] : sources(p);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

describe('one vocabulary', () => {
  const files = ['app', 'components', 'lib'].flatMap((d) => sources(join(root, d)));

  it.each(OLD_WORDS)('no source uses "%s"', (_name, re) => {
    const hits = files.filter((f) => re.test(readFileSync(f, 'utf8'))).map((f) => relative(root, f));
    expect(hits).toEqual([]);
  });
});
