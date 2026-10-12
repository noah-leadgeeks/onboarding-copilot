import { withAgentRoute } from '@/lib/agent/auth';
import { agentJson } from '@/lib/agent/http';
import { listReviews } from '@/lib/agent/read/reviews';
import { parseQuery, readFromDatabase } from '@/lib/agent/read/query';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/agent/v1/reviews */
export const GET = withAgentRoute(
  async (request) => {
    const query = parseQuery(request, []);
    if (!query.ok) return query.response;
    const result = await readFromDatabase('reviews', () => listReviews(db));
    if (!result.ok) return result.response;
    return agentJson({ reviews: result.value });
  },
  { scope: 'reviews:read', kind: 'read', action: 'read.reviews' }
);
