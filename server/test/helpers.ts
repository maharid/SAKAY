/**
 * Test helpers for the server: a tiny in-memory stand-in for the Supabase client (tables, filters, RPCs, auth.getUser) and a way to
 * run an Express app on a random local port. No network, no database.
 */
import type { Express } from 'express';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

type Row = Record<string, any>;

export interface FakeOptions {
  tables?: Record<string, Row[]>;
  /** access token -> user (anything not listed is rejected with a 401 like Supabase Auth does) */
  users?: Record<string, { id: string; email?: string; is_anonymous?: boolean }>;
  rpc?: Record<string, (args: Row) => { data?: any; error?: { message: string } | null }>;
  /** "table:op" -> error message, e.g. 'passenger:select' */
  fail?: Record<string, string>;
  /** make auth.getUser fail like a network outage */
  authDown?: boolean;
}

export interface FakeClient {
  from(table: string): any;
  rpc(name: string, args?: Row): Promise<{ data: any; error: { message: string } | null }>;
  auth: { getUser(token: string): Promise<{ data: { user: any } | { user: null }; error: any }> };
  calls: { getUser: number; rpc: { name: string; args: Row }[]; updates: { table: string; payload: Row; filters: [string, any][] }[]; inserts: { table: string; rows: Row[] }[] };
  tables: Record<string, Row[]>;
}

export function fakeSupabase(opts: FakeOptions = {}): FakeClient {
  const tables = opts.tables ?? {};
  const calls: FakeClient['calls'] = { getUser: 0, rpc: [], updates: [], inserts: [] };

  function builder(table: string) {
    const st: { op: 'select' | 'update' | 'insert'; payload?: any; filters: ((r: Row) => boolean)[]; raw: [string, any][]; limit?: number } = { op: 'select', filters: [], raw: [] };
    const run = (single: boolean) => {
      const failMsg = opts.fail?.[`${table}:${st.op}`];
      if (failMsg) return { data: null, error: { message: failMsg } };
      const rows = (tables[table] ??= []);
      const matching = rows.filter((r) => st.filters.every((f) => f(r)));
      if (st.op === 'update') {
        calls.updates.push({ table, payload: st.payload, filters: st.raw });
        matching.forEach((r) => Object.assign(r, st.payload));
        return { data: matching, error: null };
      }
      if (st.op === 'insert') {
        const list = Array.isArray(st.payload) ? st.payload : [st.payload];
        calls.inserts.push({ table, rows: list });
        list.forEach((r: Row) => rows.push({ ...r }));
        return { data: list, error: null };
      }
      let out = matching;
      if (st.limit !== undefined) out = out.slice(0, st.limit);
      return single ? { data: out[0] ?? null, error: null } : { data: out, error: null };
    };
    const b: any = {
      select: () => b,
      update: (payload: Row) => { st.op = 'update'; st.payload = payload; return b; },
      insert: (payload: any) => { st.op = 'insert'; st.payload = payload; return b; },
      eq: (col: string, val: any) => { st.raw.push([col, val]); st.filters.push((r) => r[col] === val); return b; },
      in: (col: string, vals: any[]) => { st.filters.push((r) => vals.includes(r[col])); return b; },
      order: () => b,
      limit: (n: number) => { st.limit = n; return b; },
      maybeSingle: async () => run(true),
      single: async () => run(true),
      then: (resolve: (v: any) => any, reject?: (e: any) => any) => Promise.resolve(run(false)).then(resolve, reject),
    };
    return b;
  }

  return {
    from: (table: string) => builder(table),
    rpc: async (name: string, args: Row = {}) => {
      calls.rpc.push({ name, args });
      const fn = opts.rpc?.[name];
      if (!fn) return { data: null, error: { message: `function ${name} does not exist` } };
      const r = fn(args);
      return { data: r.data ?? null, error: r.error ?? null };
    },
    auth: {
      getUser: async (token: string) => {
        calls.getUser++;
        if (opts.authDown) return { data: { user: null }, error: { message: 'fetch failed', status: 0, name: 'AuthRetryableFetchError' } };
        const u = opts.users?.[token];
        if (!u) return { data: { user: null }, error: { message: 'invalid JWT', status: 401, name: 'AuthApiError' } };
        return { data: { user: u }, error: null };
      },
    },
    calls,
    tables,
  };
}

/** A JWT-shaped string (header.payload.signature) with the given expiry; the signature is junk: only Supabase Auth would check it. */
export function fakeJwt(expSecondsFromNow = 3600, extra: Row = {}): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const rnd = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  return `${b64({ alg: 'ES256', typ: 'JWT' })}.${b64({ sub: 'x', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + expSecondsFromNow, ...extra, rnd })}.${Buffer.from(rnd).toString('base64url')}`;
}

export const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export async function listen(app: Express): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }),
  };
}

/** fetch with JSON helpers */
export async function call(url: string, init: { method?: string; token?: string; body?: unknown; headers?: Record<string, string>; rawBody?: string } = {}) {
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  let body: string | undefined;
  if (init.rawBody !== undefined) { body = init.rawBody; headers['Content-Type'] ??= 'application/json'; }
  else if (init.body !== undefined) { body = JSON.stringify(init.body); headers['Content-Type'] = 'application/json'; }
  const res = await fetch(url, { method: init.method ?? (body ? 'POST' : 'GET'), headers, body });
  let json: any = null;
  const text = await res.text();
  try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
  return { status: res.status, json, headers: res.headers, text };
}

/** Silence the server's own console output while a test runs. */
export function quiet<T>(fn: () => Promise<T>): Promise<T> {
  const saved = { log: console.log, warn: console.warn, error: console.error };
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  return fn().finally(() => { console.log = saved.log; console.warn = saved.warn; console.error = saved.error; });
}
