/**
 * Local file handling. Files are read with the File API straight into memory;
 * nothing is uploaded. Binary files are refused rather than mangled.
 */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const ACCEPTED_EXTENSIONS = ['.txt', '.csv', '.log', '.tsv', '.md'] as const;

export type FileReadResult = { ok: true; text: string; name: string; bytes: number } | { ok: false; error: string };

export function hasAcceptedExtension(name: string): boolean {
  const lower = name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** Decode bytes as text, honouring UTF-8/UTF-16 byte-order marks. Returns null for binary data. */
export function decodeText(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  const probe = bytes.subarray(0, 8192);
  if (probe.includes(0)) return null; // NUL bytes: an image, archive or other binary file
  return new TextDecoder('utf-8').decode(bytes); // strips a UTF-8 BOM; invalid sequences become U+FFFD
}

export async function readTextFile(file: File): Promise<FileReadResult> {
  if (!hasAcceptedExtension(file.name)) {
    return { ok: false, error: `“${file.name}” isn't a .txt or .csv file. Gupt reads plain-text files only.` };
  }
  if (file.size > MAX_FILE_BYTES) {
    return { ok: false, error: `“${file.name}” is ${(file.size / 1048576).toFixed(1)} MB. The limit is 10 MB.` };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const text = decodeText(bytes);
  if (text === null) return { ok: false, error: `“${file.name}” looks like a binary file, not text.` };
  return { ok: true, text, name: file.name, bytes: file.size };
}

/** Trigger a download of in-memory text. The Blob URL is revoked right after. */
export function downloadText(fileName: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
