const { analyzeOrder } = require("../services/analyzer");

async function routes(fastify, options) {
  fastify.post("/orders", async (request, reply) => {
    try {
      const order = request.body || {};

      const analysis = await analyzeOrder(order);

      const result = {
        ...order,
        report: analysis.reportText,
        report_text: analysis.reportText,
        scores: analysis.scores,
        scraper_status: analysis.scraperStatus,
        scraper_error: analysis.scraperError,
        scraper_insights: analysis.scraperInsights,
      };

      if (analysis.scraperStatus === "failed") {
        fastify.log.error(`SCRAPER FAILED: ${analysis.scraperError}`);
      }

      return reply.send({
        success: true,
        message: "Order processed successfully",
        order: result,
        report: analysis.reportText,
        report_text: analysis.reportText,
        scores: analysis.scores,
        scraper_status: analysis.scraperStatus,
        scraper_error: analysis.scraperError,
        scraper_insights: analysis.scraperInsights,
      });
    } catch (error) {
      fastify.log.error(error);

      return reply.status(500).send({
        success: false,
        error: error.message || "Server error",
      });
    }
  });
}

module.exports = routes;