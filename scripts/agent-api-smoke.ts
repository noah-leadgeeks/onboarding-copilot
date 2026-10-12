/**
 * End-to-end smoke test of the agent API against a running LOCAL dev server and a LOCAL throwaway
 * database. Never run it against a shared or remote database.
 *
 *   DATABASE_URL=postgres://postgres:test@127.0.0.1:55433/nova_test \
 *   AUTH_SECRET=<same throwaway secret as the dev server> AGENT_ADMIN_EMAILS=smoke@example.test \
 *   pnpm exec tsx scripts/agent-api-smoke.ts [DATABASE_URL] [--allow-env-file]
 *
 * The dev server (`pnpm dev`, port 4000) must run with the same DATABASE_URL, AUTH_SECRET and
 * AGENT_ADMIN_EMAILS. `SMOKE_BASE_URL` overrides http://localhost:4000.
 *
 * URL-source rule (docs/DATABASE.md): positional -> DATABASE_URL -> .env.local in the current
 * directory, printed (password masked) before connecting; this script writes, so a URL from
 * .env.local is refused without --allow-env-file. Independently, any database or server host other
 * than localhost/127.0.0.1 is refused before connecting.
 *
 * Steps: seed a smoke diary topic and an activity dated today; issue a token through
 * lib/agent/tokens-admin.ts (-> lib/agent/tokens.ts generateAgentToken); GET /api/agent/v1/today and
 * POST /api/agent/v1/proposals over HTTP with the bearer token; (with AUTH_SECRET) list tokens and
 * the pending count through the admin routes with an owner cookie; approve through
 * lib/agent/approvals.ts as an allowlisted email; assert the diary row, the proposal row and the
 * audit rows; revoke (admin route over HTTP when AUTH_SECRET is set); then delete everything it
 * created. Exits 1 on the first failed check.
 */
import { randomInt } from 'crypto';
import { assertNotUnderJest, assertWriteAllowed, maskUrl, resolveDatabaseUrl } from './lib/sync-common';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function fail(message: string): never {
  throw new Error(`FAIL: ${message}`);
}

function check(condition: unknown, message: string): void {
  if (!condition) fail(message);
  console.log(`  ok  ${message}`);
}

function requireLocal(label: string, url: string): void {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    fail(`${label} is not a valid URL`);
  }
  if (!LOCAL_HOSTS.has(hostname)) fail(`${label} host "${hostname}" is not localhost or 127.0.0.1; refusing to run.`);
}

function parseArgs(argv: readonly string[]): { url?: string; allowEnvFile: boolean } {
  let url: string | undefined;
  let allowEnvFile = false;
  for (const arg of argv) {
    if (arg === '--') continue;
    if (arg === '--allow-env-file') allowEnvFile = true;
    else if (arg.startsWith('--')) fail(`unknown flag ${arg}`);
    else if (url === undefined) url = arg;
    else fail('at most one positional argument (the database URL)');
  }
  return { url, allowEnvFile };
}

