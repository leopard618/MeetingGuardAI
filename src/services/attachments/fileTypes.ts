/**
 * PURE helpers of the attachments area: supported file types, MIME resolution (with a file
 * extension fallback, because pickers often report "application/octet-stream"), safe on-device
 * file names and human-readable sizes. No React Native, Expo or storage imports.
 */
import type { AttachmentCategory } from '../data';

export const MAX_ATTACHMENT_MB = 50;
export const MAX_ATTACHMENT_BYTES = MAX_ATTACHMENT_MB * 1024 * 1024;

/** MIME types accepted per category (lower case, without parameters). */
export const SUPPORTED_MIME_TYPES: Readonly<Record<AttachmentCategory, readonly string[]>> = {
  documents: [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/rtf',
    'text/plain',
    'text/csv',
    'text/markdown',
  ],
  images: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/heic', 'image/heif'],
  videos: ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm', 'video/3gpp'],
  audio: ['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/aac', 'audio/mp4', 'audio/x-m4a', 'audio/webm'],
  archives: ['application/zip', 'application/x-zip-compressed', 'application/x-rar-compressed', 'application/vnd.rar', 'application/x-7z-compressed', 'application/x-tar', 'application/gzip'],
};

/** Non-standard spellings some pickers report, mapped to the canonical type. */
const MIME_ALIASES: Readonly<Record<string, string>> = {
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
  'audio/mp3': 'audio/mpeg',
  'audio/x-mp3': 'audio/mpeg',
  'video/avi': 'video/x-msvideo',
  'video/mov': 'video/quicktime',
  'application/x-gzip': 'application/gzip',
};

const EXTENSION_MIME: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  rtf: 'application/rtf',
  txt: 'text/plain',
  csv: 'text/csv',
  md: 'text/markdown',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  heic: 'image/heic',
  heif: 'image/heif',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  webm: 'video/webm',
  '3gp': 'video/3gpp',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  aac: 'audio/aac',
  m4a: 'audio/mp4',
  zip: 'application/zip',
  rar: 'application/vnd.rar',
  '7z': 'application/x-7z-compressed',
  tar: 'application/x-tar',
  gz: 'application/gzip',
};

/** Types that say nothing about the content: the file extension decides instead. */
const GENERIC_MIME_TYPES: ReadonlySet<string> = new Set(['', 'application/octet-stream', 'binary/octet-stream', 'application/unknown']);

function fileExtension(fileName: string): string {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(fileName.trim());
  return match?.[1]?.toLowerCase() ?? '';
}

/**
 * The canonical MIME type of a picked file: the reported type (lower case, parameters and
 * aliases resolved) or, when that is missing or generic, the type implied by the extension.
 * null when neither says anything.
 */
export function resolveMimeType(reported: string | null | undefined, fileName: string): string | null {
  const base = (reported ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  const canonical = MIME_ALIASES[base] ?? base;
  if (!GENERIC_MIME_TYPES.has(canonical)) return canonical;
  return EXTENSION_MIME[fileExtension(fileName)] ?? null;
}

/** Category of a canonical MIME type, or null when the type is not supported. */
export function attachmentCategoryOf(mimeType: string | null): AttachmentCategory | null {
  if (!mimeType) return null;
  for (const [category, types] of Object.entries(SUPPORTED_MIME_TYPES) as [AttachmentCategory, readonly string[]][]) {
    if (types.includes(mimeType)) return category;
  }
  return null;
}

/**
 * A file name that is safe on every platform's file system: path separators and unusual
 * characters become "_", and the name is capped at 120 characters (the extension is kept).
 */
export function safeFileName(name: string): string {
  const cleaned = name.trim().replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '_');
  if (cleaned.length <= 120) return cleaned || 'file';
  const extension = fileExtension(cleaned);
  const tail = extension ? `.${extension}` : '';
  return `${cleaned.slice(0, 120 - tail.length)}${tail}`;
}

/** A display name for the metadata (never empty, at most 500 characters). */
export function displayFileName(name: string | null | undefined, fallback: string): string {
  const trimmed = (name ?? '').trim();
  return (trimmed || fallback).slice(0, 500);
}

export type FileSizeUnit = 'b' | 'kb' | 'mb' | 'gb';

/** 1536 => { value: 1.5, unit: 'kb' } (binary multiples, one decimal above 1 KB). */
export function fileSizeParts(bytes: number): { value: number; unit: FileSizeUnit } {
  if (!Number.isFinite(bytes) || bytes < 1024) return { value: Math.max(0, Math.round(Number.isFinite(bytes) ? bytes : 0)), unit: 'b' };
  const units: FileSizeUnit[] = ['kb', 'mb', 'gb'];
  let value = bytes / 1024;
  let index = 0;
  while (Math.round(value * 10) / 10 >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return { value: Math.round(value * 10) / 10, unit: units[index] ?? 'gb' };
}
