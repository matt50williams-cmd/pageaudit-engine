const { runAnalyzer } = require("../services/analyzer");

async function routes(fastify, options) {
  fastify.post("/orders", async (request, reply) => {
    try {
      const order = request.body || {};

      const analyzerResult = await runAnalyzer(order);

      return reply.send({
        success: true,
        message: "Analyzer completed successfully",
        order,
        analysis: analyzerResult.analysis,
        scraper_status: analyzerResult.scraperStatus,
        scraper_error: analyzerResult.scraperError,
        scraper_insights: analyzerResult.scraperInsights,
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