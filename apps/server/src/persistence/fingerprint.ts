import { createHash } from 'node:crypto';

/** Store a digest rather than retaining chat text in command history. */
export function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
