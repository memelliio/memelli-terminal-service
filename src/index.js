// Universal team shell - DB-resilient boot
const fastify = require('fastify');
const { Client } = require('pg');

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  const SCHEMA = process.env.SCHEMA || 'kernel';
  const client = new Client({ connectionString: dbUrl });
  let dbOk = false;
  let dbErr = null;
  try { await client.connect(); dbOk = true; }
  catch (e) { dbErr = String(e.message).slice(0, 200); console.error('[boot] DB connect failed, starting DEGRADED:', dbErr); }

  const helpers = {
    client,
    schema: SCHEMA,
    db_ok: dbOk,
    async markStatus(name, status, errorText = '') {
      if (!dbOk) return;
      try { await client.query(, [status, errorText, name]); } catch (e) {}
    },
  };

  const app = fastify();
  app.__schema = SCHEMA;
  app.get('/__health', async () => ({ ok: true, schema: SCHEMA, db: dbOk, db_error: dbErr, mode: dbOk ? 'full' : 'degraded', service: process.env.RAILWAY_SERVICE_NAME, ts: new Date().toISOString() }));

  if (dbOk) {
    try {
      let res = await client.query();
      if (res.rowCount === 0) {
        res = await client.query();
      }
      const code = res.rows[0]?.code_text;
      if (code) {
        await helpers.markStatus('_shell_orchestrator', 'deploying');
        const mod = { exports: {} };
        const fn = new Function('module', 'exports', 'require', 'app', 'helpers', code);
        fn(mod, mod.exports, require, app, helpers);
        if (typeof mod.exports.register === 'function') {
          await mod.exports.register(app, helpers);
          await helpers.markStatus('_shell_orchestrator', 'deployed');
          console.log('[shell] booted, schema=' + SCHEMA);
        }
      }
    } catch (e) { console.error('[shell] orchestrator load failed:', e.message); }
  } else {
    console.log('[shell] DEGRADED mode — DB unavailable, only /__health responds');
  }

  const port = parseInt(process.env.PORT || '3000', 10);
  await app.listen({ port, host: '0.0.0.0' });
  console.log('[shell] listening on 0.0.0.0:' + port + (dbOk ? ' full' : ' degraded'));
}

main().catch(err => { console.error('[fatal]', err); process.exit(1); });
