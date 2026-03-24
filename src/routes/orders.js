const { runAnalyzer } = require("../services/analyzer");
const { runWriter } = require("../services/writer");

async function routes(fastify, options) {
  fastify.post("/orders", async (request, reply) => {
    try {
      const order = request.body || {};

      const analyzerResult = await runAnalyzer(order);
      const writerResult = await runWriter(order, analyzerResult.analysis);

      return reply.send({
        success: true,
        message: "Audit completed successfully",
        order,
        analysis: analyzerResult.analysis,
        report: writerResult.reportText,
        report_text: writerResult.reportText,
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
