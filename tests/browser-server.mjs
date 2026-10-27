// Test-only HTTP adapter. Uses the real application router and SQLite SQL, not a mocked API.
// This is not Cloudflare's D1 runtime and does not expose MCP (which requires npm dependencies).
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { LocalD1, env } from './support.mjs';
import { handleRequest } from '../dist/http.js';

const db = new LocalD1();
if(process.env.MEMDB_TEST_FIXTURE==='policy-c') {
  db.sql.exec(readFileSync(new URL('./fixtures/policy-c.sql',import.meta.url),'utf8'));
}
const bindings = env(db);
const server = createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const payload = Buffer.concat(chunks);
    const url = bindings.PUBLIC_ORIGIN + req.url;
    const incoming = new Request(url, {
      method: req.method,
      headers: req.headers,
      ...(payload.length ? { body: payload } : {})
    });
    const response = await handleRequest(incoming, bindings);
    res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error('Browser harness failure:', error);
    res.writeHead(500, {'Content-Type':'text/plain'});
    res.end('Harness error');
  }
});
server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  bindings.PUBLIC_ORIGIN = `http://127.0.0.1:${address.port}`;
  console.log('READY ' + bindings.PUBLIC_ORIGIN);
});
process.on('SIGTERM', () => server.close(() => { db.close(); process.exit(0); }));
