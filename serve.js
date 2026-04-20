/**
 * EstateBuilder.ai — Local Server with Live Reload
 *
 * Run:   node serve.js
 * Open:  http://localhost:3000
 *
 * Features:
 * - Serves all project files (HTML, JS, CSS, images)
 * - Watches for file changes and auto-reloads the browser
 * - No dependencies — uses Node.js built-ins only
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const FILE = path.join(__dirname, 'estatebuilder-ai.html');

// ── Allowed origins for CORS / proxy access ──
// Local dev origins only. Add your production origin here when deploying.
// Set to ['*'] to disable origin checking (NOT RECOMMENDED — anyone on the network
// could submit API keys through your /api/claude proxy).
const ALLOWED_ORIGINS = new Set([
  'http://localhost:' + PORT,
  'http://127.0.0.1:' + PORT,
  // Add production origin(s) here, e.g.: 'https://estatebuilder.ai'
]);

function _resolveOrigin(req){
  // Echo back the request's Origin header IF allowlisted, otherwise null (= block).
  // Returning null on a CORS preflight effectively rejects the cross-origin request.
  var o = req.headers.origin;
  if(!o) return 'null'; // same-origin or no Origin header — safe to allow
  if(ALLOWED_ORIGINS.has(o)) return o;
  return null;
}

const MIME = {
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
};

// ── Live Reload: SSE (Server-Sent Events) ──
// Clients connect to /livereload and receive a "reload" event on file changes.
const lrClients = new Set();

const LIVE_RELOAD_SCRIPT = `
<script>
// Live reload — auto-injected by serve.js
(function(){
  var es = new EventSource('/livereload');
  es.onmessage = function(e) {
    if (e.data === 'reload') {
      console.log('[LiveReload] File changed — reloading...');
      location.reload();
    }
  };
  es.onerror = function() { setTimeout(function(){ es = new EventSource('/livereload'); }, 2000); };
})();
</script>
`;

const server = http.createServer((req, res) => {
  // SSE endpoint for live reload
  if (req.url === '/livereload') {
    var sseOrigin = _resolveOrigin(req);
    var sseHeaders = {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    };
    if(sseOrigin) sseHeaders['Access-Control-Allow-Origin'] = sseOrigin;
    res.writeHead(200, sseHeaders);
    res.write('data: connected\n\n');
    lrClients.add(res);
    req.on('close', () => lrClients.delete(res));
    return;
  }

  // ── Claude API Proxy ──
  // Proxies requests to Anthropic's Messages API to avoid CORS restrictions.
  // The browser sends the API key in the JSON body; this proxy forwards it
  // as the x-api-key header to api.anthropic.com.
  if (req.url === '/api/claude' && req.method === 'POST') {
    // Origin validation — reject cross-origin POSTs from non-allowlisted domains.
    var apiOrigin = _resolveOrigin(req);
    if(apiOrigin === null){
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Origin not allowed' } }));
      return;
    }
    // Limit request body size to 256KB to prevent abuse / memory exhaustion
    let body = '';
    let _bodySize = 0;
    let _aborted = false;
    req.on('data', chunk => {
      if(_aborted) return;
      _bodySize += chunk.length;
      if(_bodySize > 256 * 1024){
        _aborted = true;
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Request body too large (max 256KB)' } }));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      if(_aborted) return;
      let parsed;
      try { parsed = JSON.parse(body); } catch(e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Invalid JSON in request body' } }));
        return;
      }

      const apiKey = parsed.apiKey;
      if (!apiKey) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Missing apiKey in request body' } }));
        return;
      }

      // Build the Anthropic Messages API payload (strip apiKey from forwarded body)
      const anthropicBody = JSON.stringify({
        model: parsed.model || 'claude-haiku-4-5',
        max_tokens: parsed.max_tokens || 4096,
        temperature: parsed.temperature != null ? parsed.temperature : 0.3,
        system: parsed.system || '',
        messages: parsed.messages || [],
      });

      const options = {
        hostname: 'api.anthropic.com',
        port: 443,
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(anthropicBody),
        },
      };

      const proxyReq = https.request(options, (proxyRes) => {
        let data = '';
        proxyRes.on('data', chunk => { data += chunk; });
        proxyRes.on('end', () => {
          var proxyHeaders = { 'Content-Type': 'application/json' };
          if(apiOrigin) proxyHeaders['Access-Control-Allow-Origin'] = apiOrigin;
          res.writeHead(proxyRes.statusCode, proxyHeaders);
          res.end(data);
        });
      });

      proxyReq.on('error', (e) => {
        console.error('[Proxy] Anthropic API error:', e.message);
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Proxy error: ' + e.message } }));
      });

      proxyReq.write(anthropicBody);
      proxyReq.end();
    });
    return;
  }

  // Handle CORS preflight for /api/claude
  if (req.url === '/api/claude' && req.method === 'OPTIONS') {
    var preflightOrigin = _resolveOrigin(req);
    if(preflightOrigin === null){
      res.writeHead(403);
      res.end();
      return;
    }
    var preflightHeaders = {
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };
    if(preflightOrigin) preflightHeaders['Access-Control-Allow-Origin'] = preflightOrigin;
    res.writeHead(204, preflightHeaders);
    res.end();
    return;
  }

  // Serve the main HTML for root
  let filePath = FILE;

  if (req.url !== '/' && req.url !== '/index.html') {
    // Path traversal protection: resolve and verify the resolved path is INSIDE __dirname
    var rawUrl = req.url.split('?')[0];
    var safePath = path.normalize(path.join(__dirname, rawUrl));
    if (safePath.indexOf(__dirname) !== 0) {
      // Resolved path escapes the project directory — reject
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    if (fs.existsSync(safePath) && !fs.statSync(safePath).isDirectory()) {
      filePath = safePath;
    }
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    // Inject live reload script into HTML responses + cache-bust local <script src="js/...">
    if (ext === '.html') {
      let html = data.toString();
      // Cache-bust: append ?v=<timestamp> to every local script tag so browsers re-fetch
      // the latest JS even when they aggressively cache. Timestamp matches when the HTML
      // was served (which is itself never cached due to no-cache header above).
      const cacheBuster = '?v=' + Date.now();
      html = html.replace(/(<script\s+src=")(js\/[^"?]+)("[^>]*>)/g, (_, pre, src, post) => {
        return pre + src + cacheBuster + post;
      });
      // Also cache-bust the local CSS file
      html = html.replace(/(<link\s+href=")(css\/[^"?]+)("[^>]*>)/g, (_, pre, src, post) => {
        return pre + src + cacheBuster + post;
      });
      html = html.replace('</body>', LIVE_RELOAD_SCRIPT + '</body>');
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      });
      res.end(html);
      return;
    }

    res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-cache, no-store, must-revalidate' });
    res.end(data);
  });
});

// ── File Watcher ──
// Watch project directories for changes and trigger reload
const WATCH_DIRS = [__dirname, path.join(__dirname, 'js'), path.join(__dirname, 'css')];
const WATCH_EXTS = new Set(['.html', '.js', '.css']);

let reloadTimer = null;
function triggerReload(filename) {
  // Debounce: wait 200ms to batch rapid saves
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    console.log(`  [LiveReload] ${filename} changed — notifying ${lrClients.size} client(s)`);
    for (const client of lrClients) {
      try { client.write('data: reload\n\n'); } catch (e) { lrClients.delete(client); }
    }
  }, 200);
}

for (const dir of WATCH_DIRS) {
  try {
    fs.watch(dir, { persistent: false }, (event, filename) => {
      if (filename && WATCH_EXTS.has(path.extname(filename).toLowerCase())) {
        triggerReload(filename);
      }
    });
  } catch (e) {
    // Directory might not exist yet — that's fine
  }
}

server.listen(PORT, () => {
  console.log('');
  console.log('  ╔═══════════════════════════════════════════╗');
  console.log('  ║   EstateBuilder.ai — Local Server          ║');
  console.log('  ║                                            ║');
  console.log(`  ║   Open: http://localhost:${PORT}               ║`);
  console.log('  ║   Live Reload: ENABLED                     ║');
  console.log('  ║   Stop: Ctrl+C                             ║');
  console.log('  ╚═══════════════════════════════════════════╝');
  console.log('');
  console.log('  Watching: .html, .js, .css files for changes');
  console.log('');
});
