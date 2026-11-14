export const AGENT_MEMORY_ENVELOPE_VERSION = 'agent-memory-envelope/1.0';
export const AGENT_MEMORY_TRUST_BOUNDARY = 'untrusted_evidence_data_only';
export const AGENT_MEMORY_CONTEXT_LEVEL = 'L3';

export type MemoryAuthority = 'binding' | 'advisory' | 'unverified_episodic';

export interface AgentMemoryContextScope {
  repository_id?: string;
  session_id?: string;
  run_id?: string;
  skill_id?: string;
  task_kind?: string;
  paths?: string[];
}

export interface AgentMemoryConstraint {
  knowledge_id: string;
  title: string;
  mode: 'constraint';
  authority: 'binding';
  scope: string[];
  categories?: string[];
  content: string;
  content_sha256?: string;
  sources?: string[];
  source_count?: number;
}

export interface AgentMemoryReference {
  knowledge_id: string;
  title: string;
  mode: 'reference';
  authority: 'advisory';
  score: number;
  hop: number;
  snippet: string;
  sources: string[];
  related_knowledge_ids: string[];
}

export interface AgentMemoryWorkingMemory {
  memory_id: string;
  session_id: string;
  type: string;
  authority: 'unverified_episodic';
  content: string;
  source_ids: string[];
  linked_knowledge_id?: string | null;
}

export interface AgentMemoryEnvelope {
  schema_version: typeof AGENT_MEMORY_ENVELOPE_VERSION;
  trust_boundary: typeof AGENT_MEMORY_TRUST_BOUNDARY;
  memory_level: typeof AGENT_MEMORY_CONTEXT_LEVEL;
  context_scope: AgentMemoryContextScope;
  constraints: AgentMemoryConstraint[];
  references: AgentMemoryReference[];
  working_memories: AgentMemoryWorkingMemory[];
}

export interface AgentMemoryEnvelopeInput {
  contextScope?: AgentMemoryContextScope;
  constraints?: AgentMemoryConstraint[];
  references?: AgentMemoryReference[];
  workingMemories?: AgentMemoryWorkingMemory[];
}

function paths(values: string[] | undefined): string[] | undefined {
  if (!values?.length) return undefined;
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

export function createAgentMemoryEnvelope(input: AgentMemoryEnvelopeInput = {}): AgentMemoryEnvelope {
  const contextScope = input.contextScope ?? {};
  return {
    schema_version: AGENT_MEMORY_ENVELOPE_VERSION,
    trust_boundary: AGENT_MEMORY_TRUST_BOUNDARY,
    memory_level: AGENT_MEMORY_CONTEXT_LEVEL,
    context_scope: {
      ...contextScope,
      ...(paths(contextScope.paths) ? { paths: paths(contextScope.paths) } : {}),
    },
    constraints: [...(input.constraints ?? [])],
    references: [...(input.references ?? [])],
    working_memories: [...(input.workingMemories ?? [])],
  };
}
