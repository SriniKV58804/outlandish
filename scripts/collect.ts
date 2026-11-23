import { advanceDiscovery } from "../lib/collection/worker.ts";
import { rpc } from "../lib/editorial/remote.ts";
import { loadCollection } from "../lib/collection/store.ts";

async function run() {
  const [command, runId] = process.argv.slice(2);
  if (command === "probe") {
    const { probe } = await import("./collect-probe.ts");
    return probe({ resume: runId === "--resume" });
  }
  if (command === "refresh") return advanceDiscovery(runId);
  if (command === "resume" && runId) {
    const budget = Number(process.env.ORIANE_REFRESH_REQUEST_LIMIT);
    if (!Number.isInteger(budget) || budget < 1 || budget > 87) throw new Error("Set the approved ORIANE_REFRESH_REQUEST_LIMIT first.");
    return { resumed: await rpc<boolean>("resume_collection_run", { p_run: runId, p_budget: budget }) };
  }
  if (command === "status" && runId) {
    const { posts: _, ...report } = await loadCollection(runId, false);
    return report;
  }
  throw new Error("Usage: node --env-file-if-exists=.env.local scripts/collect.ts probe | refresh [RUN_ID] | status RUN_ID | resume RUN_ID");
}
run().then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
  console.error(error instanceof Error ? error.message : "Collection failed.");
  process.exitCode = 1;
});
