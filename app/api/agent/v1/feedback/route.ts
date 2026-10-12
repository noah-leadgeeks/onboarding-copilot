import { withAgentRoute } from '@/lib/agent/auth';
import { agentJson } from '@/lib/agent/http';
import { readFeedback } from '@/lib/agent/read/feedback';
import { parseQuery, readFromDatabase } from '@/lib/agent/read/query';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/agent/v1/feedback */
export const GET = withAgentRoute(
  async (request) => {
    const query = parseQuery(request, []);
    if (!query.ok) return query.response;
    const result = await readFromDatabase('feedback', () => readFeedback(db));
    if (!result.ok) return result.response;
    return agentJson(result.value);
  },
  { scope: 'feedback:read', kind: 'read', action: 'read.feedback' }
);
