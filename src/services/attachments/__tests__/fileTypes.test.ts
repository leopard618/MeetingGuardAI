import { attachmentCategoryOf, displayFileName, fileSizeParts, resolveMimeType, safeFileName } from '../fileTypes';

describe('resolveMimeType', () => {
  it('keeps a specific reported type (lower case, without parameters, aliases resolved)', () => {
    expect(resolveMimeType('Application/PDF', 'x')).toBe('application/pdf');
    expect(resolveMimeType('text/plain; charset=utf-8', 'notes.txt')).toBe('text/plain');
    expect(resolveMimeType('image/jpg', 'photo')).toBe('image/jpeg');
    expect(resolveMimeType('audio/mp3', 'song')).toBe('audio/mpeg');
  });

  it('falls back to the extension for a missing or generic type', () => {
    expect(resolveMimeType(null, 'Budget Q3.XLSX')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(resolveMimeType('application/octet-stream', 'slides.pptx')).toBe(
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    );
    expect(resolveMimeType('', 'IMG_0001.HEIC')).toBe('image/heic');
    expect(resolveMimeType(undefined, 'no-extension')).toBeNull();
  });
});

describe('attachmentCategoryOf', () => {
  it('maps supported types to their category and rejects the rest', () => {
    expect(attachmentCategoryOf('application/pdf')).toBe('documents');
    expect(attachmentCategoryOf('image/png')).toBe('images');
    expect(attachmentCategoryOf('video/quicktime')).toBe('videos');
    expect(attachmentCategoryOf('audio/mpeg')).toBe('audio');
    expect(attachmentCategoryOf('application/zip')).toBe('archives');
    expect(attachmentCategoryOf('application/x-msdownload')).toBeNull();
    expect(attachmentCategoryOf(null)).toBeNull();
  });
});

describe('safeFileName / displayFileName', () => {
  it('replaces path separators and unusual characters', () => {
    expect(safeFileName('../../etc/passwd')).toBe('__.._etc_passwd');
    expect(safeFileName('Informe año 2026.pdf')).toBe('Informe_a_o_2026.pdf');
    expect(safeFileName('   ')).toBe('file');
  });

  it('caps long names and keeps the extension', () => {
    const name = safeFileName(`${'a'.repeat(300)}.docx`);
    expect(name).toHaveLength(120);
    expect(name.endsWith('.docx')).toBe(true);
  });

  it('never returns an empty display name', () => {
    expect(displayFileName('  ', 'file')).toBe('file');
    expect(displayFileName(null, 'file')).toBe('file');
    expect(displayFileName(' Plan.pdf ', 'file')).toBe('Plan.pdf');
  });
});

describe('fileSizeParts', () => {
  it('uses bytes, KB, MB and GB with one decimal', () => {
    expect(fileSizeParts(512)).toEqual({ value: 512, unit: 'b' });
    expect(fileSizeParts(1536)).toEqual({ value: 1.5, unit: 'kb' });
    expect(fileSizeParts(5 * 1024 * 1024)).toEqual({ value: 5, unit: 'mb' });
    expect(fileSizeParts(3.25 * 1024 * 1024 * 1024)).toEqual({ value: 3.3, unit: 'gb' });
  });

  it('moves to the next unit when rounding reaches 1024', () => {
    expect(fileSizeParts(1024 * 1024 - 1)).toEqual({ value: 1, unit: 'mb' });
  });

  it('treats invalid sizes as zero bytes', () => {
    expect(fileSizeParts(Number.NaN)).toEqual({ value: 0, unit: 'b' });
    expect(fileSizeParts(-5)).toEqual({ value: 0, unit: 'b' });
  });
});
