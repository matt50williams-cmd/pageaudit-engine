const https = require('https');
const http = require('http');

async function proxyRoutes(fastify) {
  fastify.get('/api/fb-photo/:username', async (request, reply) => {
    const { username } = request.params;
    
    return new Promise((resolve) => {
      const fetchUrl = (url, redirectCount = 0) => {
        if (redirectCount > 5) {
          reply.status(404).send({ error: 'Too many redirects' });
          resolve();
          return;
        }

        const protocol = url.startsWith('https') ? https : http;
        
        protocol.get(url, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            // Follow redirect
            let nextUrl = res.headers.location;
            if (nextUrl.startsWith('/')) {
              const parsed = new URL(url);
              nextUrl = `${parsed.protocol}//${parsed.host}${nextUrl}`;
            }
            res.resume();
            fetchUrl(nextUrl, redirectCount + 1);
          } else if (res.statusCode === 200) {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
              const buffer = Buffer.concat(chunks);
              reply.header('Content-Type', res.headers['content-type'] || 'image/jpeg');
              reply.header('Cache-Control', 'public, max-age=86400');
              reply.header('Access-Control-Allow-Origin', '*');
              reply.send(buffer);
              resolve();
            });
          } else {
            reply.status(res.statusCode || 404).send({ error: 'Image not found' });
            resolve();
          }
        }).on('error', (err) => {
          console.error('Proxy error:', err.message);
          reply.status(500).send({ error: 'Proxy failed' });
          resolve();
        });
      };

      const initialUrl = `https://graph.facebook.com/${encodeURIComponent(username)}/picture?type=large&redirect=true`;
      fetchUrl(initialUrl);
    });
  });
}

module.exports = proxyRoutes;
