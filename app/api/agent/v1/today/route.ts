import { withAgentRoute } from '@/lib/agent/auth';
import { agentJson } from '@/lib/agent/http';
import { parseQuery, readFromDatabase } from '@/lib/agent/read/query';
import { listScheduleItems } from '@/lib/agent/read/schedule';
import { buildTodayView } from '@/lib/agent/read/today';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/agent/v1/today: today's activities from the database schedule only (M9). */
export const GET = withAgentRoute(
  async (request) => {
    const query = parseQuery(request, []);
    if (!query.ok) return query.response;
    const items = await readFromDatabase('today', () => listScheduleItems(db));
    if (!items.ok) return items.response;
    return agentJson(buildTodayView(items.value, new Date()));
  },
  { scope: 'schedule:read', kind: 'read', action: 'read.today' }
);
