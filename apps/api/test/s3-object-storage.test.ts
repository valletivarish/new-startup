import { describe, expect, it } from 'vitest';

import { __testOnly } from '../src/knowledge/s3-object-storage.js';

describe('s3 object key namespacing', () => {
  it('prefixes keys with organization id', () => {
    expect(__testOnly.objectKey('org-a', 'docs/jd.pdf')).toBe('org-a/docs/jd.pdf');
  });

  it('rejects traversal in organization id', () => {
    expect(() => __testOnly.objectKey('../x', 'a')).toThrow(/unsafe organization/);
  });

  it('rejects traversal in object key', () => {
    expect(() => __testOnly.objectKey('org', '../etc/passwd')).toThrow(/unsafe key/);
  });
});
