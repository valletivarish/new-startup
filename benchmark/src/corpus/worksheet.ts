/**
 * The recording worksheet — a tab-separated round trip between a spreadsheet
 * and the manifest.
 *
 * WHY NOT AN INTERACTIVE PROMPT: 75 utterances need 75 references, 35 of them
 * also need a Devanagari alternate, and the specification asks for at least 68
 * entity expectations. That is not a session anybody finishes in one sitting at
 * a terminal, and a prompt cannot be edited, diffed, reviewed or handed to a
 * second person. A TSV opens in any spreadsheet, survives interruption, and can
 * be read by the person who recorded the audio rather than only by the person
 * who wrote the tool.
 *
 * WHY NOT JSON BY HAND: the schema is strict on purpose, so a misplaced comma
 * in a 75-entry file is a validation cycle rather than a typo.
 *
 * THE ENTITY DSL, one cell, semicolons between entities:
 *
 *     name|kind|accept1/accept2|unit|reject1/reject2
 *
 *     notice_period|duration|90 days/ninety days|days
 *     relocate|text|can relocate/willing to relocate||cannot relocate/not able to relocate
 *
 * `unit` and `reject` are optional; leave them empty and keep the bars. The
 * parser reports the row, the column and what it expected, because a silent
 * mis-parse here becomes a wrong entity expectation, and a wrong expectation is
 * scored against every provider equally and invisibly.
 *
 * DELIMITERS ARE ESCAPED WITH A BACKSLASH. `CI/CD` is in this project's own
 * frozen line set, and an unescaped slash split it into "CI" and "CD" — a
 * corrupted expectation that no provider could ever satisfy, scored against all
 * of them, with nothing to see in the output. Write `CI\/CD` by hand, or let
 * the renderer escape it for you.
 */

import type { EntityExpectationInput, EntityKind } from './manifest.js';
import { EntityKind as EntityKindEnum } from './manifest.js';

export const WORKSHEET_COLUMNS = [
  'utteranceId',
  'conversationId',
  'turnIndex',
  'language',
  'environment',
  'speakerId',
  'codeMixed',
  'file',
  'reference',
  'referenceAlt',
  'entities',
  'notes',
] as const;

export type WorksheetColumn = (typeof WORKSHEET_COLUMNS)[number];

export interface WorksheetRow {
  readonly utteranceId: string;
  readonly conversationId: string;
  readonly turnIndex: number;
  readonly language: string;
  readonly environment: string;
  readonly speakerId: string;
  readonly codeMixed: boolean;
  readonly file: string;
  readonly reference: string;
  readonly referenceAlt: string;
  readonly entities: readonly EntityExpectationInput[];
  readonly notes: string;
}

export class WorksheetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorksheetError';
  }
}

/** A cell that must never contain a tab or a newline, because the format is TSV. */
function cell(value: string, row: number, column: string): string {
  if (/[\t\r\n]/.test(value)) {
    throw new WorksheetError(
      `Row ${row}, column "${column}" contains a tab or newline. The worksheet is ` +
        'tab-separated, so those characters would silently shift every later column. ' +
        'Replace them with spaces.',
    );
  }
  return value;
}

/** Delimiters that must survive inside a value rather than splitting it. */
const DELIMITERS = ['\\', '|', '/', ';'] as const;

export function escapeField(value: string): string {
  let out = value;
  for (const d of DELIMITERS) out = out.split(d).join(`\\${d}`);
  return out;
}

/**
 * Split on UNESCAPED occurrences of one delimiter, PRESERVING the escapes.
 *
 * Escapes survive the split because the format nests: entities are split on
 * `;`, then fields on `|`, then accept forms on `/`. Unescaping at the first
 * level would expose an inner delimiter to the second and split `CI\/CD` after
 * all — which is the bug this whole mechanism exists to prevent. Unescaping
 * happens once, at the leaf, in `unescapeField`.
 */
export function splitUnescaped(value: string, delimiter: string): string[] {
  const parts: string[] = [];
  let current = '';
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i] as string;
    if (char === '\\' && i + 1 < value.length) {
      current += char + value[i + 1];
      i += 1;
      continue;
    }
    if (char === delimiter) { parts.push(current); current = ''; continue; }
    current += char;
  }
  parts.push(current);
  return parts;
}

/** Remove one level of backslash escaping. Called only on a leaf value. */
export function unescapeField(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i] as string;
    if (char === '\\' && i + 1 < value.length) { out += value[i + 1]; i += 1; continue; }
    out += char;
  }
  return out;
}

export function renderEntities(entities: readonly EntityExpectationInput[]): string {
  return entities
    .map((e) =>
      [
        escapeField(e.name),
        escapeField(e.kind),
        e.accept.map(escapeField).join('/'),
        escapeField(e.unit ?? ''),
        (e.reject ?? []).map(escapeField).join('/'),
      ].join('|'),
    )
    .join(';');
}

