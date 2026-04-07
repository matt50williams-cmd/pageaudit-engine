const { ApifyClient } = require('apify-client');
const { queryOne } = require('../db');

// ── Take a single screenshot via Apify ──
async function takeScreenshot(url) {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) return { ok: false, error: 'APIFY_API_TOKEN missing' };

  const client = new ApifyClient({ token });

  try {
    console.log(`[SNAPSHOT] Capturing: ${url}`);
    const run = await client.actor('apify/screenshot-url').call(
      { url, waitUntil: 'networkidle2', delay: 2000, width: 1280, height: 900 },
      { timeoutSecs: 60 }
    );

    if (run.status !== 'SUCCEEDED') {
      console.error(`[SNAPSHOT] Run failed: ${run.status} for ${url}`);
      return { ok: false, error: `Actor run status: ${run.status}` };
    }

    const storeId = run.defaultKeyValueStoreId;
    if (!storeId) {
      console.error(`[SNAPSHOT] No KV store returned for ${url}`);
      return { ok: false, error: 'No key-value store in run result' };
    }

    // Public URL for the screenshot image — no auth required to view
    const imageUrl = `https://api.apify.com/v2/key-value-stores/${storeId}/records/OUTPUT`;
    console.log(`[SNAPSHOT] OK: ${url} → ${imageUrl}`);
    return { ok: true, imageUrl };
  } catch (err) {
    console.error(`[SNAPSHOT] Error for ${url}: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

// ── Capture snapshots for all confirmed pages ──
async function captureSnapshots({ websiteUrl, facebookUrl, yelpUrl }) {
  console.log(`[SNAPSHOT] ═══ Starting captures: website=${websiteUrl ? 'YES' : 'NO'} facebook=${facebookUrl ? 'YES' : 'NO'} yelp=${yelpUrl ? 'YES' : 'NO'} ═══`);
  const t0 = Date.now();

  const [website, facebook, yelp] = await Promise.all([
    websiteUrl ? takeScreenshot(websiteUrl) : Promise.resolve({ ok: false, error: 'No URL' }),
    facebookUrl ? takeScreenshot(facebookUrl) : Promise.resolve({ ok: false, error: 'No URL' }),
    yelpUrl ? takeScreenshot(yelpUrl) : Promise.resolve({ ok: false, error: 'No URL' }),
  ]);

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[SNAPSHOT] ═══ Done in ${elapsed}s. website=${website.ok} facebook=${facebook.ok} yelp=${yelp.ok} ═══`);

  return { website, facebook, yelp };
}

// ── Save snapshot URLs to audit record ──
async function saveSnapshotsToAudit(auditId, snapshots) {
  const websiteUrl = snapshots.website?.ok ? snapshots.website.imageUrl : null;
  const facebookUrl = snapshots.facebook?.ok ? snapshots.facebook.imageUrl : null;
  const yelpUrl = snapshots.yelp?.ok ? snapshots.yelp.imageUrl : null;

  await queryOne(
    `UPDATE audits SET
      website_snapshot_url = COALESCE($1, website_snapshot_url),
      facebook_snapshot_url = COALESCE($2, facebook_snapshot_url),
      yelp_snapshot_url = COALESCE($3, yelp_snapshot_url),
      snapshot_captured_at = NOW(),
      updated_at = NOW()
    WHERE id = $4`,
    [websiteUrl, facebookUrl, yelpUrl, auditId]
  );

  console.log(`[SNAPSHOT] Saved to audit ${auditId}: website=${!!websiteUrl} facebook=${!!facebookUrl} yelp=${!!yelpUrl}`);
}

module.exports = { captureSnapshots, saveSnapshotsToAudit };
