function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

    const triggerResponse = await fetch(
      "https://api.brightdata.com/datasets/v3/trigger",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.BRIGHTDATA_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          dataset_id: process.env.BRIGHTDATA_DATASET_ID,
          input: [
            {
              url: pageUrl,
            },
          ],
        }),
      }
    );

    const triggerData = await triggerResponse.json();

    if (!triggerResponse.ok) {
      return {
        ok: false,
        error:
          triggerData?.message ||
          triggerData?.error ||
          "Bright Data trigger failed",
      };
    }

    const snapshotId =
      triggerData?.snapshot_id ||
      triggerData?.snapshotId ||
      null;

    if (!snapshotId) {
      return {
        ok: false,
        error: "Bright Data trigger succeeded but no snapshot_id was returned",
        raw: triggerData,
      };
    }

    const maxAttempts = 12;
    const delayMs = 5000;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const snapshotResponse = await fetch(
        `https://api.brightdata.com/datasets/v3/snapshot/${snapshotId}?format=json`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${process.env.BRIGHTDATA_API_KEY}`,
          },
        }
      );

      if (snapshotResponse.ok) {
        const snapshotData = await snapshotResponse.json();

        if (Array.isArray(snapshotData) && snapshotData.length > 0) {
          return {
            ok: true,
            data: snapshotData,
            snapshotId,
          };
        }

        if (
          snapshotData &&
          typeof snapshotData === "object" &&
          Array.isArray(snapshotData.data) &&
          snapshotData.data.length > 0
        ) {
          return {
            ok: true,
            data: snapshotData.data,
            snapshotId,
          };
        }
      } else {
        const errorText = await snapshotResponse.text();
        console.log(
          `Bright Data snapshot attempt ${attempt} not ready:`,
          snapshotResponse.status,
          errorText
        );
      }

      await sleep(delayMs);
    }

    return {
      ok: false,
      error: "Bright Data snapshot did not return results in time",
      snapshotId,
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message || "Bright Data scraper failed",
    };
  }
}

module.exports = { runScraper };