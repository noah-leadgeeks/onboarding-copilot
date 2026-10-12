import { withAgentRoute } from '@/lib/agent/auth';
import { agentJson } from '@/lib/agent/http';
import { listDiaryItems } from '@/lib/agent/read/diary';
import { parseQuery, readFromDatabase } from '@/lib/agent/read/query';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/agent/v1/diary: diary topics merged with the saved entries. */
export const GET = withAgentRoute(
  async (request) => {
    const query = parseQuery(request, []);
    if (!query.ok) return query.response;
    const items = await readFromDatabase('diary', () => listDiaryItems(db));
    if (!items.ok) return items.response;
    return agentJson({ entries: items.value });
  },
  { scope: 'diary:read', kind: 'read', action: 'read.diary' }
);
