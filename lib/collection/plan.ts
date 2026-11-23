import { createHash } from "node:crypto";
import { latestCompleteWeek } from "../editorial/analysis.ts";
import { addDays } from "../editorial/batch.ts";
import type { CollectionPlan, PlannedQuery, Purpose } from "./types.ts";

const pacificOffset = new Intl.DateTimeFormat("en", {
  timeZone: "America/Los_Angeles", timeZoneName: "shortOffset",
});
export function pacificMidnight(day: string): number {
  const morning = new Date(day + "T08:00:00Z");
  // At 08:00 UTC Pacific is between midnight and 01:00, before either DST switch.
  const zone = pacificOffset.formatToParts(morning).find(p => p.type === "timeZoneName")?.value;
  if (zone !== "GMT-7" && zone !== "GMT-8") throw new Error("Pacific timezone data unavailable.");
  return Date.parse(day + "T00:00:00Z") + Number(zone.slice(4)) * 3_600_000;
}

export function makePlan(purpose: Purpose, budget: number, pageSize = 10, now = new Date()): CollectionPlan {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new Error("ORIANE_ROWS_PER_SLICE must be an integer between 1 and 100.");
  }
  const total = purpose === "probe" ? 3 : 29;
  if (!Number.isSafeInteger(budget) || budget < 1 || budget > total * 3) {
    throw new Error(`Set the approved ${purpose} request allowance between 1 and ${total * 3}. Each attempted request counts, including retries.`);
  }
  const weekStart = latestCompleteWeek(now);
  const queries: PlannedQuery[] = [];
  function push(query: Omit<PlannedQuery, "key">) {
    const key = createHash("sha256").update(JSON.stringify(query)).digest("hex");
    queries.push({ ...query, key });
  }
  push({ kind: "workspace", method: "GET", day: null, platform: null, start: null, end: null, limit: 0, offset: 0, sort: null });
  for (const weekday of (purpose === "probe" ? [6] : [0, 1, 2, 3, 4, 5, 6])) {
    for (const week of (purpose === "probe" ? [0] : [-7, 0])) {
      const day = addDays(weekStart, week + weekday);
      const start = pacificMidnight(day);
      const stop = pacificMidnight(addDays(day, 1));
      // Sample a different segment of the day each weekday; pair both weeks/platforms identically.
      const division = (weekday * 3) % 8;
      const step = (stop - start) / 8;
      for (const platform of ["tiktok", "instagram"] as const) {
        push({ kind: "search", method: "POST", platform, day, limit: purpose === "probe" ? 1 : pageSize,
          start: new Date(purpose === "probe" ? start : start + step * division).toISOString(),
          end: new Date(purpose === "probe" ? stop : start + step * (division + 1)).toISOString(),
          offset: 0, sort: "publishedAt:desc" });
      }
    }
  }
  return { purpose, budget, weekStart, queries, strategy: purpose === "probe"
    ? "one-full-result-per-platform-v1" : "paired-pacific-weekday-rotating-eighth-one-page-v1" };
}