function jakartaToday(): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('day')}/${get('month')}/${get('year')}`;
}

async function main(): Promise<void> {
  assertNotUnderJest();
  const args = parseArgs(process.argv.slice(2));
  const resolved = resolveDatabaseUrl({ positional: args.url });
  console.log(`Target: ${maskUrl(resolved.url)} (source: ${resolved.source})`);
  assertWriteAllowed(resolved.source, args.allowEnvFile);
  requireLocal('database URL', resolved.url);
  const baseUrl = (process.env.SMOKE_BASE_URL || 'http://localhost:4000').replace(/\/+$/, '');
  requireLocal('SMOKE_BASE_URL', baseUrl);
  console.log(`Server: ${baseUrl}`);

  // lib/db reads DATABASE_URL lazily; set it before any module opens the pool.
  process.env.DATABASE_URL = resolved.url;
  const { and, eq, inArray } = await import('drizzle-orm');
  const { db, getClient } = await import('../lib/db');
  const schema = await import('../lib/db/schema');
  const { adminAllowlist } = await import('../lib/agent/admin-auth');
  const { approveProposal } = await import('../lib/agent/approvals');
  const { issueAgentToken, revokeAgentToken } = await import('../lib/agent/tokens-admin');
  const { isValidTokenFormat } = await import('../lib/agent/tokens');
  const { serializeSessionCookie } = await import('../lib/auth/session');

  const allowlist = adminAllowlist(process.env.AGENT_ADMIN_EMAILS);
  if (allowlist.length === 0) fail('AGENT_ADMIN_EMAILS must list the owner email (same value as the dev server).');
  const ownerEmail = allowlist[0];

  const run = `${Date.now()}_${randomInt(0, 1e6)}`;
  const rowNumber = 990_000 + randomInt(0, 9_000);
  const topicId = `topic_smoke_${run}`;
  const activityId = `sched-row-smoke-${run}`;
  const learned = `Smoke test learned text ${run}`;
  let tokenId: string | null = null;

  try {
    console.log('\n1. Server health');
    const health = await fetch(`${baseUrl}/api/health`).catch((error: unknown) => fail(`dev server not reachable at ${baseUrl}: ${String(error)}`));
    check(health.ok, `GET /api/health -> ${health.status}`);

    console.log('\n2. Seed (smoke rows only)');
    await db.insert(schema.diaryTopics).values({ id: topicId, rowNumber, day: 'Smoke', week: 'Smoke', date: jakartaToday(), pic: 'Smoke', topic: 'Agent API smoke topic' });
    await db.insert(schema.activities).values({
      id: activityId,
      rowNumber,
      week: 'Smoke',
      day: 'Smoke',
      date: jakartaToday(),
      pic: 'Smoke',
      topic: 'Agent API smoke activity',
      mainMedia: 'Smoke',
      startTime: '09:00',
      endTime: '10:00',
      progress: 'In Progress',
    });
    check(true, `diary_topics row ${rowNumber} and activity ${activityId} (date ${jakartaToday()}) inserted`);

    console.log('\n3. Issue a token (lib/agent/tokens-admin.ts -> tokens.ts)');
    const issued = await issueAgentToken(db, { name: `smoke-${run}`, scopes: ['schedule:read', 'diary:read', 'diary:propose'], expiresInDays: 1 }, ownerEmail, { path: '/scripts/agent-api-smoke' });
    tokenId = issued.view.id;
    check(isValidTokenFormat(issued.token), `token issued: id=${tokenId} prefix=${issued.view.prefix} (plaintext not printed)`);
    const bearer = { Authorization: `Bearer ${issued.token}` };

    console.log('\n4. GET /api/agent/v1/today (bearer)');
    const todayRes = await fetch(`${baseUrl}/api/agent/v1/today`, { headers: bearer });
    const today = (await todayRes.json()) as { ok: boolean; data?: { date: string; current: { id: string } | null; upcoming: Array<{ id: string }>; done: Array<{ id: string }> } };
    check(todayRes.status === 200 && today.ok, `GET /today -> ${todayRes.status}`);
    check(todayRes.headers.get('cache-control') === 'no-store', 'Cache-Control: no-store');
    const todayIds = [today.data?.current?.id, ...(today.data?.upcoming ?? []).map((a) => a.id), ...(today.data?.done ?? []).map((a) => a.id)];
    check(todayIds.includes(activityId), `today (${today.data?.date}) lists the seeded activity (current=${today.data?.current?.id ?? 'none'})`);
    const noAuth = await fetch(`${baseUrl}/api/agent/v1/today`);
    check(noAuth.status === 401, `GET /today without a bearer -> ${noAuth.status}`);

    console.log('\n5. POST /api/agent/v1/proposals (bearer)');
    const proposalBody = {
      domain: 'diary',
      operation: 'update',
      target: { rowNumber },
      changes: { learned },
      reason: 'Smoke test: the user dictated this learning.',
      idempotencyKey: `smoke-${run}`,
    };
    const propRes = await fetch(`${baseUrl}/api/agent/v1/proposals`, {
      method: 'POST',
      headers: { ...bearer, 'Content-Type': 'application/json' },
      body: JSON.stringify(proposalBody),
    });
    const prop = (await propRes.json()) as { ok: boolean; data?: { id: string; status: string; before: unknown; expectedUpdatedAt: string | null } };
    check(propRes.status === 202 && prop.ok && prop.data?.status === 'pending', `POST /proposals -> ${propRes.status} status=${prop.data?.status}`);
    const proposalId = prop.data!.id;
    check(prop.data?.before === null && prop.data?.expectedUpdatedAt === null, `proposal ${proposalId}: before=null, expectedUpdatedAt=null (no diary entry yet)`);
    const replay = await fetch(`${baseUrl}/api/agent/v1/proposals`, { method: 'POST', headers: { ...bearer, 'Content-Type': 'application/json' }, body: JSON.stringify(proposalBody) });
    const replayBody = (await replay.json()) as { data?: { id: string } };
    check(replay.status === 200 && replayBody.data?.id === proposalId, `idempotent replay -> ${replay.status} same id`);

    const cookie = process.env.AUTH_SECRET
      ? `nova_session=${encodeURIComponent(
          serializeSessionCookie({
            user: { id: 'smoke', email: ownerEmail, name: 'Smoke owner' },
            tokens: { accessToken: 'smoke', expiresAt: Date.now() + 3_600_000, scope: '' },
            createdAt: new Date().toISOString(),
          })
        )}`
      : null;

    console.log('\n6. Admin routes over HTTP (owner cookie)');
    if (!cookie) {
      console.log('  skip AUTH_SECRET not set in this shell; admin HTTP checks skipped');
    } else {
      const tokensRes = await fetch(`${baseUrl}/api/agent-admin/tokens`, { headers: { cookie } });
      const tokensText = await tokensRes.text();
      const tokensBody = JSON.parse(tokensText) as { ok: boolean; data?: { tokens: Array<{ id: string }> } };
      check(tokensRes.status === 200 && tokensBody.ok, `GET /api/agent-admin/tokens -> ${tokensRes.status}`);
      check(tokensBody.data?.tokens.some((t) => t.id === tokenId), 'token list includes the smoke token');
      check(!tokensText.includes(issued.token) && !/hash/i.test(tokensText), 'token list carries no plaintext and no hash');
      const countRes = await fetch(`${baseUrl}/api/agent-admin/proposals?countOnly=1`, { headers: { cookie } });
      const countBody = (await countRes.json()) as { data?: { count: number } };
      check(countRes.status === 200 && (countBody.data?.count ?? 0) >= 1, `GET /api/agent-admin/proposals?countOnly=1 -> count=${countBody.data?.count}`);
      const bearerOnAdmin = await fetch(`${baseUrl}/api/agent-admin/tokens`, { headers: { cookie, ...bearer } });
      check(bearerOnAdmin.status === 400, `admin route with a bearer header -> ${bearerOnAdmin.status}`);
    }

    console.log(`\n7. Approve through lib/agent/approvals.ts as ${ownerEmail} (in AGENT_ADMIN_EMAILS)`);
    const outcome = await approveProposal(proposalId, { expectedUpdatedAt: prop.data!.expectedUpdatedAt }, { email: ownerEmail, path: '/scripts/agent-api-smoke' });
    check(outcome.ok && outcome.status === 'executed', `approve -> ${outcome.ok ? `${outcome.httpStatus} ${outcome.status}` : `${outcome.httpStatus} ${outcome.error}`}`);

    console.log('\n8. Database assertions');
    const entry = await db.select().from(schema.diaryEntries).where(eq(schema.diaryEntries.rowNumber, rowNumber));
    check(entry.length === 1 && entry[0].learned === learned, `diary_entries row ${rowNumber}: learned = proposed text`);
    const proposalRow = await db.select().from(schema.agentProposals).where(eq(schema.agentProposals.id, proposalId));
    check(proposalRow[0]?.status === 'executed' && proposalRow[0]?.decidedBy === ownerEmail, `agent_proposals ${proposalId}: status=executed decided_by=${proposalRow[0]?.decidedBy}`);
    const tokenRow = await db.select({ lastUsedAt: schema.agentTokens.lastUsedAt }).from(schema.agentTokens).where(eq(schema.agentTokens.id, tokenId));
    check(tokenRow[0]?.lastUsedAt !== null, 'agent_tokens.last_used_at set by the bearer calls');

    console.log('\n9. Revoke');
    if (cookie) {
      const revokeRes = await fetch(`${baseUrl}/api/agent-admin/tokens/${tokenId}/revoke`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: '{}' });
      const revokeBody = (await revokeRes.json()) as { data?: { status: string } };
      check(revokeRes.status === 200 && revokeBody.data?.status === 'revoked', `POST /api/agent-admin/tokens/:id/revoke -> ${revokeRes.status} ${revokeBody.data?.status}`);
    } else {
      const revoked = await revokeAgentToken(db, tokenId, ownerEmail, { path: '/scripts/agent-api-smoke' });
      check(revoked.status === 'revoked', 'revokeAgentToken -> revoked');
    }
    const afterRevoke = await fetch(`${baseUrl}/api/agent/v1/today`, { headers: bearer });
    check(afterRevoke.status === 401, `GET /today with the revoked token -> ${afterRevoke.status}`);

    console.log('\n10. Audit rows');
    const audit = await db
      .select({ action: schema.agentAuditLog.action, actor: schema.agentAuditLog.actor, statusCode: schema.agentAuditLog.statusCode, path: schema.agentAuditLog.path, proposalId: schema.agentAuditLog.proposalId, details: schema.agentAuditLog.details })
      .from(schema.agentAuditLog)
      .where(eq(schema.agentAuditLog.tokenId, tokenId))
      .orderBy(schema.agentAuditLog.createdAt);
    for (const row of audit) console.log(`      ${row.actor.padEnd(5)} ${row.action.padEnd(22)} ${String(row.statusCode).padEnd(4)} ${row.path ?? ''}`);
    const has = (action: string, status: number, actor: string) => audit.some((r) => r.action === action && r.statusCode === status && r.actor === actor);
    check(has('token.issue', 201, 'user'), 'token.issue 201 (user)');
    check(has('read.today', 200, 'agent'), 'read.today 200 (agent)');
    check(has('propose.diary.update', 202, 'agent'), 'propose.diary.update 202 (agent)');
    check(audit.some((r) => r.action === 'approve' && r.statusCode === 200 && r.proposalId === proposalId), 'approve 200 (user) linked to the proposal');
    check(has('token.revoke', 200, 'user'), 'token.revoke 200 (user)');
    check(!JSON.stringify(audit).includes(issued.token) && !JSON.stringify(audit).includes(learned), 'audit rows hold no token plaintext and no payload text');

    console.log('\nSMOKE PASSED');
  } finally {
    console.log('\nCleanup (smoke rows only)');
    if (tokenId) {
      await db.delete(schema.agentAuditLog).where(eq(schema.agentAuditLog.tokenId, tokenId));
      await db.delete(schema.agentProposals).where(eq(schema.agentProposals.tokenId, tokenId));
      await db.delete(schema.agentTokens).where(eq(schema.agentTokens.id, tokenId));
    }
    await db.delete(schema.diaryEntries).where(eq(schema.diaryEntries.rowNumber, rowNumber));
    await db.delete(schema.diaryTopics).where(and(eq(schema.diaryTopics.id, topicId), eq(schema.diaryTopics.rowNumber, rowNumber)));
    await db.delete(schema.activities).where(inArray(schema.activities.id, [activityId]));
    console.log('  done');
    await getClient().end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
