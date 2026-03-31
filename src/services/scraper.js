const http = require('http');
const https = require('https');

function fetchViaProxy(targetUrl, timeout = 20000) {
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
    console.log(`[SCRAPER] Proxy: ${proxyUser}@${BRIGHT_HOST}:${BRIGHT_PORT}`);

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
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      }, (response) => {
        let data = '';
        response.on('data', chunk => { data += chunk; });
        response.on('end', () => resolve({ ok: response.statusCode < 400, html: data }));
      });
      req.on('error', reject);
      req.end();
    });

    connectReq.on('error', reject);
    connectReq.on('timeout', () => { connectReq.destroy(); reject(new Error('Proxy timeout')); });
    connectReq.end();
  });
}

function extractNumber(str) {
  if (!str) return null;
  str = str.replace(/,/g, '');
  const m = str.match(/([\d.]+)\s*([KkMm])?/);
  if (!m) return null;
  let num = parseFloat(m[1]);
  if (m[2] && (m[2] === 'K' || m[2] === 'k')) num *= 1000;
  if (m[2] && (m[2] === 'M' || m[2] === 'm')) num *= 1000000;
  return Math.round(num);
}

function getMeta(html, prop) {
  const m = html.match(new RegExp(`<meta[^>]+property=["']${prop}["'][^>]+content=["']([^"']+)`, 'i'))
    || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${prop}["']`, 'i'));
  return m ? m[1].replace(/&amp;/g, '&') : null;
}

function parsePageFromHtml(html) {
  const pageName = getMeta(html, 'og:title');
  const category = getMeta(html, 'og:description');

  // Extract follower/like count from page HTML
  let followers = null;
  const followerPatterns = [
    /([\d,\.]+[KkMm]?)\s*(?:followers|people follow this)/i,
    /([\d,\.]+[KkMm]?)\s*(?:people like this|likes)/i,
    /"follower_count"\s*:\s*(\d+)/,
    /"followers_count"\s*:\s*(\d+)/,
    /"fan_count"\s*:\s*(\d+)/,
  ];
  for (const pat of followerPatterns) {
    const m = html.match(pat);
    if (m) { followers = extractNumber(m[1]); break; }
  }

  // Extract post content from the page HTML
  // Facebook embeds post text in various JSON structures and HTML elements
  const posts = [];

  // Try to find post text blocks — Facebook renders post content in various ways
  const postTextPatterns = [
    // JSON-embedded post content
    /"message"\s*:\s*\{[^}]*"text"\s*:\s*"([^"]{10,})"/g,
    /"story"\s*:\s*\{[^}]*"message"\s*:\s*\{[^}]*"text"\s*:\s*"([^"]{10,})"/g,
    /"content"\s*:\s*"([^"]{20,})"/g,
  ];

  for (const pattern of postTextPatterns) {
    let match;
    while ((match = pattern.exec(html)) !== null && posts.length < 10) {
      const text = match[1]
        .replace(/\\n/g, '\n')
        .replace(/\\u[\dA-Fa-f]{4}/g, c => String.fromCharCode(parseInt(c.slice(2), 16)))
        .replace(/\\\//g, '/');
      if (text.length > 10 && !posts.some(p => p.content === text)) {
        posts.push({ content: text });
      }
    }
  }

  // Try to extract engagement numbers from post data in JSON
  const likePatterns = [
    /"reaction_count"\s*:\s*\{[^}]*"count"\s*:\s*(\d+)/g,
    /"like_count"\s*:\s*(\d+)/g,
    /"reactions"\s*:\s*\{[^}]*"count"\s*:\s*(\d+)/g,
  ];
  const commentPatterns = [
    /"comment_count"\s*:\s*\{[^}]*"total_count"\s*:\s*(\d+)/g,
    /"comments"\s*:\s*\{[^}]*"total_count"\s*:\s*(\d+)/g,
  ];
  const sharePatterns = [
    /"share_count"\s*:\s*\{[^}]*"count"\s*:\s*(\d+)/g,
    /"reshare_count"\s*:\s*(\d+)/g,
  ];

  const extractCounts = (patterns) => {
    const counts = [];
    for (const pat of patterns) {
      let m;
      while ((m = pat.exec(html)) !== null && counts.length < 10) {
        const n = parseInt(m[1]);
        if (n >= 0) counts.push(n);
      }
    }
    return counts;
  };

  const likeCounts = extractCounts(likePatterns);
  const commentCounts = extractCounts(commentPatterns);
  const shareCounts = extractCounts(sharePatterns);

  // Attach engagement numbers to posts where available
  for (let i = 0; i < posts.length; i++) {
    if (likeCounts[i] !== undefined) posts[i].likes = likeCounts[i];
    if (commentCounts[i] !== undefined) posts[i].num_comments = commentCounts[i];
    if (shareCounts[i] !== undefined) posts[i].num_shares = shareCounts[i];
  }

  // If we found engagement data but no post text, create placeholder posts
  if (posts.length === 0 && likeCounts.length > 0) {
    for (let i = 0; i < likeCounts.length; i++) {
      posts.push({
        likes: likeCounts[i] || 0,
        num_comments: commentCounts[i] || 0,
        num_shares: shareCounts[i] || 0,
      });
    }
  }

  // Attach page-level info to the first post (expected by extractInsights)
  if (posts.length > 0) {
    posts[0].page_name = pageName;
    posts[0].page_followers = followers;
    posts[0].page_category = category;
  }

  return { posts, pageName, followers, category };
}

async function runScraper(pageUrl) {
  const hasCreds = process.env.BRIGHTDATA_USERNAME && process.env.BRIGHTDATA_PASSWORD;

  if (!hasCreds) {
    console.warn('[SCRAPER] Missing BrightData proxy credentials');
    return { ok: false, error: 'Missing BrightData proxy credentials' };
  }

  try {
    console.log('[SCRAPER] Fetching via proxy:', pageUrl);

    const res = await fetchViaProxy(pageUrl, 25000);

    console.log(`[SCRAPER] Response ok=${res.ok}, HTML length=${res.html?.length || 0}`);
    console.log(`[SCRAPER] HTML preview:`, (res.html || '').substring(0, 500));

    if (!res.ok) {
      return { ok: false, error: `Page fetch failed` };
    }

    const parsed = parsePageFromHtml(res.html);
    const { posts, pageName, followers, category } = parsed;
    console.log(`[SCRAPER] Parsed result:`, JSON.stringify({ pageName, followers, category, postCount: posts.length, samplePost: posts[0] || null }, null, 2));

    if (posts.length === 0 && !followers) {
      // Even without posts, return basic page info so the analyzer has something
      return {
        ok: true,
        data: [{
          page_name: pageName,
          page_followers: followers,
          page_category: null,
          content: null,
          likes: 0,
          num_comments: 0,
          num_shares: 0,
        }],
      };
    }

    return { ok: true, data: posts };

  } catch (err) {
    console.error('[SCRAPER] Exception:', err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = { runScraper };
