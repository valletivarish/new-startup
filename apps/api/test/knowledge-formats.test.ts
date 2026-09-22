import { describe, expect, it } from 'vitest';

import { validateUpload, MAX_DOCUMENT_BYTES } from '../src/knowledge/formats.js';
import { extractDocumentText } from '../src/knowledge/document-text.js';

describe('knowledge formats', () => {
  it('accepts utf-8 plain text', () => {
    const bytes = new TextEncoder().encode('Hello hiring handbook');
    expect(
      validateUpload({
        name: 'handbook.txt',
        contentType: 'text/plain',
        bytes,
      }),
    ).toBe('text/plain');
  });

  it('rejects oversized uploads', () => {
    const bytes = new Uint8Array(MAX_DOCUMENT_BYTES + 1);
    expect(() =>
      validateUpload({
        name: 'big.txt',
        contentType: 'text/plain',
        bytes,
      }),
    ).toThrow();
  });

  it('rejects fake pdf magic bytes', () => {
    const bytes = new TextEncoder().encode('not a pdf');
    expect(() =>
      validateUpload({
        name: 'resume.pdf',
        contentType: 'application/pdf',
        bytes,
      }),
    ).toThrow();
  });
});

describe('document text extract', () => {
  it('extracts markdown', async () => {
    const bytes = new TextEncoder().encode('# Role\n\nMust know TypeScript.');
    const text = await extractDocumentText('text/markdown', bytes);
    expect(text).toContain('Must know TypeScript');
  });

  it('extracts text from a minimal PDF', async () => {
    // Minimal PDF with a single Helvetica text show operator.
    const pdf = `%PDF-1.4
1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj
2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj
3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources<< /Font<< /F1 5 0 R >> >> >>endobj
4 0 obj<< /Length 55 >>stream
BT /F1 24 Tf 40 80 Td (Backend Engineer role) Tj ET
endstream
endobj
5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000266 00000 n 
0000000371 00000 n 
trailer<< /Size 6 /Root 1 0 R >>
startxref
444
%%EOF
`;
    const bytes = new TextEncoder().encode(pdf);
    expect(
      validateUpload({
        name: 'jd.pdf',
        contentType: 'application/pdf',
        bytes,
      }),
    ).toBe('application/pdf');
    const text = await extractDocumentText('application/pdf', bytes);
    expect(text.toLowerCase()).toContain('backend engineer');
  });

  it('extracts text from a minimal DOCX', async () => {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    zip.file(
      '[Content_Types].xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
    );
    zip.folder('_rels')!.file(
      '.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
    );
    zip.folder('word')!.file(
      'document.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>Must ask notice period and CTC.</w:t></w:r></w:p></w:body>
</w:document>`,
    );
    const bytes = new Uint8Array(await zip.generateAsync({ type: 'uint8array' }));
    const ctype =
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    expect(validateUpload({ name: 'jd.docx', contentType: ctype, bytes })).toBe(ctype);
    const text = await extractDocumentText(ctype, bytes);
    expect(text.toLowerCase()).toContain('notice period');
  });

  it('extracts text from a minimal PPTX', async () => {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    zip.file(
      '[Content_Types].xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`,
    );
    zip.folder('ppt')!.folder('slides')!.file(
      'slide1.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Screening questions for backend role</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>
</p:sld>`,
    );
    const bytes = new Uint8Array(await zip.generateAsync({ type: 'uint8array' }));
    const ctype =
      'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    expect(validateUpload({ name: 'deck.pptx', contentType: ctype, bytes })).toBe(ctype);
    const text = await extractDocumentText(ctype, bytes);
    expect(text.toLowerCase()).toContain('screening questions');
  });
});
