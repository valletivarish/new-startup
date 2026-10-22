import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..');
const DIRS = ['app', 'components', 'lib', 'features'];

// A string literal that starts with a retired path is a navigation target. API paths start with
// /backend or /v1, so `/backend/jobs/${id}/candidates` is not caught.
const RETIRED = [
  /['"`](?:\/dashboard|\/candidates|\/analytics|\/knowledge|\/tools)(?![\w-])/,
  /%2F(?:dashboard|candidates|analytics|knowledge|tools)(?![\w-])/,
  /['"`]\/jobs\/[^'"`]*\/candidates(?![\w-])/,
  /['"`]\/settings\?section=team/,
];

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : sources(p);
    const skip = /\.test\.tsx?$/.test(e.name) || relative(root, p) === 'lib/redirects.ts';
    return /\.tsx?$/.test(e.name) && !skip ? [p] : [];
  });
}

describe('retired URLs', () => {
  it('are not linked to from the app', () => {
    const hits = DIRS.flatMap((d) => sources(join(root, d))).flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .flatMap((line, i) =>
          RETIRED.some((re) => re.test(line)) ? [`${relative(root, file)}:${i + 1}: ${line.trim()}`] : [],
        ),
    );
    expect(hits).toEqual([]);
  });
});
