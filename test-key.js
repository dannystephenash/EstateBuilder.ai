/**
 * Quick API key test — run: node test-key.js YOUR_KEY_HERE
 * Example: node test-key.js sk-ant-api03-YSF...XQAA
 */
const https = require('https');
const key = process.argv[2];

if (!key) {
  console.log('Usage: node test-key.js sk-ant-api03-YOUR_KEY_HERE');
  process.exit(1);
}

console.log('Key length:', key.length);
console.log('Key starts:', key.slice(0, 15));
console.log('Key ends:', key.slice(-6));
console.log('Sending test request to api.anthropic.com...\n');

const body = JSON.stringify({
  model: 'claude-haiku-4-5',
  max_tokens: 16,
  messages: [{ role: 'user', content: 'Say OK' }],
});

const req = https.request({
  hostname: 'api.anthropic.com',
  port: 443,
  path: '/v1/messages',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': key,
    'anthropic-version': '2023-06-01',
    'Content-Length': Buffer.byteLength(body),
  },
}, (res) => {
  let data = '';
  res.on('data', chunk => { data += chunk; });
  res.on('end', () => {
    console.log('HTTP Status:', res.statusCode);
    try {
      const parsed = JSON.parse(data);
      if (res.statusCode === 200) {
        console.log('✓ KEY IS VALID! Response:', parsed.content[0].text);
      } else {
        console.log('✗ Error:', parsed.error?.message || data);
      }
    } catch(e) {
      console.log('Raw response:', data);
    }
  });
});

req.on('error', e => console.error('Network error:', e.message));
req.write(body);
req.end();
