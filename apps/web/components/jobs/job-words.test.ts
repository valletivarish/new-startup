import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/** The job pages talk about the call and who calls, never "the agent". */
const ROOTS = [__dirname, join(__dirname, '../../app/jobs')];
const AGENT = /\bagents?\b/i;

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? files(join(dir, e.name))
      : /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)
        ? [join(dir, e.name)]
        : [],
  );
}

/** User-facing copy: JSX text, or a string with a space in it (ids, hrefs, permissions have none). */
function agentCopy(file: string): string[] {
  const src = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const hits: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) return;
    if (
      ts.isJsxText(n) ||
      ts.isStringLiteral(n) ||
      ts.isNoSubstitutionTemplateLiteral(n) ||
      ts.isTemplateHead(n) ||
      ts.isTemplateMiddle(n) ||
      ts.isTemplateTail(n)
    ) {
      const text = n.text;
      if (AGENT.test(text) && (ts.isJsxText(n) || /\s/.test(text.trim()))) hits.push(text.trim());
    }
    ts.forEachChild(n, visit);
  };
  visit(src);
  return hits.map((h) => `${file.split('/').slice(-2).join('/')}: ${h}`);
}

describe('job page copy', () => {
  it('never says "agent" to the user', () => {
    expect(ROOTS.flatMap(files).flatMap(agentCopy)).toEqual([]);
  });
});
