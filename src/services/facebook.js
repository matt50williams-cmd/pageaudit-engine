const { ApifyClient } = require('apify-client');

async function getFacebookData(url) {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) {
    console.error('[FACEBOOK] APIFY_API_TOKEN is not set');
    return { ok: false, error: 'APIFY_API_TOKEN missing' };
  }

  console.log(`[FACEBOOK] Starting Apify scrape for: ${url}`);
  const client = new ApifyClient({ token });

  try {
    const run = await client.actor('apify/facebook-pages-scraper').call({
      startUrls: [{ url }],
      maxPosts: 3,
    }, { timeoutSecs: 120 });

    console.log(`[FACEBOOK] Apify run finished: runId=${run.id} status=${run.status}`);

    if (run.status !== 'SUCCEEDED') {
      console.error(`[FACEBOOK] Apify run failed with status: ${run.status}`);
      return { ok: false, error: `Apify run status: ${run.status}` };
    }

    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    console.log(`[FACEBOOK] Apify returned ${items.length} items`);

    if (!items.length) {
      console.log('[FACEBOOK] No data returned from Apify');
      return { ok: false, error: 'No data returned' };
    }

    const page = items[0];
    const posts = items
      .filter(item => item.type === 'post' || item.postText || item.likesCount != null)
      .slice(0, 3)
      .map(p => ({
        text: p.postText || p.text || null,
        likes: p.likesCount || p.likes || 0,
        comments: p.commentsCount || p.comments || 0,
        shares: p.sharesCount || p.shares || 0,
        date: p.date || p.time || null,
      }));

    const name = page.name || page.title || page.pageName || null;
    const followers = page.followers || page.followersCount || page.likes || null;
    const likes = page.likes || page.likesCount || page.pageFollowers || null;
    const description = page.about || page.description || page.categories || null;

    console.log(`[FACEBOOK] Parsed: name=${name} followers=${followers} likes=${likes} posts=${posts.length}`);

    return { ok: true, name, followers, likes, description, posts };
  } catch (err) {
    console.error(`[FACEBOOK] Apify error: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

module.exports = { getFacebookData };
