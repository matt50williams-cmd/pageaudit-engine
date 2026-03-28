const https = require('https');

async function proxyRoutes(fastify) {
  fastify.get('/api/fb-photo/:username', async (request, reply) => {
    const { username } = request.params;
    const url = `https://graph.facebook.com/${encodeURIComponent(username)}/picture?type=large&redirect=true`;

    return new Promise((resolve) => {
      const handleResponse = (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          https.get(res.headers.location, handleResponse).on('error', () => {
            reply.status(404).send({ error: 'Image not found' });
            resolve();
          });
        } else {
          reply.header('Content-Type', res.headers['content-type'] || 'image/jpeg');
          reply.header('Cache-Control', 'public, max-age=3600');
          reply.header('Access-Control-Allow-Origin', '*');
          res.pipe(reply.raw);
          resolve();
        }
      };
      https.get(url, handleResponse).on('error', () => {
        reply.status(404).send({ error: 'Image not found' });
        resolve();
      });
    });
  });
}

module.exports = proxyRoutes;