/**
 * Test-only mini SQL interpreter for the statement shapes drizzle emits for lib/agent/proposals.ts
 * and lib/agent/domains/*: single-table select/insert/update/delete with `and`-joined `=`, `is null`
 * and `expires_at <=|> now()` predicates. Rows are stored by SQL column name in driver format.
 * Time is not emulated: a row's `__expired` flag answers `expires_at <= now()`.
 */
export type FakeRow = Record<string, unknown> & { __seq?: number; __expired?: boolean };
export type FakeTables = Record<string, FakeRow[]>;

/** Unique column sets per table (ON CONFLICT DO NOTHING checks any of them). */
const UNIQUE_KEYS: Record<string, string[][]> = {
  agent_proposals: [['id'], ['token_id', 'idempotency_key']],
  diary_entries: [['id'], ['row_number']],
  feedback_entries: [['id'], ['session_id']],
  monthly_reviews: [['id'], ['month']],
};

let seq = 0;

function splitTopLevel(text: string, separator = ','): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = false;
  let current = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "'") quote = !quote;
    if (!quote && ch === '(') depth += 1;
    if (!quote && ch === ')') depth -= 1;
    if (!quote && depth === 0 && text.startsWith(separator, i)) {
      parts.push(current.trim());
      current = '';
      i += separator.length - 1;
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** Removes parentheses that wrap the whole expression. */
function stripParens(text: string): string {
  let t = text.trim();
  for (;;) {
    if (!t.startsWith('(') || !t.endsWith(')')) return t;
    let depth = 0;
    for (let i = 0; i < t.length; i += 1) {
      if (t[i] === '(') depth += 1;
      if (t[i] === ')') depth -= 1;
      // The first paren closes before the end: it does not wrap everything.
      if (depth === 0 && i < t.length - 1) return t;
    }
    t = t.slice(1, -1).trim();
  }
}

function column(ref: string): string {
  const parts = ref.trim().split('.');
  return parts[parts.length - 1].replace(/"/g, '');
}

function param(token: string, params: unknown[]): unknown {
  const match = /^\$(\d+)(::\w+)?$/.exec(token.trim());
  if (!match) throw new Error(`fake-tables: expected a parameter, got ${token}`);
  return params[Number(match[1]) - 1];
}

function nowIso(): string {
  return new Date().toISOString();
}

function matches(row: FakeRow, where: string | undefined, params: unknown[]): boolean {
  if (!where) return true;
  for (const conjunct of splitTopLevel(stripParens(where), ' and ')) {
    const c = stripParens(conjunct);
    let m: RegExpExecArray | null;
    if ((m = /^(\S+) = (\$\d+)$/.exec(c))) {
      if (row[column(m[1])] !== param(m[2], params)) return false;
    } else if ((m = /^(\S+) is null$/.exec(c))) {
      if (row[column(m[1])] !== null && row[column(m[1])] !== undefined) return false;
    } else if ((m = /^(\S+) <= now\(\)$/.exec(c))) {
      if (!row.__expired) return false;
    } else if ((m = /^(\S+) > now\(\)$/.exec(c))) {
      if (row.__expired) return false;
    } else {
      throw new Error(`fake-tables: unsupported predicate: ${c}`);
    }
  }
  return true;
}

function project(rows: FakeRow[], list: string, params: unknown[] = []): unknown[][] {
  const items = splitTopLevel(list);
  if (items.length === 1 && items[0] === 'count(*)::int') return [[rows.length]];
  return rows.map((row) =>
    items.map((item) => {
      if (/<= now\(\)\)?$/.test(item)) return Boolean(row.__expired);
      // Staleness compare (approvals.ts): string equality with SQL NULL semantics of IS NOT DISTINCT FROM.
      const distinct = /^\((\S+) IS NOT DISTINCT FROM (\$\d+(?:::\w+)?)\)$/.exec(item);
      if (distinct) {
        const stored = row[column(distinct[1])];
        const expected = param(distinct[2], params);
        const left = stored === null || stored === undefined ? null : String(stored);
        const right = expected === null || expected === undefined ? null : String(expected);
        return left === right;
      }
      const text = /^(\S+)::text$/.exec(item);
      if (text) {
        const value = row[column(text[1])];
        return value === null || value === undefined ? null : String(value);
      }
      const value = row[column(item)];
      return value === undefined ? null : value;
    })
  );
}

function conflicts(table: string, rows: FakeRow[], candidate: FakeRow): boolean {
  const keys = UNIQUE_KEYS[table] ?? [['id']];
  return rows.some((row) => keys.some((key) => key.every((col) => row[col] === candidate[col])));
}

function evalValue(token: string, params: unknown[], row: FakeRow): unknown {
  const t = token.trim();
  if (t === 'default') return undefined;
  if (t === 'null') return null;
  if (t === 'now()') return nowIso();
  if (/^now\(\) \+ make_interval/.test(t)) {
    row.__expired = false;
    const hours = /hours => (\$\d+)/.exec(t);
    const h = hours ? Number(param(hours[1], params)) : 24;
    return new Date(Date.now() + h * 3_600_000).toISOString();
  }
  return param(t, params);
}

/** Returns positional rows, or undefined when the statement does not target a known table. */
export function runFakeTableQuery(tables: FakeTables, sqlText: string, params: unknown[]): unknown[][] | undefined {
  let m: RegExpExecArray | null;

  if ((m = /^select (.+?) from "(\w+)"(?: where (.+?))?(?: order by (.+?))?(?: limit (\$\d+))?(?: for (?:share|update|no key update))?$/.exec(sqlText))) {
    const [, list, table, where, orderBy, limit] = m;
    if (!tables[table]) return undefined;
    let rows = tables[table].filter((row) => matches(row, where, params));
    if (orderBy) {
      rows = [...rows].sort((a, b) => (a.__seq ?? 0) - (b.__seq ?? 0));
      if (/ desc$/.test(orderBy)) rows.reverse();
    }
    if (limit) rows = rows.slice(0, Number(param(limit, params)));
    return project(rows, list, params);
  }

  if ((m = /^insert into "(\w+)" \((.+?)\) values \((.+)\)( on conflict(?: \([^)]*\))? do nothing)?(?: returning (.+))?$/.exec(sqlText))) {
    const [, table, cols, values, onConflict, returning] = m;
    if (!tables[table]) return undefined;
    const row: FakeRow = { __seq: (seq += 1) };
    const columns = splitTopLevel(cols).map(column);
    const tokens = splitTopLevel(values);
    columns.forEach((col, index) => {
      const value = evalValue(tokens[index], params, row);
      if (value !== undefined) row[col] = value;
    });
    if (row.created_at === undefined && table === 'agent_proposals') row.created_at = nowIso();
    if (table === 'agent_proposals' && row.warnings === undefined) row.warnings = '[]';
    if (conflicts(table, tables[table], row)) {
      if (!onConflict) throw Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });
      return [];
    }
    tables[table].push(row);
    return returning ? project([row], returning, params) : [];
  }

  if ((m = /^update "(\w+)" set (.+?) where (.+?)(?: returning (.+))?$/.exec(sqlText))) {
    const [, table, sets, where, returning] = m;
    if (!tables[table]) return undefined;
    const targets = tables[table].filter((row) => matches(row, where, params));
    for (const row of targets) {
      for (const assignment of splitTopLevel(sets)) {
        const [col, value] = assignment.split(' = ');
        row[column(col)] = evalValue(value, params, row);
      }
    }
    return returning ? project(targets, returning, params) : [];
  }

  if ((m = /^delete from "(\w+)" where (.+?)(?: returning (.+))?$/.exec(sqlText))) {
    const [, table, where, returning] = m;
    if (!tables[table]) return undefined;
    const removed = tables[table].filter((row) => matches(row, where, params));
    tables[table] = tables[table].filter((row) => !removed.includes(row));
    return returning ? project(removed, returning, params) : [];
  }

  return undefined;
}

export function cloneTables(tables: FakeTables): FakeTables {
  const out: FakeTables = {};
  for (const [name, rows] of Object.entries(tables)) out[name] = rows.map((row) => ({ ...row }));
  return out;
}
