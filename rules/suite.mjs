// Firestore rules checks against the emulator, for apps built on rules/common.rules. No dependencies (Node 22).
//
//   emulator({ project })   a small REST client: load rules, seed and clear documents, act as a user with claims,
//                           count document lookups (get/exists) from the emulator's coverage report.
//   suite({ ... })          registers the generic node:test cases for each collection (see README "Rules kit").
//
// Tokens are unsigned, as the emulator accepts them; claims go in exactly as a Worker would set them.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const LOOKUP = /^(get|exists|getAfter|existsAfter)\s*\(/;

export function token(uid, claims = {}, project = 'demo-rules') {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const body = {
    iss: `https://securetoken.google.com/${project}`, aud: project, iat: now, exp: now + 3600, auth_time: now,
    sub: uid, user_id: uid, firebase: { sign_in_provider: 'custom', identities: {} }, ...claims,
  };
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64(body)}.`;
}

// JS value -> Firestore REST value. Dates become timestamps.
export function toValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  return { mapValue: { fields: fields(v) } };
}
const fields = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, toValue(v)]));

export function emulator({ project, host = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080' }) {
  if (!/^demo-/.test(project)) throw new Error(`rules suite: project must start with demo- (got ${project})`);
  const base = `http://${host}`;
  const root = `projects/${project}/databases/(default)/documents`;
  const url = (p) => `${base}/v1/${root}/${p}`;

  async function call(method, u, auth, body) {
    const headers = { 'content-type': 'application/json' };
    if (auth) headers.authorization = `Bearer ${auth}`;
    const r = await fetch(u, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    return { status: r.status, text };
  }
  // allowed = the rules let it through (a missing document still counts as allowed); denied = 403
  function verdict({ status, text }) {
    if (status === 403) return { ok: false, status };
    if (status < 300 || status === 404) return { ok: true, status };
    throw new Error(`emulator answered ${status}: ${text.slice(0, 300)}`);
  }
  const write = (op, path, data, opts = {}) => {
    const w = op === 'delete' ? { delete: `${root}/${path}` } : { update: { name: `${root}/${path}`, fields: fields(data) } };
    if (op === 'create') w.currentDocument = { exists: false };
    if (op === 'update') w.currentDocument = { exists: true };
    if (opts.serverAt) w.updateTransforms = [{ fieldPath: 'serverAt', setToServerValue: 'REQUEST_TIME' }];
    return w;
  };

  function client(auth) {
    const commit = async (op, path, data, opts) =>
      verdict(await call('POST', `${base}/v1/${root}:commit`, auth, { writes: [write(op, path, data, opts)] }));
    return {
      get: async (path) => verdict(await call('GET', url(path), auth)),
      list: async (path) => verdict(await call('GET', url(path), auth)),
      create: (path, data, opts) => commit('create', path, data, opts),
      update: (path, data, opts) => commit('update', path, data, opts),
      set: (path, data, opts) => commit('set', path, data, opts),
      delete: (path) => commit('delete', path),
    };
  }

  const emu = {
    project,
    async loadRules(text) {
      const r = await call('PUT', `${base}/emulator/v1/projects/${project}:securityRules`, null,
        { rules: { files: [{ name: 'firestore.rules', content: text }] } });
      if (r.status !== 200) throw new Error(`rules did not load: ${r.text.slice(0, 2000)}`);
      emu.rules = text;
    },
    async clear() {
      await call('DELETE', `${base}/emulator/v1/projects/${project}/databases/(default)/documents`);
    },
    // admin writes skip the rules
    async seed(path, data) {
      const r = await call('PATCH', url(path), 'owner', { fields: fields(data) });
      if (r.status !== 200) throw new Error(`seed ${path}: ${r.status} ${r.text.slice(0, 300)}`);
    },
    anon: () => client(null),
    as: (uid, claims = {}) => client(token(uid, claims, project)),
    // Document lookups (get/exists calls) the rules evaluated while fn ran. Each evaluation counts, so a repeated
    // lookup of the same document counts twice: an upper bound on what Firestore bills and limits.
    async lookups(fn) {
      const before = await emu.lookupTotal();
      await fn();
      return (await emu.lookupTotal()) - before;
    },
    async lookupTotal() {
      const r = await call('GET', `${base}/emulator/v1/projects/${project}:ruleCoverage`);
      if (r.status !== 200) return 0;
      const { rules, report = [] } = JSON.parse(r.text);
      const src = rules?.files?.[0]?.content ?? '';
      let n = 0;
      const walk = (node) => {
        const { currentOffset = 0, endOffset = 0 } = node.sourcePosition ?? {};
        if (LOOKUP.test(src.slice(currentOffset, endOffset))) for (const v of node.values ?? []) n += v.count ?? 0;
        for (const c of node.children ?? []) walk(c);
      };
      report.forEach(walk);
      return n;
    },
  };
  return emu;
}

