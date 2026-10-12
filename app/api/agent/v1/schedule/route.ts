import { withAgentRoute } from '@/lib/agent/auth';
import { agentJson } from '@/lib/agent/http';
import { parseQuery, readFromDatabase } from '@/lib/agent/read/query';
import {
  SCHEDULE_QUERY_KEYS,
  listScheduleItems,
  matchesScheduleFilter,
  parseScheduleFilter,
} from '@/lib/agent/read/schedule';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/agent/v1/schedule?date=YYYY-MM-DD&week=&progress= */
export const GET = withAgentRoute(
  async (request) => {
    const query = parseQuery(request, SCHEDULE_QUERY_KEYS);
    if (!query.ok) return query.response;
    const filter = parseScheduleFilter(query.value);
    if (!filter.ok) return filter.response;
    const items = await readFromDatabase('schedule', () => listScheduleItems(db));
    if (!items.ok) return items.response;
    return agentJson({ activities: items.value.filter((item) => matchesScheduleFilter(item, filter.value)) });
  },
  { scope: 'schedule:read', kind: 'read', action: 'read.schedule' }
);
