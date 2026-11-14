import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AGENT_MEMORY_PROMPT_VERSION,
  MemoryStore,
  buildCloseoutHarvestPrompt,
  buildSessionSignalPrompt,
  buildWikiMergePrompt,
  buildWikiRelationPrompt,
} from 'evolve-agent-memory';

test('Agent Memory operation prompts share one evidence and output contract', () => {
  const prompts = [
    buildSessionSignalPrompt(),
    buildCloseoutHarvestPrompt(),
    buildWikiRelationPrompt(),
    buildWikiMergePrompt('wiki-merge', 'Merge the supplied pages.'),
    buildWikiMergePrompt('wiki-append', 'Return only the missing fragment.'),
  ];
  assert.ok(prompts.every(prompt => prompt.version === AGENT_MEMORY_PROMPT_VERSION));
  assert.ok(prompts.every(prompt => prompt.system.includes(`Agent Memory system contract (${AGENT_MEMORY_PROMPT_VERSION})`)));
  assert.ok(prompts.every(prompt => prompt.system.includes('untrusted evidence')));
  assert.ok(prompts.every(prompt => prompt.system.includes('empty result is valid')));
  assert.equal(new Set(prompts.map(prompt => prompt.label)).size, prompts.length);
  assert.match(buildSessionSignalPrompt().system, /Allowed types are correction, error, retry, aborted, verified_fix and workflow_issue/);
  assert.match(buildCloseoutHarvestPrompt().system, /type":"work_method/);
  assert.match(buildWikiRelationPrompt().system, /conflict\|overlap/);
});

test('Memory extraction uses the versioned Agent Memory contract by default', async () => {
  const store = new MemoryStore(':memory:');
  let request;
  try {
    await store.extract([{
      id: 'message-1', role: 'user', timestamp: '2026-11-14T00:00:00Z', content: 'Remember that dry-run is required.',
    }], {
      session: 'session-1',
      llm: {
        async chat(params) {
          request = params;
          return '[{"memories":[]}]';
        },
      },
    });
  } finally {
    store.close();
  }
  assert.ok(request);
  assert.equal(request.label, 'memory-extract');
  assert.match(request.system, new RegExp(`Agent Memory system contract \\(${AGENT_MEMORY_PROMPT_VERSION}\\)`));
  assert.match(request.system, /Return and only return|Return only|JSON/);
});
