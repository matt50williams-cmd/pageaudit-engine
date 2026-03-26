async function runScraper(pageUrl) {
  const apiKey = process.env.BRIGHTDATA_API_KEY;
  const datasetId = process.env.BRIGHTDATA_DATASET_ID;

  if (!apiKey || !datasetId) {
    console.warn('[SCRAPER] Missing BrightData credentials');
    return { ok: false, error: 'Missing BrightData credentials' };
  }

  try {
    console.log('[SCRAPER] Starting scrape for:', pageUrl);

    const triggerRes = await fetch(
      `https://api.brightdata.com/datasets/v3/trigger?dataset_id=${datasetId}&include_errors=true`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify([{ url: pageUrl }]),
      }
    );

    if (!triggerRes.ok) {
      const err = await triggerRes.text();
      return { ok: false, error: `Trigger failed: ${err}` };
    }

    const triggerData = await triggerRes.json();
    const snapshotId = triggerData.snapshot_id;
    if (!snapshotId) return { ok: false, error: 'No snapshot ID returned' };

    console.log('[SCRAPER] Snapshot ID:', snapshotId);

    const maxAttempts = 24;
    const pollInterval = 5000;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));

      const statusRes = await fetch(
        `https://api.brightdata.com/datasets/v3/snapshot/${snapshotId}?format=json`,
        { headers: { Authorization: `Bearer ${apiKey}` } }
      );

      if (!statusRes.ok) continue;

      const contentType = statusRes.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await statusRes.json();
        if (data.status === 'running' || data.status === 'pending') {
          console.log(`[SCRAPER] Still running... attempt ${attempt + 1}`);
          continue;
        }
        if (Array.isArray(data) && data.length > 0) {
          console.log('[SCRAPER] Got results:', data.length, 'items');
          return { ok: true, data };
        }
        if (data.error) return { ok: false, error: data.error };
      }
    }

    return { ok: false, error: 'Scraper timed out after 2 minutes' };

  } catch (err) {
    console.error('[SCRAPER] Exception:', err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = { runScraper };