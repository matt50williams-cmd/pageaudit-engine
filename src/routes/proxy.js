const https = require('https');
const http = require('http');

function fetchViaProxy(targetUrl, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const BRIGHT_USER = process.env.BRIGHTDATA_USERNAME;
    const BRIGHT_PASS = process.env.BRIGHTDATA_PASSWORD;
    const BRIGHT_HOST = process.env.BRIGHTDATA_HOST || 'brd.superproxy.io';
    const BRIGHT_PORT = parseInt(process.env.BRIGHTDATA_PORT || '22225');

    if (!BRIGHT_USER || !BRIGHT_PASS) {
      return reject(new Error('Missing BrightData proxy credentials'));
    }

    const target = new URL(targetUrl);
    const proxyUser = BRIGHT_USER.includes('-country-') ? BRIGHT_USER : `${BRIGHT_USER}-country-us`;
    const auth = Buffer.from(`${proxyUser}:${BRIGHT_PASS}`).toString('base64');

    const connectReq = http.request({
      host: BRIGHT_HOST,
      port: BRIGHT_PORT,
      method: 'CONNECT',
      path: `${target.hostname}:443`,
      headers: { 'Proxy-Authorization': `Basic ${auth}` },
      timeout,
    });

    connectReq.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        return reject(new Error(`Proxy CONNECT failed: ${res.statusCode}`));
      }

      const req = https.request({
        hostname: target.hostname,
        path: target.pathname + target.search,
        method: 'GET',
        socket,
        agent: false,
        rejectUnauthorized: false,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,image/*',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      }, (response) => {
        const chunks = [];
        response.on('data', chunk => { chunks.push(chunk); });
        response.on('end', () => {
          const buffer = Buffer.concat(chunks);
          resolve({
            ok: response.statusCode < 400,
            status: response.statusCode,
            buffer,
            text: () => buffer.toString('utf-8'),
            headers: response.headers,
          });
        });
      });
      req.on('error', reject);
      req.end();
    });

    connectReq.on('error', reject);
    connectReq.on('timeout', () => { connectReq.destroy(); reject(new Error('Proxy timeout')); });
    connectReq.end();
  });
}

async function proxyRoutes(fastify) {
  fastify.get('/api/fb-photo/:username', async (request, reply) => {
    const { username } = request.params;

    const sendError = (status, message) => {
      if (!reply.sent) reply.status(status).send({ error: message });
    };

    // Clean up the username/slug
    let slug = username;
    if (slug.includes('facebook.com/')) {
      slug = slug.split('facebook.com/')[1];
    }
    slug = slug.replace(/\/$/, '').split('?')[0];

    // Extract numeric ID if profile.php?id= format
    const idMatch = username.match(/profile\.php\?id=(\d+)/);
    const numericId = idMatch ? idMatch[1] : null;

    // Try Facebook Graph API first - works for pages with numeric IDs
    if (numericId) {
      try {
        const graphUrl = `https://graph.facebook.com/${numericId}/picture?type=large&redirect=false`;
        const res = await fetch(graphUrl);
        if (res.ok) {
          const data = await res.json();
          if (data?.data?.url) {
            // Fetch and proxy the actual image
            const imgRes = await fetch(data.data.url);
            if (imgRes.ok) {
              const buffer = await imgRes.arrayBuffer();
              reply.header('Content-Type', imgRes.headers.get('content-type') || 'image/jpeg');
              reply.header('Cache-Control', 'public, max-age=86400');
              reply.header('Access-Control-Allow-Origin', '*');
              reply.send(Buffer.from(buffer));
              return;
            }
          }
        }
      } catch (err) {
        console.error('Graph API error:', err.message);
      }
    }

    // Try Graph API with slug for named pages
    try {
      const graphUrl = `https://graph.facebook.com/${encodeURIComponent(slug)}/picture?type=large&redirect=true`;
      const imgRes = await fetch(graphUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        redirect: 'follow',
      });
      if (imgRes.ok && imgRes.headers.get('content-type')?.includes('image')) {
        const buffer = await imgRes.arrayBuffer();
        reply.header('Content-Type', imgRes.headers.get('content-type') || 'image/jpeg');
        reply.header('Cache-Control', 'public, max-age=86400');
        reply.header('Access-Control-Allow-Origin', '*');
        reply.send(Buffer.from(buffer));
        return;
      }
    } catch (err) {
      console.error('Graph slug error:', err.message);
    }

    // Try Bright Data scrape if available
    const BRIGHT_USER = process.env.BRIGHTDATA_USERNAME;
    const BRIGHT_PASS = process.env.BRIGHTDATA_PASSWORD;
    const BRIGHT_HOST = process.env.BRIGHTDATA_HOST || 'brd.superproxy.io';
    const BRIGHT_PORT = parseInt(process.env.BRIGHTDATA_PORT || '33335');

    if (BRIGHT_USER && BRIGHT_PASS) {
      try {
        const pageUrl = numericId
          ? `https://www.facebook.com/profile.php?id=${numericId}`
          : `https://www.facebook.com/${encodeURIComponent(slug)}`;

        const res = await fetchViaProxy(pageUrl, 15000);

        if (res.ok) {
          const html = res.text();
          const ogMatch = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i)
            || html.match(/<meta\s+content=["']([^"']+)["']\s+property=["']og:image["']/i);

          if (ogMatch && ogMatch[1]) {
            const imageUrl = ogMatch[1].replace(/&amp;/g, '&');
            const imgRes = await fetch(imageUrl);
            if (imgRes.ok) {
              const buffer = await imgRes.arrayBuffer();
              reply.header('Content-Type', imgRes.headers.get('content-type') || 'image/jpeg');
              reply.header('Cache-Control', 'public, max-age=86400');
              reply.header('Access-Control-Allow-Origin', '*');
              reply.send(Buffer.from(buffer));
              return;
            }
          }
        }
      } catch (err) {
        console.error('Bright Data scrape error:', err.message);
      }
    }

    sendError(404, 'Image not found');
  });
}

module.exports = proxyRoutes;