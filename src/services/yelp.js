const { ApifyClient } = require('apify-client');

async function getYelpData(url) {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) {
    console.error('[YELP] APIFY_API_TOKEN is not set');
    return { ok: false, error: 'APIFY_API_TOKEN missing' };
  }

  console.log(`[YELP] Starting Apify scrape for: ${url}`);
  const client = new ApifyClient({ token });

  try {
    const run = await client.actor('apify/yelp-scraper').call({
      startUrls: [{ url }],
      maxItems: 1,
      includeReviews: true,
      reviewsLimit: 5,
    }, { timeoutSecs: 120 });

    console.log(`[YELP] Apify run finished: runId=${run.id} status=${run.status}`);

    if (run.status !== 'SUCCEEDED') {
      console.error(`[YELP] Apify run failed with status: ${run.status}`);
      return { ok: false, error: `Apify run status: ${run.status}` };
    }

    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    console.log(`[YELP] Apify returned ${items.length} items`);

    if (!items.length) {
      console.log('[YELP] No data returned from Apify');
      return { ok: false, error: 'No data returned' };
    }

    const biz = items[0];

    const name = biz.name || biz.title || null;
    const rating = biz.rating || biz.stars || null;
    const reviewCount = biz.reviewCount || biz.totalReviews || biz.reviews?.length || 0;
    const photos = biz.photoCount || biz.photos?.length || biz.photosCount || 0;
    const categories = biz.categories || biz.category || null;
    const priceRange = biz.priceRange || biz.price || null;
    const isOpen = biz.isOpen ?? biz.openNow ?? null;
    const phone = biz.phone || biz.displayPhone || null;
    const address = biz.address || biz.location || biz.displayAddress || null;

    const recentReviews = (biz.reviews || []).slice(0, 5).map(r => ({
      text: (r.text || r.comment || '').slice(0, 200),
      rating: r.rating || r.stars || null,
      date: r.date || r.time || null,
      author: r.author || r.userName || r.user?.name || null,
    }));

    console.log(`[YELP] Parsed: name=${name} rating=${rating} reviews=${reviewCount} photos=${photos}`);

    return {
      ok: true,
      name,
      rating,
      reviewCount,
      photos,
      categories,
      priceRange,
      isOpen,
      phone,
      address,
      recentReviews,
    };
  } catch (err) {
    console.error(`[YELP] Apify error: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

module.exports = { getYelpData };
