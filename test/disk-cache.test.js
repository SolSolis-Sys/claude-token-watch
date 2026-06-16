'use strict';

/**
 * TDD test for the persistent disk cache in lib/usage-api.js.
 *
 * Root cause under test: the statusline is spawned as a brand-new Node
 * process on every render, so the in-memory L1 cache (`_cache`) never
 * survives between renders. This forces a fresh HTTP GET on every render,
 * which the API rate-limits (429), producing a misleading heuristic
 * fallback instead of real (even if slightly stale) data.
 *
 * Fix under test:
 *   A) Persistent disk cache at ~/.claude/token-watch/usage-cache.json
 *      - fresh disk cache (< CACHE_TTL_MS) => no HTTP call, returns cached data.
 *      - successful fetch => disk cache written.
 *      - failed fetch (429/null) + existing disk cache (even stale) => return
 *        the stale cached data instead of null.
 *      - failed fetch + no disk cache at all => null.
 *      - token is never persisted to the cache file.
 *   B) tlsInsecureOk persisted when strict TLS fails but non-strict succeeds;
 *      reused on next fetch to skip the doomed strict attempt (unless
 *      TOKEN_WATCH_TLS_STRICT=1, which always forces null on TLS failure).
 *
 * Run: node test/disk-cache.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

let passed = 0;
function ok(name, fn) {
  fn();
  passed++;
  console.log('  ✓ ' + name);
}

const CACHE_DIR = path.join(os.homedir(), '.claude', 'token-watch');
const CACHE_FILE = path.join(CACHE_DIR, 'usage-cache.json');

// ── Test harness: stub https + credentials file so we control every fetch ──

function withFakeCredentials(token, fn) {
  const credDir = path.join(os.homedir(), '.claude');
  const credPath = path.join(credDir, '.credentials.json');
  const hadCredDir = fs.existsSync(credDir);
  const hadCredFile = fs.existsSync(credPath);
  const origCred = hadCredFile ? fs.readFileSync(credPath, 'utf8') : null;

  fs.mkdirSync(credDir, { recursive: true });
  fs.writeFileSync(credPath, JSON.stringify({
    claudeAiOauth: { accessToken: token, expiresAt: Date.now() + 3600_000 },
  }));

  try {
    fn();
  } finally {
    if (hadCredFile) fs.writeFileSync(credPath, origCred);
    else { try { fs.unlinkSync(credPath); } catch {} }
  }
}

function backupCacheFile() {
  if (fs.existsSync(CACHE_FILE)) {
    return fs.readFileSync(CACHE_FILE, 'utf8');
  }
  return undefined;
}

function restoreCacheFile(backup) {
  if (backup === undefined) {
    try { fs.unlinkSync(CACHE_FILE); } catch {}
  } else {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(CACHE_FILE, backup);
  }
}

function writeDiskCache(obj) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(obj));
}

/**
 * Stub the `https` module's `request` for the duration of `fn`. The stub
 * responds according to `behavior(options)` which returns
 * { statusCode, body } or throws/emits an error via `mode`.
 *
 * `fn` may be async and may trigger multiple sequential HTTP attempts
 * (e.g. the strict-TLS-then-fallback flow in fetchUsage()). The stub MUST
 * stay installed for the entire async flow, not just for the synchronous
 * portion of `fn`. Callers should use `withStubbedHttpsAsync` (below) to
 * correctly await `fn` before restoring `https.request`.
 */
function withStubbedHttps(responder, fn) {
  const https = require('https');
  const origRequest = https.request;

  https.request = function (options, callback) {
    const calls = withStubbedHttps._calls || [];
    calls.push(options);
    withStubbedHttps._calls = calls;

    const result = responder(options);

    const ee = new (require('events').EventEmitter)();
    ee.end = function () {};
    ee.destroy = function () {};
    ee.setTimeout = function () {};

    if (result.networkError) {
      process.nextTick(() => ee.emit('error', { code: result.networkError }));
      return ee;
    }

    process.nextTick(() => {
      const res = new (require('events').EventEmitter)();
      res.statusCode = result.statusCode;
      callback(res);
      process.nextTick(() => {
        res.emit('data', result.body);
        res.emit('end');
      });
    });
    return ee;
  };

  withStubbedHttps._calls = [];

  // Return a thenable so `Promise.resolve(fn()).finally(...)`-style callers
  // (see withStubbedHttpsAsync) restore https.request only AFTER the async
  // `fn` has fully settled — not right after the synchronous call returns.
  return Promise.resolve()
    .then(fn)
    .finally(() => { https.request = origRequest; });
}

