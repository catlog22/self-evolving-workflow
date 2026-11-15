import { createHash } from 'node:crypto';
import type { ConversationMessage, MemoryInput } from './memory.js';

export interface MemorySource extends ConversationMessage {
  session: string;
}

export interface GroundedMemory extends MemoryInput {
  evidence: { messages: ConversationMessage[]; scope: 'messages' | 'turn' };
}

export function extractedMemoryId(session: string | undefined, type: string | undefined, content: string, sourceMessageIds: string[]): string {
  return createHash('sha256').update(JSON.stringify([session, type, content, sourceMessageIds])).digest('hex');
}

// 保留大小写、前导零、符号和连接符，避免把两个不同的机器标识归并成同一个词。
export function exactMemoryValues(text: string): string[] {
  const values = new Set<string>();
  for (const { 0: token } of text.matchAll(/[+-]?[A-Za-z0-9]+(?:[._:/+-][A-Za-z0-9]+|,\d{3}(?!\d))*%?/g)) {
    if (/\d/.test(token) || /^[a-f]{7,}$/i.test(token) || token.length >= 20 ||
        (token.length >= 12 && /[_:/.-]/.test(token))) values.add(token);
  }
  return [...values];
}

export function groundMemories(inputs: MemoryInput[], messages: ConversationMessage[]): GroundedMemory[] {
  const byId = new Map(messages.map(message => [message.id, message]));
  const users = messages.filter(message => message.role === 'user');
  const userValues = users.filter(message => exactMemoryValues(message.content).length);
  const grounded = new Map<string, GroundedMemory>();
  for (const input of inputs) {
    const cited = (input.sourceMessageIds ?? []).flatMap(id => {
      const message = byId.get(id);
      return message ? [message] : [];
    });
    // 有原始用户标识的消息也需保留，哪怕模型只引用了没有复述标识的助手回复。
    const sources = cited.length ? [...new Set([...cited, ...userValues])] : userValues.length ? users : messages;
    const exact = new Set(sources.flatMap(message => exactMemoryValues(message.content)));
    const unverified = exactMemoryValues(input.content).some(value => !exact.has(value));
    const quotes = sources.filter(message => message.role === 'user');
    const content = unverified ? (quotes.length ? quotes : sources).map(message => message.content).join('\n\n') : input.content;
    const sourceMessageIds = sources.map(message => message.id).sort();
    // 相同摘要来自不同回合时独立入库，防止新的来源覆盖旧标识。
    const id = extractedMemoryId(input.session, input.type, content, sourceMessageIds);
    if (!grounded.has(id)) grounded.set(id, { ...input, id, content, sourceMessageIds,
      evidence: { messages: sources, scope: cited.length === sources.length ? 'messages' : 'turn' },
    });
  }
  return [...grounded.values()];
}