// Generic cases for each collection. config:
//   project       'demo-…'           rules     built rules text
//   roles         every role the app uses, e.g. ['admin', 'member', 'guest']
//   collections   [{ path, read, write, data, stamp, lookups }]
//       path      a document path; '{g}' marks the group id (multi-group). Without it the app is single-group and
//                 the claim key is '_'.
//       read      roles that may read; write: roles that may create; data: a valid new document (object or fn(uid))
//       stamp     'strict' (serverAt == request.time required), 'lenient' (optional, but if present it must be
//                 request.time) or 'none' (default)
//       lookups   { read: 1, write: 1 } most get/exists evaluations allowed per request (defaults shown; 2 at most)
//   fallback      optional { seed(uid, gid) -> [[path, data], …], role } for the claims-or-doc migration form:
//                 a user with no claim and that role doc must get `role`'s access.
export function suite(config) {
  const emu = emulator(config);
  const roles = config.roles;
  const now = () => Math.floor(Date.now() / 1000);
  const G = 'g1';
  const OTHER = 'g2';

  test('rules load', async () => { await emu.loadRules(config.rules); });

  for (const c of config.collections) {
    const multi = c.path.includes('{g}');
    const key = multi ? G : '_';
    const path = c.path.replaceAll('{g}', G);
    const collection = path.split('/').slice(0, -1).join('/');
    const fresh = () => `${collection}/new-${Math.random().toString(36).slice(2, 10)}`;
    const data = (uid) => (typeof c.data === 'function' ? c.data(uid) : c.data);
    const stamp = c.stamp ?? 'none';
    const opts = stamp === 'none' ? {} : { serverAt: true };
    const max = { read: 1, write: 1, ...c.lookups };
    const reader = c.read[0];
    const writer = c.write[0];
    const claims = (role, extra = {}) => ({ g: { [key]: role }, v: 1, ...extra });
    const name = (s) => `${c.path}: ${s}`;
    const reset = async () => { await emu.clear(); await emu.seed(path, data('seed')); };

    test(name('signed out: read and create denied'), async () => {
      await reset();
      assert.equal((await emu.anon().get(path)).ok, false);
      assert.equal((await emu.anon().list(collection)).ok, false);
      assert.equal((await emu.anon().create(fresh(), data('anon'), opts)).ok, false);
    });

    test(name(`allowed roles: read ${c.read.join('/')}, create ${c.write.join('/') || 'none'}`), async () => {
      await reset();
      for (const r of c.read) assert.equal((await emu.as(`u-${r}`, claims(r)).get(path)).ok, true, `${r} read`);
      for (const r of c.write) {
        assert.equal((await emu.as(`u-${r}`, claims(r)).create(fresh(), data(`u-${r}`), opts)).ok, true, `${r} create`);
      }
    });

    test(name('other roles and no role denied'), async () => {
      await reset();
      for (const r of [...roles.filter((x) => !c.read.includes(x)), '']) {
        const u = emu.as(`u-x${r}`, r ? claims(r) : { v: 1 });
        assert.equal((await u.get(path)).ok, false, `${r || 'no role'} read`);
      }
      for (const r of [...roles.filter((x) => !c.write.includes(x)), '']) {
        const u = emu.as(`u-x${r}`, r ? claims(r) : { v: 1 });
        assert.equal((await u.create(fresh(), data(`u-x${r}`), opts)).ok, false, `${r || 'no role'} create`);
      }
    });

    if (multi) {
      test(name('a role in another group only: denied'), async () => {
        await reset();
        const u = emu.as('u-other', { g: { [OTHER]: reader }, v: 1 });
        assert.equal((await u.get(path)).ok, false);
        if (writer) {
          const w = emu.as('u-other', { g: { [OTHER]: writer }, v: 1 });
          assert.equal((await w.create(fresh(), data('u-other'), opts)).ok, false);
        }
      });
    }

    test(name('expired access (x in the past): denied; x in the future: allowed'), async () => {
      await reset();
      assert.equal((await emu.as('u-old', claims(reader, { x: now() - 60 })).get(path)).ok, false);
      assert.equal((await emu.as('u-new', claims(reader, { x: now() + 3600 })).get(path)).ok, true);
      if (writer) {
        const w = emu.as('u-old', claims(writer, { x: now() - 60 }));
        assert.equal((await w.create(fresh(), data('u-old'), opts)).ok, false);
      }
    });

    test(name('revoked uid: denied even with a valid claim'), async () => {
      await reset();
      await emu.seed('revoked/u-gone', { at: new Date() });
      assert.equal((await emu.as('u-gone', claims(reader)).get(path)).ok, false);
      if (writer) {
        assert.equal((await emu.as('u-gone', claims(writer)).create(fresh(), data('u-gone'), opts)).ok, false);
      }
    });

    if (writer && stamp !== 'none') {
      test(name(`serverAt (${stamp})`), async () => {
        await reset();
        const w = emu.as(`u-${writer}`, claims(writer));
        const d = data(`u-${writer}`);
        assert.equal((await w.create(fresh(), { ...d, serverAt: new Date(Date.now() - 60000) })).ok, false,
          'a client-chosen serverAt is refused');
        assert.equal((await w.create(fresh(), d)).ok, stamp === 'lenient', 'no serverAt');
        assert.equal((await w.create(fresh(), d, { serverAt: true })).ok, true, 'serverAt = request.time');
      });
    }

    test(name(`document lookups: read ≤ ${max.read}, create ≤ ${max.write}`), async () => {
      assert.ok(max.read <= 2 && max.write <= 2, 'the kit allows at most 2 lookups per request');
      await reset();
      const u = emu.as(`u-${reader}`, claims(reader));
      const n = await emu.lookups(() => u.get(path));
      assert.ok(n <= max.read, `read used ${n} lookups`);
      if (writer) {
        const w = emu.as(`u-${writer}`, claims(writer));
        const m = await emu.lookups(() => w.create(fresh(), data(`u-${writer}`), opts));
        assert.ok(m <= max.write, `create used ${m} lookups`);
      }
    });

    if (config.fallback) {
      test(name('migration: no claim, role doc only → that role; a claim wins over the doc'), async () => {
        await reset();
        const r = config.fallback.role;
        for (const [p, d] of config.fallback.seed('u-doc', key)) await emu.seed(p, d);
        assert.equal((await emu.as('u-doc', { v: 0 }).get(path)).ok, c.read.includes(r), 'doc role read');
        const weaker = roles.find((x) => !c.read.includes(x));
        if (weaker && c.read.includes(r)) {
          assert.equal((await emu.as('u-doc', claims(weaker)).get(path)).ok, false, 'claim wins');
        }
      });
    }
  }

  test('revoked/ is closed to every client', async () => {
    await emu.clear();
    await emu.seed('revoked/u1', { at: new Date() });
    const u = emu.as('u1', { g: { _: roles[0], [G]: roles[0] } });
    assert.equal((await u.get('revoked/u1')).ok, false);
    assert.equal((await u.delete('revoked/u1')).ok, false);
    assert.equal((await emu.as('u2', { g: { _: roles[0], [G]: roles[0] } }).create('revoked/u2', { at: 1 })).ok, false);
  });

  return emu;
}
