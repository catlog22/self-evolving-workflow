// Adapts TencentDB Agent Memory's MemoryKnowledge code graph bridge (MIT).
import { realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { CodeGraph as Graph, Edge } from '@colbymchenry/codegraph';
import { InputError, NotFoundError, requireText, searchLimit } from './common.js';

const require = createRequire(import.meta.url);
const writes = new Map<string, Promise<unknown>>();

function sdk(): typeof import('@colbymchenry/codegraph') {
  return require('@colbymchenry/codegraph');
}

export class CodeGraph {
  readonly root: string;

  constructor(root: string) {
    this.root = realpathSync(root);
    if (!statSync(this.root).isDirectory()) throw new InputError('Code root must be a directory');
  }

  static hasIndex(root: string): boolean {
    return sdk().isInitialized(root);
  }

  async build() {
    return this.write(async () => {
      const { CodeGraph, isInitialized } = sdk();
      const existing = isInitialized(this.root);
      const graph = existing ? await CodeGraph.open(this.root) : CodeGraph.initSync(this.root);
      try {
        const result = await graph.indexAll();
        if (!result.success) throw new Error(result.errors.map(error => error.message).join('\n') || 'Code indexing failed');
        // SDK 全量索引会保留已删除文件的节点，复用增量扫描对齐文件系统。
        if (existing) await this.syncGraph(graph);
        return { ...graph.getStats(), filesErrored: result.filesErrored, errors: result.errors };
      } finally {
        graph.close();
      }
    });
  }

  async sync() {
    return this.write(() => this.withGraph(graph => this.syncGraph(graph)));
  }

  async search(query: string, limit?: number) {
    const text = requireText(query, 'query');
    return this.withGraph(graph => graph.searchNodes(text, { limit: searchLimit(limit) }));
  }

  async neighbors(id: string, direction: 'callers' | 'callees', depth = 1) {
    if (direction !== 'callers' && direction !== 'callees') {
      throw new InputError('direction must be callers or callees');
    }
    if (!Number.isInteger(depth) || depth < 1 || depth > 5) {
      throw new InputError('depth must be an integer between 1 and 5');
    }
    return this.withGraph(graph => {
      this.requireNode(graph, id);
      return direction === 'callers' ? graph.getCallers(id, depth) : graph.getCallees(id, depth);
    });
  }

  async trace(from: string, to: string, edgeKinds?: Edge['kind'][]) {
    return this.withGraph(graph => {
      this.requireNode(graph, from);
      this.requireNode(graph, to);
      return graph.findPath(from, to, edgeKinds);
    });
  }

  private requireNode(graph: Graph, id: string) {
    if (!graph.getNode(id)) throw new NotFoundError(`Code symbol not found: ${id}`);
  }

  private async syncGraph(graph: Graph) {
    // SDK 拿不到文件锁时会直接返回空结果，扫描回调用于区分正常空项目。
    let started = false;
    const result = await graph.sync({ onProgress: () => { started = true; } });
    if (!started) throw new Error('CodeGraph index is locked by another process');
    return result;
  }

  private async withGraph<T>(run: (graph: Graph) => T | Promise<T>): Promise<T> {
    const { CodeGraph, isInitialized } = sdk();
    if (!isInitialized(this.root)) throw new NotFoundError('Code index missing. Run code build first.');
    const graph = await CodeGraph.open(this.root);
    try {
      return await run(graph);
    } finally {
      graph.close();
    }
  }

  private async write<T>(run: () => Promise<T>): Promise<T> {
    const previous = writes.get(this.root) ?? Promise.resolve();
    const current = previous.then(run, run);
    writes.set(this.root, current);
    try {
      return await current;
    } finally {
      if (writes.get(this.root) === current) writes.delete(this.root);
    }
  }
}