export function parseEntities(raw: string, row: number): EntityExpectationInput[] {
  const trimmed = raw.trim();
  if (trimmed === '') return [];
  return splitUnescaped(trimmed, ';').filter((part) => part.trim() !== '').map((part, index) => {
    const fields = splitUnescaped(part, '|');
    if (fields.length < 3) {
      throw new WorksheetError(
        `Row ${row}, entity ${index + 1} ("${part.trim()}") has ${fields.length} field(s). ` +
          'The format is name|kind|accept1/accept2|unit|reject1/reject2 — at least the first ' +
          'three are required.',
      );
    }
    const [name = '', kind = '', accept = '', unit = '', reject = ''] = fields;
    const kinds = EntityKindEnum.options as readonly string[];
    if (!kinds.includes(unescapeField(kind).trim())) {
      throw new WorksheetError(
        `Row ${row}, entity "${name.trim()}" has kind "${kind.trim()}", which is not one of: ` +
          `${kinds.join(', ')}.`,
      );
    }
    const acceptForms = splitUnescaped(accept, '/')
      .map((f) => unescapeField(f).trim()).filter(Boolean);
    if (acceptForms.length === 0) {
      throw new WorksheetError(
        `Row ${row}, entity "${unescapeField(name).trim()}" has no accepted forms. At least one ` +
          'surface form ' +
          'that appears in the reference is required, or the expectation can never be satisfied.',
      );
    }
    const rejectForms = splitUnescaped(reject, '/')
      .map((f) => unescapeField(f).trim()).filter(Boolean);
    return {
      name: unescapeField(name).trim(),
      kind: unescapeField(kind).trim() as EntityKind,
      accept: acceptForms,
      ...(unescapeField(unit).trim() ? { unit: unescapeField(unit).trim() } : {}),
      ...(rejectForms.length > 0 ? { reject: rejectForms } : {}),
    };
  });
}

export function renderWorksheet(rows: readonly WorksheetRow[]): string {
  const lines = [WORKSHEET_COLUMNS.join('\t')];
  rows.forEach((row, index) => {
    const line = index + 2;
    lines.push([
      cell(row.utteranceId, line, 'utteranceId'),
      cell(row.conversationId, line, 'conversationId'),
      String(row.turnIndex),
      cell(row.language, line, 'language'),
      cell(row.environment, line, 'environment'),
      cell(row.speakerId, line, 'speakerId'),
      row.codeMixed ? 'yes' : 'no',
      cell(row.file, line, 'file'),
      cell(row.reference, line, 'reference'),
      cell(row.referenceAlt, line, 'referenceAlt'),
      cell(renderEntities(row.entities), line, 'entities'),
      cell(row.notes, line, 'notes'),
    ].join('\t'));
  });
  return lines.join('\n') + '\n';
}

export function parseWorksheet(text: string): WorksheetRow[] {
  // A byte-order mark from a spreadsheet export would make the first column
  // name unrecognisable and every row's utteranceId empty.
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  const header = lines.shift();
  if (!header) throw new WorksheetError('The worksheet is empty.');

  const columns = header.split('\t').map((c) => c.trim());
  const missing = WORKSHEET_COLUMNS.filter((c) => !columns.includes(c));
  if (missing.length > 0) {
    throw new WorksheetError(
      `The worksheet header is missing: ${missing.join(', ')}. Columns may be reordered but not ` +
        'removed — a missing column would silently drop whatever it held.',
    );
  }
  const index = (name: WorksheetColumn) => columns.indexOf(name);

  return lines.map((line, offset) => {
    const row = offset + 2;
    const fields = line.split('\t');
    // A short row used to read '' for every column past the end, so a
    // spreadsheet that dropped trailing empties turned a written reference into
    // a silently skipped one — and an entity expectation into nothing.
    if (fields.length !== columns.length) {
      throw new WorksheetError(
        `Row ${row} has ${fields.length} column(s); the header has ${columns.length}. Some ` +
          'spreadsheets drop trailing empty cells on export — keep the tabs, or export as ' +
          '"tab separated values" rather than copying the visible grid.',
      );
    }
    if (fields.some((f) => f.startsWith('"') && f.endsWith('"') && f.length > 1)) {
      throw new WorksheetError(
        `Row ${row} looks quoted (a cell begins and ends with a double quote). This parser is ` +
          'plain TSV and does not unquote — export without quoting, or the quotes become part ' +
          'of the reference text and every provider is scored against them.',
      );
    }
    const at = (name: WorksheetColumn) => (fields[index(name)] ?? '').trim();

    const turnIndex = Number(at('turnIndex'));
    if (!Number.isInteger(turnIndex) || turnIndex < 0) {
      throw new WorksheetError(
        `Row ${row} has turnIndex "${at('turnIndex')}", which is not a non-negative integer. ` +
          'Turn order decides how conversation history is replayed.',
      );
    }
    const codeMixedRaw = at('codeMixed').toLowerCase();
    if (!['yes', 'no', 'true', 'false', ''].includes(codeMixedRaw)) {
      throw new WorksheetError(
        `Row ${row} has codeMixed "${at('codeMixed')}". Use yes or no — this flag selects the ` +
          'sample for the Hinglish sub-gate, so a typo silently changes which utterances it ' +
          'judges.',
      );
    }

    return {
      utteranceId: at('utteranceId'),
      conversationId: at('conversationId'),
      turnIndex,
      language: at('language'),
      environment: at('environment'),
      speakerId: at('speakerId'),
      codeMixed: codeMixedRaw === 'yes' || codeMixedRaw === 'true',
      file: at('file'),
      reference: at('reference'),
      referenceAlt: at('referenceAlt'),
      entities: parseEntities(at('entities'), row),
      notes: at('notes'),
    };
  });
}

/** Rows whose reference is still blank — the ones still to be written. */
export function unfilledRows(rows: readonly WorksheetRow[]): WorksheetRow[] {
  return rows.filter((r) => r.reference.trim() === '');
}
