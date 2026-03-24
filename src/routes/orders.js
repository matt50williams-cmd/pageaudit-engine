const { analyzeOrder } = require("../services/analyzer");

async function routes(fastify, options) {
  fastify.post("/orders", async (request, reply) => {
    try {
      const order = request.body;

      // 🧠 RUN FULL ANALYSIS (AI + Scraper)
      const analysis = await analyzeOrder(order);

      // You can later save this to DB if needed
      const result = {
        ...order,
        report: analysis.reportText,
        scores: analysis.scores,
        scraper_status: analysis.scraperStatus,
        scraper_error: analysis.scraperError,
      };

      // 🔥 LOG SCRAPER FAILURE (for now this is your "dashboard")
      if (analysis.scraperStatus === "failed") {
        fastify.log.error("🚨 SCRAPER FAILED:", analysis.scraperError);
      }

      return reply.send({
        success: true,
        message: "Order processed successfully",
        order: result,
        report: analysis.reportText,
        scores: analysis.scores,
        scraper_status: analysis.scraperStatus,
        scraper_error: analysis.scraperError,
      });
    } catch (error) {
      fastify.log.error("Order error:", error);

      return reply.status(500).send({
        success: false,
        error: error.message || "Server error",
      });
    }
  });
}

module.exports = routes;