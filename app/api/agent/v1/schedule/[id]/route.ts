import { withAgentRoute } from '@/lib/agent/auth';
import { agentJson } from '@/lib/agent/http';
import { badId, isSafeId, notFound, parseQuery, readFromDatabase } from '@/lib/agent/read/query';
import { getScheduleItem } from '@/lib/agent/read/schedule';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/agent/v1/schedule/:id (e.g. `sched-row-12`). */
export const GET = withAgentRoute<{ id: string }>(
  async (request, _ctx, { params }) => {
    const query = parseQuery(request, []);
    if (!query.ok) return query.response;
    const { id } = await params;
    if (!isSafeId(id)) return badId('id must be 1-128 characters of [A-Za-z0-9._:-].');
    const item = await readFromDatabase('schedule item', () => getScheduleItem(db, id));
    if (!item.ok) return item.response;
    if (!item.value) return notFound('No schedule activity has this id.');
    return agentJson(item.value);
  },
  { scope: 'schedule:read', kind: 'read', action: 'read.schedule' }
);
