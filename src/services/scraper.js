const fetch = require("node-fetch");

async function runScraper(pageUrl) {
  if (!pageUrl) {
    return {
      ok: false,
      error: "Missing page URL",
      data: null,
    };
  }

  try {
    const response = await fetch("https://api.brightdata.com/request", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.BRIGHTDATA_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: pageUrl,
        zone: "web_unlocker",
        format: "json",
      }),
    });

    const rawText = await response.text();

    if (!response.ok) {
      return {
        ok: false,
        error: `Bright Data HTTP ${response.status}: ${rawText.slice(0, 300)}`,
        data: null,
      };
    }

    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch (jsonError) {
      return {
        ok: false,
        error: `Bright Data returned non-JSON response: ${rawText.slice(0, 300)}`,
        data: null,
      };
    }

    return {
      ok: true,
      error: null,
      data: Array.isArray(parsed) ? parsed : [parsed],
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message || "Unknown scraper error",
      data: null,
    };
  }
}

module.exports = { runScraper };