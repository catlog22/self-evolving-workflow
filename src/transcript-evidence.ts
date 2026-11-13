import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { InputError, requireText } from './common.js';
import type { ConversationMessage } from './memory.js';

export function readTranscriptSnapshots(sessionDirectory: string, refs?: readonly string[]): ConversationMessage[] {
  if (refs?.length === 0) return [];
  const selected = refs && new Set(refs);
  const prefixes = refs && new Set(refs.map(ref => ref.split(':').at(-1)));
  const directory = join(sessionDirectory, 'transcript-evidence');
  const directoryInfo = lstatSync(directory, { throwIfNoEntry: false });
  if (!directoryInfo && !selected) return [];
  if (!directoryInfo?.isDirectory()) throw new InputError('Invalid Session transcript snapshot directory');
  const messages = readdirSync(directory, { withFileTypes: true }).filter(entry =>
    entry.isFile() && /^[a-f0-9]{64}-[a-f0-9]{16}\.json$/.test(entry.name)
  ).sort((left, right) => left.name.localeCompare(right.name)).flatMap(entry => {
    if (prefixes && !prefixes.has(entry.name.slice(0, 16))) return [];
    const snapshot = JSON.parse(readFileSync(join(directory, entry.name), 'utf8')) as Record<string, unknown>;
    requireText(snapshot.quote, 'transcript fragment');
    const quote = String(snapshot.quote);
    const hash = createHash('sha256').update(quote).digest('hex');
    const original = requireText(snapshot.sha256, 'transcript source hash');
    const locator = [
      requireText(snapshot.host_kind, 'host kind'),
      requireText(snapshot.host_session_id, 'host session'),
      requireText(snapshot.entry_id, 'entry ID'),
    ];
    const locatorHash = createHash('sha256').update(locator.join('\0')).digest('hex').slice(0, 16);
    if (snapshot.schema_version !== 'transcript-evidence/1.0' ||
        hash !== snapshot.normalized_sha256 || entry.name !== `${original}-${locatorHash}.json` ||
        locator.some(part => /[:\p{Cc}]/u.test(part))) {
      throw new InputError(`Transcript evidence hash mismatch: ${entry.name}`);
    }
    const id = `transcript:${locator.join(':')}:${original.slice(0, 16)}`;
    if (selected && !selected.has(id)) return [];
    return [{
      id,
      role: 'tool' as const,
      timestamp: requireText(snapshot.captured_at, 'capture time'),
      content: quote,
    }];
  });
  const ids = new Set(messages.map(message => message.id));
  if (ids.size !== messages.length || (selected && ids.size !== selected.size)) {
    throw new InputError('Missing or ambiguous transcript evidence');
  }
  return messages;
}
