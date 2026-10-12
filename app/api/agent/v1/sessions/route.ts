import { withAgentRoute } from '@/lib/agent/auth';
import { agentJson } from '@/lib/agent/http';
import { parseQuery, readFromDatabase } from '@/lib/agent/read/query';
import { SESSIONS_QUERY_KEYS, listSessionLogs, parseSessionsFilter } from '@/lib/agent/read/sessions';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/agent/v1/sessions?activityId=&from=&to= */
export const GET = withAgentRoute(
  async (request) => {
    const query = parseQuery(request, SESSIONS_QUERY_KEYS);
    if (!query.ok) return query.response;
    const filter = parseSessionsFilter(query.value);
    if (!filter.ok) return filter.response;
    const result = await readFromDatabase('sessions', () => listSessionLogs(db, filter.value));
    if (!result.ok) return result.response;
    return agentJson(result.value);
  },
  { scope: 'sessions:read', kind: 'read', action: 'read.sessions' }
);
