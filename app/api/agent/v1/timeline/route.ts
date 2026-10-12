import { withAgentRoute } from '@/lib/agent/auth';
import { agentJson } from '@/lib/agent/http';
import { listTimelineStages } from '@/lib/agent/read/timeline';
import { parseQuery, readFromDatabase } from '@/lib/agent/read/query';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/agent/v1/timeline */
export const GET = withAgentRoute(
  async (request) => {
    const query = parseQuery(request, []);
    if (!query.ok) return query.response;
    const result = await readFromDatabase('timeline', () => listTimelineStages(db));
    if (!result.ok) return result.response;
    return agentJson({ stages: result.value });
  },
  { scope: 'timeline:read', kind: 'read', action: 'read.timeline' }
);
