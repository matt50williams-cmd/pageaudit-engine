const https = require('https');
const http = require('http');

async function proxyRoutes(fastify) {
  fastify.get('/api/fb-photo/:username', async (request, reply) => {
    const { username } = request.params;

    const BRIGHT_HOST = process.env.BRIGHTDATA_HOST || 'brd.superproxy.io';
    const BRIGHT_PORT = parseInt(process.env.BRIGHTDATA_PORT || '33335');
    const BRIGHT_USER = process.env.BRIGHTDATA_USERNAME;
    const BRIGHT_PASS = process.env.BRIGHTDATA_PASSWORD;
    const useBrightData = BRIGHT_USER && BRIGHT_PASS;

    return new Promise((resolve) => {
      const sendError = (status, message) => {
        if (!reply.sent) {
          reply.status(status).send({ error: message });
        }
        resolve();
      };

      const fetchTextViaBrightData = (url) => {
        return new Promise((resolveFetch, rejectFetch) => {
          const auth = Buffer.from(`${BRIGHT_USER}:${BRIGHT_PASS}`).toString('base64');
          const options = {
            host: BRIGHT_HOST,
            port: BRIGHT_PORT,
            method: 'CONNECT',
            path: 'www.facebook.com:443',
            headers: {
              'Proxy-Authorization': `Basic ${auth}`,
            },
          };

          const connectReq = http.request(options);
          connectReq.on('connect', (res, socket) => {
            if (res.statusCode !== 200) {
              rejectFetch(new Error(`Proxy connect failed: ${res.statusCode}`));
              return;
            }

            const getReq = https.request({
              host: 'www.facebook.com',
              path: new URL(url).pathname + new URL(url).search,
              method: 'GET',
              socket,
              agent: false,
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Host': 'www.facebook.com',
              },
            }, (getRes) => {
              const chunks = [];
              getRes.on('data', (chunk) => chunks.push(chunk));
              getRes.on('end', () => resolveFetch(Buffer.concat(chunks).toString()));
            });

            getReq.on('error', rejectFetch);
            getReq.end();
          });

          connectReq.on('error', rejectFetch);
          connectReq.end();
        });
      };

      const fetchTextDirect = (url, redirectCount = 0) => {
        return new Promise((resolveFetch, rejectFetch) => {
          if (redirectCount > 5) { rejectFetch(new Error('Too many redirects')); return; }
          const protocol = url.startsWith('https') ? https : http;
          const req = protocol.get(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              'Accept-Language': 'en-US,en;q=0.9',
              'Cache-Control': 'no-cache',
            },
          }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
              let nextUrl = res.headers.location;
              if (nextUrl.startsWith('/')) {
                const parsed = new URL(url);
                nextUrl = `${parsed.protocol}//${parsed.host}${nextUrl}`;
              }
              res.resume();
              resolveFetch(fetchTextDirect(nextUrl, redirectCount + 1));
              return;
            }
            if (res.statusCode !== 200) { res.resume(); rejectFetch(new Error(`HTTP ${res.statusCode}`)); return; }
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => resolveFetch(Buffer.concat(chunks).toString()));
          });
          req.on('error', rejectFetch);
        });
      };

      const fetchBinary = (url, redirectCount = 0) => {
        return new Promise((resolveFetch, rejectFetch) => {
          if (redirectCount > 5) { rejectFetch(new Error('Too many redirects')); return; }
          const protocol = url.startsWith('https') ? https : http;
          const req = protocol.get(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
              'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
              'Referer': 'https://www.facebook.com/',
              'Cache-Control': 'no-cache',
            },
          }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
              let nextUrl = res.headers.location;
              if (nextUrl.startsWith('/')) {
                const parsed = new URL(url);
                nextUrl = `${parsed.protocol}//${parsed.host}${nextUrl}`;
              }
              res.resume();
              resolveFetch(fetchBinary(nextUrl, redirectCount + 1));
              return;
            }
            if (res.statusCode !== 200) { res.resume(); rejectFetch(new Error(`HTTP ${res.statusCode}`)); return; }
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => resolveFetch({ buffer: Buffer.concat(chunks), contentType: res.headers['content-type'] || 'image/jpeg' }));
          });
          req.on('error', rejectFetch);
        });
      };

      const sendImageFromUrl = async (imageUrl) => {
        const result = await fetchBinary(imageUrl);
        reply.header('Content-Type', result.contentType);
        reply.header('Cache-Control', 'public, max-age=86400');
        reply.header('Access-Control-Allow-Origin', '*');
        reply.send(result.buffer);
        resolve();
      };

      const extractOgImage = (html) => {
        if (!html) return null;
        const patterns = [
          /<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i,
          /<meta\s+content=["']([^"']+)["']\s+property=["']og:image["']/i,
          /<meta\s+name=["']twitter:image["']\s+content=["']([^"']+)["']/i,
          /<meta\s+content=["']([^"']+)["']\s+name=["']twitter:image["']/i,
        ];
        for (const pattern of patterns) {
          const match = html.match(pattern);
          if (match && match[1]) return decodeHtml(match[1]);
        }
        return null;
      };

      const decodeHtml = (str) => {
        return String(str)
          .replace(/&amp;/g, '&')
          .replace(/&quot;/g, '"')
          .replace(/&#x27;/g, "'")
          .replace(/&#x2F;/g, '/');
      };

      const buildFacebookPageUrl = (rawUsername) => {
        const value = String(rawUsername).trim();
        if (/^\d+$/.test(value)) return `https://www.facebook.com/profile.php?id=${value}`;
        return `https://www.facebook.com/${encodeURIComponent(value)}`;
      };

      (async () => {
        const pageUrl = buildFacebookPageUrl(username);

        // Try Bright Data first if available
        if (useBrightData) {
          try {
            console.log('fb-photo: trying Bright Data for', username);
            const html = await fetchTextViaBrightData(pageUrl);
            const ogImage = extractOgImage(html);
            if (ogImage) {
              console.log('fb-photo: Bright Data found image for', username);
              await sendImageFromUrl(ogImage);
              return;
            }
          } catch (err) {
            console.error('fb-photo: Bright Data failed:', err.message);
          }
        }

        // Fall back to direct scrape
        try {
          console.log('fb-photo: trying direct scrape for', username);
          const html = await fetchTextDirect(pageUrl);
          const ogImage = extractOgImage(html);
          if (ogImage) {
            console.log('fb-photo: direct scrape found image for', username);
            await sendImageFromUrl(ogImage);
            return;
          }
        } catch (err) {
          console.error('fb-photo: direct scrape failed:', err.message);
        }

        // Final fallback - Facebook Graph API
        try {
          const graphUrl = `https://graph.facebook.com/${encodeURIComponent(username)}/picture?type=large&redirect=true`;
          console.log('fb-photo: trying graph fallback for', username);
          await sendImageFromUrl(graphUrl);
          return;
        } catch (err) {
          console.error('fb-photo: graph fallback failed:', err.message);
        }

        sendError(404, 'Image not found');
      })();
    });
  });
}

module.exports = proxyRoutes;