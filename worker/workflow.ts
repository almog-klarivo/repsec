import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { runEngine } from "../collectors/run";
import { snapshotPosture } from "../collectors/posture";

type Params = { brandId: string; runId: string };

export class BrandRunWorkflow extends WorkflowEntrypoint<Cloudflare.Env, Params> {
  async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
    const brandId = event.payload.brandId;
    const runId = event.payload.runId;

    await step.do("search", { retries: { limit: 2, delay: "20 seconds" } }, async () => {
      const result = await runEngine(this.env, brandId, "search", runId);
      return { runId: result.runId, coverage: JSON.stringify(result.coverage) };
    });
    await step.do("ai", { retries: { limit: 2, delay: "20 seconds" } }, async () => {
      const result = await runEngine(this.env, brandId, "ai", runId);
      return { runId: result.runId, coverage: JSON.stringify(result.coverage) };
    });
    await step.do("impersonation", { retries: { limit: 2, delay: "20 seconds" } }, async () => {
      const result = await runEngine(this.env, brandId, "impersonation", runId);
      return { runId: result.runId, coverage: JSON.stringify(result.coverage) };
    });
    await step.do("classify", { retries: { limit: 2, delay: "10 seconds" } }, async () => {
      const result = await runEngine(this.env, brandId, "classify", runId);
      return { runId: result.runId, coverage: JSON.stringify(result.coverage) };
    });
    await step.do("posture", async () => {
      const scores = await snapshotPosture(this.env, brandId);
      return {
        open_threat_count: scores.open_threat_count,
        serp_control: scores.serp_control,
        ai_accuracy: scores.ai_accuracy,
      };
    });
  }
}
