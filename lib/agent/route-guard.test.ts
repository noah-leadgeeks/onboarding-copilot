/**
 * Guard (S14): every route module under app/api/agent/** must export only `withAgentRoute`-wrapped
 * HTTP handlers, plus `runtime = 'nodejs'` and `dynamic = 'force-dynamic'`. Passes on an empty tree.
 * Also asserts lib/agent/** has no spreadsheet writers (D2).
 */
import fs from 'fs';
import path from 'path';

// jest.mock is not hoisted by this repo's transform; it must run before any route module is required.
jest.mock('@/lib/db', () => ({
  isDbConfigured: () => false,
  db: new Proxy(
    {},
    {
      get() {
        throw new Error('route modules must not query the database at import time');
      },
    }
  ),
}));

const { isAgentRoute, withAgentRoute } = require('./auth') as typeof import('./auth');

const REPO_ROOT = path.join(__dirname, '..', '..');
const AGENT_ROUTES_DIR = path.join(REPO_ROOT, 'app', 'api', 'agent');
const AGENT_ADMIN_ROUTES_DIR = path.join(REPO_ROOT, 'app', 'api', 'agent-admin');
const HTTP_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const;

function walk(dir: string, match: (file: string) => boolean): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, match));
    else if (match(full)) out.push(full);
  }
  return out.sort();
}

/** Returns human-readable violations for one route module's exports. */
function routeViolations(file: string, exports: Record<string, unknown>): string[] {
  const problems: string[] = [];
  const methods = HTTP_METHODS.filter((m) => m in exports);
  if (methods.length === 0) problems.push(`${file}: exports no HTTP handler`);
  for (const method of methods) {
    if (!isAgentRoute(exports[method])) problems.push(`${file}: ${method} is not wrapped by withAgentRoute`);
  }
  if (exports.runtime !== 'nodejs') problems.push(`${file}: missing export const runtime = 'nodejs'`);
  if (exports.dynamic !== 'force-dynamic') problems.push(`${file}: missing export const dynamic = 'force-dynamic'`);
  return problems;
}

describe('agent route guard', () => {
  it('every app/api/agent/**/route.ts export is wrapped and declares runtime/dynamic (empty set allowed)', () => {
    const files = walk(AGENT_ROUTES_DIR, (f) => /[\\/]route\.(ts|tsx|js)$/.test(f));
    const problems: string[] = [];
    for (const file of files) {
      const mod = require(file) as Record<string, unknown>;
      problems.push(...routeViolations(path.relative(REPO_ROOT, file), mod));
    }
    expect(problems).toEqual([]);
  });

  it('the checker flags unwrapped handlers and missing runtime/dynamic', () => {
    const wrapped = withAgentRoute(async () => new Response(null), { scope: 'any', kind: 'read', action: 'read.me' });
    expect(routeViolations('ok', { GET: wrapped, runtime: 'nodejs', dynamic: 'force-dynamic' })).toEqual([]);
    expect(routeViolations('bad', { GET: async () => new Response(null), POST: wrapped })).toEqual([
      'bad: GET is not wrapped by withAgentRoute',
      "bad: missing export const runtime = 'nodejs'",
      "bad: missing export const dynamic = 'force-dynamic'",
    ]);
    expect(routeViolations('none', { runtime: 'nodejs', dynamic: 'force-dynamic' })).toEqual(['none: exports no HTTP handler']);
  });

  it('covers the Step 5 read routes', () => {
    const files = walk(AGENT_ROUTES_DIR, (f) => /[\\/]route\.(ts|tsx|js)$/.test(f)).map((f) =>
      path.relative(AGENT_ROUTES_DIR, f).split(path.sep).join('/')
    );
    const expected = [
      'v1/today/route.ts',
      'v1/schedule/route.ts',
      'v1/schedule/[id]/route.ts',
      'v1/diary/route.ts',
      'v1/diary/[rowNumber]/route.ts',
      'v1/feedback/route.ts',
      'v1/reviews/route.ts',
      'v1/timeline/route.ts',
      'v1/glossary/route.ts',
      'v1/sessions/route.ts',
      'v1/me/route.ts',
      'v1/proposals/route.ts',
      'v1/proposals/[id]/route.ts',
      'v1/proposals/[id]/cancel/route.ts',
    ];
    expect(expected.filter((file) => !files.includes(file))).toEqual([]);
  });

  it('lib/agent/** and app/api/agent/** never import readSchedule or the Sheets client (M9)', () => {
    const forbidden = /\breadSchedule\b|@\/lib\/sheets\/client|lib\/sheets\/client/;
    const files = [
      ...walk(__dirname, (f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)),
      ...walk(AGENT_ROUTES_DIR, (f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)),
    ];
    expect(files.some((f) => f.endsWith(path.join('read', 'schedule.ts')))).toBe(true);
    const offenders = files.filter((f) => forbidden.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(REPO_ROOT, f));
    expect(offenders).toEqual([]);
  });

  it('lib/agent/**, app/api/agent/** and app/api/agent-admin/** have no spreadsheet writer references', () => {
    const forbidden = new RegExp(['updateSheetRange', 'batchUpdateSheetRanges', 'writeDiary', 'SHEETS_'].join('|'));
    const files = [
      ...walk(__dirname, (f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)),
      ...walk(AGENT_ROUTES_DIR, (f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)),
      ...walk(AGENT_ADMIN_ROUTES_DIR, (f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)),
    ];
    expect(files.some((f) => f.endsWith(path.join('lib', 'agent', 'approvals.ts')))).toBe(true);
    expect(files.some((f) => f.startsWith(AGENT_ADMIN_ROUTES_DIR))).toBe(true);
    expect(files.length).toBeGreaterThan(0);
    const offenders = files.filter((f) => forbidden.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(REPO_ROOT, f));
    expect(offenders).toEqual([]);
  });
});
