import { createServer } from 'node:http';
import { InputError, NotFoundError } from './common.js';
import { parseScope, search, type SearchSources } from './search.js';

/** GET /search?q=...&scope=all|code|wiki|memory&limit=10&hop=0&type=...&scene=...&session=... */
export function createSearchServer(sources: SearchSources) {
  const server = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    const send = (status: number, payload: unknown) => {
      response.writeHead(status);
      response.end(JSON.stringify(payload));
    };
    try {
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (url.pathname !== '/search') return send(404, { error: 'Route not found' });
      if (request.method !== 'GET') {
        response.setHeader('Allow', 'GET');
        return send(405, { error: 'Use GET /search' });
      }
      const params = url.searchParams;
      const results = await search(sources, params.get('q') ?? '', {
        scope: parseScope(params.get('scope') ?? 'all'),
        limit: params.has('limit') ? Number(params.get('limit')) : undefined,
        wiki: { hop: params.has('hop') ? Number(params.get('hop')) : undefined },
        memory: {
          type: params.get('type') ?? undefined,
          scene: params.get('scene') ?? undefined,
          session: params.get('session') ?? undefined,
        },
      });
      send(200, results);
    } catch (error) {
      if (error instanceof InputError) return send(400, { error: error.message });
      if (error instanceof NotFoundError) return send(404, { error: error.message });
      send(500, { error: 'Search failed' });
      server.emit('searchError', error);
    }
  });
  return server;
}
