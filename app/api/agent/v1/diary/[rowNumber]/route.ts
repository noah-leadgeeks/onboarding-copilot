import { withAgentRoute } from '@/lib/agent/auth';
import { agentJson } from '@/lib/agent/http';
import { getDiaryItem } from '@/lib/agent/read/diary';
import { badId, notFound, parsePositiveIntParam, parseQuery, readFromDatabase } from '@/lib/agent/read/query';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/agent/v1/diary/:rowNumber */
export const GET = withAgentRoute<{ rowNumber: string }>(
  async (request, _ctx, { params }) => {
    const query = parseQuery(request, []);
    if (!query.ok) return query.response;
    const rowNumber = parsePositiveIntParam((await params).rowNumber);
    if (rowNumber === null) return badId('rowNumber must be a positive integer.');
    const item = await readFromDatabase('diary item', () => getDiaryItem(db, rowNumber));
    if (!item.ok) return item.response;
    if (!item.value) return notFound('No diary topic or entry has this row number.');
    return agentJson(item.value);
  },
  { scope: 'diary:read', kind: 'read', action: 'read.diary' }
);