function freshUsageApiModule() {
  // Force re-require so module-level state (_cache, _tlsWarned) is reset
  // and CACHE_FILE path constants are re-evaluated against current homedir.
  const modPath = require.resolve('../lib/usage-api');
  delete require.cache[modPath];
  return require('../lib/usage-api');
}

console.log('token-watch disk-cache test\n');

const cacheBackup = backupCacheFile();

(async () => {
  // ── A) fresh disk cache => no HTTP call ───────────────────────────────────
  await (async () => {
    restoreCacheFile(undefined);
    const fakeData = { session5hPct: 0.79, weekly7dPct: 0.42, resetsSession: null, resetsWeekly: null };
    writeDiskCache({ data: fakeData, fetchedAt: Date.now(), tlsInsecureOk: false });

    let httpCalled = false;
    await withFakeCredentialsAsync('tok-A', async () => {
      await withStubbedHttpsAsync(() => { httpCalled = true; return { statusCode: 429, body: '{}' }; }, async () => {
        const api = freshUsageApiModule();
        const result = await api.getUsage();
        ok('fresh disk cache short-circuits HTTP entirely', () => {
          assert.strictEqual(httpCalled, false, 'HTTP must not be called when disk cache is fresh');
          assert.deepStrictEqual(result, fakeData);
        });
      });
    });
  })();

  // ── A) successful fetch writes disk cache ─────────────────────────────────
  await (async () => {
    restoreCacheFile(undefined);
    const apiBody = JSON.stringify({
      five_hour: { utilization: 79, resets_at: '2026-06-16T10:00:00Z' },
      seven_day: { utilization: 42, resets_at: '2026-06-20T00:00:00Z' },
    });

    await withFakeCredentialsAsync('tok-B', async () => {
      await withStubbedHttpsAsync(() => ({ statusCode: 200, body: apiBody }), async () => {
        const api = freshUsageApiModule();
        const result = await api.getUsage();
        ok('successful fetch returns parsed data', () => {
          assert.ok(result);
          assert.strictEqual(result.session5hPct, 0.79);
          assert.strictEqual(result.weekly7dPct, 0.42);
        });
        ok('successful fetch persists disk cache', () => {
          assert.ok(fs.existsSync(CACHE_FILE), 'cache file should exist after a successful fetch');
          const onDisk = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
          assert.strictEqual(onDisk.data.session5hPct, 0.79);
          assert.ok(typeof onDisk.fetchedAt === 'number');
        });
        ok('disk cache never contains the bearer token', () => {
          const raw = fs.readFileSync(CACHE_FILE, 'utf8');
          assert.ok(!raw.includes('tok-B'), 'token must never be written to the disk cache');
        });
      });
    });
  })();

  // ── A) failed fetch + stale disk cache => return stale data, not null ────
  await (async () => {
    restoreCacheFile(undefined);
    const staleData = { session5hPct: 0.79, weekly7dPct: 0.50, resetsSession: null, resetsWeekly: null };
    // Stale = older than CACHE_TTL_MS (60s)
    writeDiskCache({ data: staleData, fetchedAt: Date.now() - 120_000, tlsInsecureOk: false });

    await withFakeCredentialsAsync('tok-C', async () => {
      await withStubbedHttpsAsync(() => ({ statusCode: 429, body: '{}' }), async () => {
        const api = freshUsageApiModule();
        const result = await api.getUsage();
        ok('429 + stale disk cache returns stale data (real-stale beats heuristic)', () => {
          assert.deepStrictEqual(result, staleData);
        });
      });
    });
  })();

  // ── A) failed fetch + no disk cache at all => null ────────────────────────
  await (async () => {
    restoreCacheFile(undefined);

    await withFakeCredentialsAsync('tok-D', async () => {
      await withStubbedHttpsAsync(() => ({ statusCode: 429, body: '{}' }), async () => {
        const api = freshUsageApiModule();
        const result = await api.getUsage();
        ok('429 + no disk cache returns null (caller falls back to heuristic)', () => {
          assert.strictEqual(result, null);
        });
      });
    });
  })();

  // ── B) tlsInsecureOk persisted + reused, skipping the doomed strict leg ──
  await (async () => {
    restoreCacheFile(undefined);
    const apiBody = JSON.stringify({
      five_hour: { utilization: 10, resets_at: null },
      seven_day: { utilization: 20, resets_at: null },
    });

    await withFakeCredentialsAsync('tok-E', async () => {
      let callCount = 0;
      await withStubbedHttpsAsync((options) => {
        callCount++;
        if (options.rejectUnauthorized) {
          const err = new Error('chain');
          err.code = 'UNABLE_TO_VERIFY_LEAF_SIGNATURE';
          return { networkError: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' };
        }
        return { statusCode: 200, body: apiBody };
      }, async () => {
        const api = freshUsageApiModule();
        const first = await api.getUsage();
        ok('TLS chain failure falls back to insecure and succeeds', () => {
          assert.ok(first);
          assert.strictEqual(first.session5hPct, 0.10);
        });
        ok('tlsInsecureOk persisted to disk cache after fallback success', () => {
          const onDisk = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
          assert.strictEqual(onDisk.tlsInsecureOk, true);
        });
      });

      // Second fetch (force-expire cache) should skip the strict attempt.
      await withStubbedHttpsAsync((options) => {
        callCount++;
        return { statusCode: 200, body: apiBody };
      }, async () => {
        const onDisk = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
        onDisk.fetchedAt = Date.now() - 120_000; // expire it
        fs.writeFileSync(CACHE_FILE, JSON.stringify(onDisk));

        const api = freshUsageApiModule();
        const callsBefore = (require('https').request._tw_calls || []).length;
        const seenOptions = [];
        const origRequest = require('https').request;
        require('https').request = function (options, cb) {
          seenOptions.push(options);
          return origRequest(options, cb);
        };
        await api.fetchUsage();
        require('https').request = origRequest;

        ok('subsequent fetch with tlsInsecureOk skips strict TLS attempt', () => {
          assert.strictEqual(seenOptions.length, 1, 'should only make one HTTP attempt, not strict-then-fallback');
          assert.strictEqual(seenOptions[0].rejectUnauthorized, false);
        });
      });
    });
  })();

  // ── B) TOKEN_WATCH_TLS_STRICT=1 always forces null on TLS failure ────────
  await (async () => {
    restoreCacheFile(undefined);
    const origStrict = process.env.TOKEN_WATCH_TLS_STRICT;
    process.env.TOKEN_WATCH_TLS_STRICT = '1';

    await withFakeCredentialsAsync('tok-F', async () => {
      await withStubbedHttpsAsync(() => ({ networkError: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' }), async () => {
        const api = freshUsageApiModule();
        const result = await api.fetchUsage();
        ok('TOKEN_WATCH_TLS_STRICT=1 forces null on TLS chain failure, no insecure retry', () => {
          assert.strictEqual(result, null);
        });
      });
    });

    if (origStrict === undefined) delete process.env.TOKEN_WATCH_TLS_STRICT;
    else process.env.TOKEN_WATCH_TLS_STRICT = origStrict;
  })();

  restoreCacheFile(cacheBackup);
  console.log('\n' + passed + ' checks passed.');
})().catch((err) => {
  restoreCacheFile(cacheBackup);
  console.error('TEST FAILURE:', err);
  process.exit(1);
});

// ── Promise-friendly wrappers around the sync helpers above ─────────────────

function withFakeCredentialsAsync(token, fn) {
  return new Promise((resolve, reject) => {
    withFakeCredentials(token, () => {
      Promise.resolve(fn()).then(resolve, reject);
    });
  });
}

function withStubbedHttpsAsync(responder, fn) {
  // withStubbedHttps now installs the stub, awaits `fn` to full completion,
  // and only then restores the original https.request — so the stub stays
  // active through every sequential HTTP attempt `fn` triggers (e.g. the
  // strict-TLS-then-fallback retry flow), not just the first one.
  return withStubbedHttps(responder, fn);
}
