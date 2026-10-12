/**
 * Agent session-history projection (`session_logs`), filtered in SQL by `activityId` and a
 * `from`/`to` range on `started_at`. At most `SESSIONS_LIMIT` rows; `truncated` reports the cap.
 */
import { and, asc, eq, gte, lt, type SQL } from 'drizzle-orm';
import { sessionLogs } from '@/lib/db/schema';
import type { AgentExecutor } from '../audit';
import { badQuery, isSafeId, parseIsoDate, type Parsed } from './query';

export const SESSIONS_QUERY_KEYS = ['activityId', 'from', 'to'] as const;
export const SESSIONS_LIMIT = 1000;

/** Asia/Jakarta has no DST: calendar days start at 00:00 +07:00. */
const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

export interface SessionsFilter {
  activityId?: string;
  /** Inclusive lower bound on `started_at` (epoch ms). */
  fromMs?: number;
  /** Exclusive upper bound on `started_at` (epoch ms). */
  toExclusiveMs?: number;
}

export interface AgentSessionLog {
  id: string;
  activityId: string;
  name: string;
  startedAt: string;
  finishedAt: string;
  durationMinutes: number;
  createdAt: string;
}

export interface AgentSessionsView {
  sessions: AgentSessionLog[];
  truncated: boolean;
}

/**
 * `YYYY-MM-DD` is a Jakarta calendar day (`from` = its start, `to` = its end, inclusive); an ISO
 * datetime with `Z` or an offset is an exact instant (inclusive at both ends).
 */
function parseBound(value: string, edge: 'from' | 'to'): number | null {
  const date = parseIsoDate(value);
  if (date) {
    const startMs = Date.UTC(date.y, date.m - 1, date.d) - JAKARTA_OFFSET_MS;
    return edge === 'from' ? startMs : startMs + DAY_MS;
  }
  if (!ISO_DATETIME.test(value)) return null;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return null;
  return edge === 'from' ? ms : ms + 1;
}

export function parseSessionsFilter(query: Partial<Record<(typeof SESSIONS_QUERY_KEYS)[number], string>>): Parsed<SessionsFilter> {
  const filter: SessionsFilter = {};
  if (query.activityId !== undefined) {
    if (!isSafeId(query.activityId)) {
      return { ok: false, response: badQuery('activityId must be 1-128 characters of [A-Za-z0-9._:-].') };
    }
    filter.activityId = query.activityId;
  }
  for (const edge of ['from', 'to'] as const) {
    const raw = query[edge];
    if (raw === undefined) continue;
    const bound = parseBound(raw, edge);
    if (bound === null) {
      return {
        ok: false,
        response: badQuery(`${edge} must be YYYY-MM-DD (Asia/Jakarta day) or an ISO 8601 datetime with Z or an offset.`),
      };
    }
    if (edge === 'from') filter.fromMs = bound;
    else filter.toExclusiveMs = bound;
  }
  if (filter.fromMs !== undefined && filter.toExclusiveMs !== undefined && filter.fromMs >= filter.toExclusiveMs) {
    return { ok: false, response: badQuery('from must be before to.') };
  }
  return { ok: true, value: filter };
}

function iso(ms: number): string {
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

export async function listSessionLogs(executor: AgentExecutor, filter: SessionsFilter): Promise<AgentSessionsView> {
  const conditions: SQL[] = [];
  if (filter.activityId !== undefined) conditions.push(eq(sessionLogs.activityId, filter.activityId));
  if (filter.fromMs !== undefined) conditions.push(gte(sessionLogs.startedAt, filter.fromMs));
  if (filter.toExclusiveMs !== undefined) conditions.push(lt(sessionLogs.startedAt, filter.toExclusiveMs));

  const rows = await executor
    .select()
    .from(sessionLogs)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(sessionLogs.startedAt), asc(sessionLogs.id))
    .limit(SESSIONS_LIMIT + 1);

  return {
    sessions: rows.slice(0, SESSIONS_LIMIT).map((row) => ({
      id: row.id,
      activityId: row.activityId,
      name: row.name,
      startedAt: iso(row.startedAt),
      finishedAt: iso(row.finishedAt),
      durationMinutes: row.durationMinutes,
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    })),
    truncated: rows.length > SESSIONS_LIMIT,
  };
}
