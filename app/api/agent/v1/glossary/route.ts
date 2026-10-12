import { withAgentRoute } from '@/lib/agent/auth';
import { agentJson } from '@/lib/agent/http';
import { listTrainingModules } from '@/lib/agent/read/glossary';
import { parseQuery, readFromDatabase } from '@/lib/agent/read/query';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/agent/v1/glossary */
export const GET = withAgentRoute(
  async (request) => {
    const query = parseQuery(request, []);
    if (!query.ok) return query.response;
    const result = await readFromDatabase('glossary', () => listTrainingModules(db));
    if (!result.ok) return result.response;
    return agentJson({ modules: result.value });
  },
  { scope: 'glossary:read', kind: 'read', action: 'read.glossary' }
);
