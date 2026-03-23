async function scrapeFacebookPage(pageUrl) {
  try {
    const response = await fetch(
      `https://api.apify.com/v2/acts/apify~facebook-pages-scraper/run-sync-get-dataset-items?token=${process.env.APIFY_API_TOKEN}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startUrls: [{ url: pageUrl }],
          maxPosts: 10
        })
      }
    );

    if (!response.ok) {
      throw new Error(`Apify request failed with status ${response.status}`);
    }

    const data = await response.json();

    if (!data || data.length === 0) {
      return getFallbackData(pageUrl);
    }

    const page = data[0];
    const posts = page.posts || [];

    return {
      scrape_success: true,
      page_url: pageUrl,
      page_name: page.title || 'Unknown',
      followers: page.likes || page.followers || 0,
      page_created_year: page.foundedDate || 'Unknown',
      bio: page.description || '',
      category: page.categories?.[0] || 'Unknown',
      recent_posts: posts.slice(0, 10).map((post) => ({
        date: post.time || '',
        text: post.text || '',
        type: post.type || 'text',
        reactions: post.likes || 0,
        comments: post.comments || 0,
        shares: post.shares || 0
      })),
      posting_summary: {
        posts_analyzed: posts.length,
        average_days_between_posts: calculateAvgDays(posts),
        most_active_period: 'Recent',
        least_active_period: 'Unknown'
      }
    };
  } catch (error) {
    console.error('Scraper error:', error.message);
    return getFallbackData(pageUrl);
  }
}

function calculateAvgDays(posts) {
  if (!posts || posts.length < 2) return 0;

  const dates = posts
    .map((p) => new Date(p.time))
    .filter((d) => !isNaN(d.getTime()))
    .sort((a, b) => b - a);

  if (dates.length < 2) return 0;

  let totalDays = 0;
  for (let i = 0; i < dates.length - 1; i++) {
    const diffMs = Math.abs(dates[i] - dates[i + 1]);
    totalDays += diffMs / (1000 * 60 * 60 * 24);
  }

  return Math.round(totalDays / (dates.length - 1));
}

function getFallbackData(pageUrl) {
  return {
    scrape_success: false,
    page_url: pageUrl,
    page_name: 'Unknown',
    followers: 0,
    page_created_year: 'Unknown',
    bio: '',
    category: 'Unknown',
    recent_posts: [],
    posting_summary: {
      posts_analyzed: 0,
      average_days_between_posts: 0,
      most_active_period: 'Unknown',
      least_active_period: 'Unknown'
    }
  };
}

module.exports = { scrapeFacebookPage };