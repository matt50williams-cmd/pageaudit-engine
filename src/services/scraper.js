const axios = require("axios");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchSnapshot(snapshotId) {
  const response = await axios.get(
    `https://api.brightdata.com/datasets/v3/snapshot/${snapshotId}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.BRIGHTDATA_API_KEY}`,
      },
      params: {
        format: "json",
      },
    }
  );

  return response.data;
}

async function runScraper(pageUrl) {
  try {
    if (!pageUrl) {
      return {
        ok: false,
        error: "Missing page URL",
      };
    }

    if (!process.env.BRIGHTDATA_API_KEY) {
      return {
        ok: false,
        error: "Missing BRIGHTDATA_API_KEY environment variable",
      };
    }

    if (!process.env.BRIGHTDATA_DATASET_ID) {
      return {
        ok: false,
        error: "Missing BRIGHTDATA_DATASET_ID environment variable",
      };
    }

    // 1) Trigger dataset run
    const triggerResponse = await axios.post(
      "https://api.brightdata.com/datasets/v3/trigger",
      {
        dataset_id: process.env.BRIGHTDATA_DATASET_ID,
        input: [
          {
            url: pageUrl,
          },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.BRIGHTDATA_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    const snapshotId =
      triggerResponse.data?.snapshot_id ||
      triggerResponse.data?.snapshotId ||
      null;

    if (!snapshotId) {
      return {
        ok: false,
        error: "Bright Data trigger succeeded but no snapshot_id was returned",
        raw: triggerResponse.data,
      };
    }

    // 2) Poll for results
    const maxAttempts = 12;
    const delayMs = 5000;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const results = await fetchSnapshot(snapshotId);

        if (Array.isArray(results) && results.length > 0) {
          return {
            ok: true,
            data: results,
            snapshotId,
          };
        }

        // Sometimes snapshot endpoint returns object wrapper
        if (
          results &&
          typeof results === "object" &&
          Array.isArray(results.data) &&
          results.data.length > 0
        ) {
          return {
            ok: true,
            data: results.data,
            snapshotId,
          };
        }
      } catch (pollError) {
        const status = pollError.response?.status;

        // 202/404/400 can happen while snapshot is still cooking
        if (status && [202, 400, 404].includes(status)) {
          // keep polling
        } else {
          console.error(
            "SCRAPER POLL ERROR:",
            pollError.response?.data || pollError.message
          );
        }
      }

      await sleep(delayMs);
    }

    return {
      ok: false,
      error: "Bright Data snapshot did not return results in time",
      snapshotId,
    };
  } catch (error) {
    console.error("SCRAPER ERROR:", error.response?.data || error.message);

    return {
      ok: false,
      error:
        error.response?.data?.message ||
        error.response?.data?.error ||
        error.message ||
        "Unknown scraper error",
    };
  }
}

module.exports = { runScraper };