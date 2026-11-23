import { mkdir, chmod } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fetchQuery, ProviderError } from "../lib/collection/provider.ts";
import { configuredPlan } from "../lib/collection/worker.ts";
import type { PageResult } from "../lib/collection/provider.ts";

interface ProbeRow {
  key: string;
  state: string;
  attempts: number;
  retry_at: number;
  error: string | null;
  result: string | null;
  token: string | null;
}
export async function probe(options: {
  resume?: boolean; directory?: string; env?: Record<string,string | undefined>; fetcher?: typeof fetch; now?: Date;
} = {}) {
  const { key, plan } = configuredPlan("probe",options.env,options.now);
  const dir = resolve(options.directory ?? ".outlandish/collection");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const filename = resolve(dir, `probe-${plan.weekStart}.sqlite`);
  const db = new DatabaseSync(filename);
  try {
    await chmod(filename, 0o600);
    db.exec(`PRAGMA busy_timeout=4000;
      CREATE TABLE IF NOT EXISTS run (singleton INTEGER PRIMARY KEY CHECK(singleton=1),id TEXT NOT NULL,budget INTEGER NOT NULL,started TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS attempts (key TEXT PRIMARY KEY,state TEXT NOT NULL,attempts INTEGER NOT NULL,retry_at INTEGER NOT NULL,error TEXT,result TEXT,token TEXT);`);
    db.prepare("INSERT OR IGNORE INTO run VALUES(1,?,?,?)").run(randomUUID(),plan.budget,new Date().toISOString());
    if (options.resume) {
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("UPDATE run SET budget=max(budget,?) WHERE singleton=1").run(plan.budget);
        db.prepare("UPDATE attempts SET state='retry',retry_at=0 WHERE state='failed' AND attempts<3 AND error NOT IN ('rate_limited')").run();
        db.exec("COMMIT");
      } catch (e) { db.exec("ROLLBACK"); throw e; }
    }
    const run = db.prepare("SELECT id,budget,started FROM run").get() as { id: string; budget: number; started: string };
    const output = [];
    let stopReason: string | null = null;
    for (const query of plan.queries) {
      if (stopReason) {
        output.push({ platform: query.platform, kind: query.kind, limit: query.limit, status: "skipped", reason: stopReason, returned: null });
        continue;
      }
      let callToken: string | null = null;
      let skipped: string | null = null;
      db.exec("BEGIN IMMEDIATE");
      try {
        const used = Number(db.prepare("SELECT coalesce(sum(attempts),0) AS n FROM attempts").get()!.n);
        const previous = db.prepare("SELECT * FROM attempts WHERE key=?").get(query.key) as unknown as ProbeRow | undefined;
        const now = Date.now();
        const waiting = db.prepare("SELECT max(retry_at) AS until FROM attempts WHERE error='rate_limited'").get()!.until;
        if (previous?.state === "done" || previous?.state === "failed") skipped = previous.state;
        else if (previous && previous.retry_at > now) skipped = previous.state;
        else if (Number(waiting) > now) skipped = "rate_limited";
        else if (used >= Math.min(plan.budget,run.budget)) skipped = "budget_exhausted";
        else if (previous && previous.attempts >= 3) skipped = "attempts_exhausted";
        else {
          callToken = randomUUID();
          db.prepare(`INSERT INTO attempts VALUES(?, 'running', 1, ?, NULL, NULL, ?)
            ON CONFLICT(key) DO UPDATE SET state='running',attempts=attempts+1,retry_at=excluded.retry_at,token=excluded.token`)
            .run(query.key,now + 90_000,callToken);
        }
        db.exec("COMMIT");
      } catch (e) { db.exec("ROLLBACK"); throw e; }
      if (callToken) {
        try {
          const result = await fetchQuery(query, key, options.fetcher);
          db.prepare("UPDATE attempts SET state='done',retry_at=0,error=NULL,result=?,token=NULL WHERE key=? AND token=?")
            .run(JSON.stringify({ ...result, observedAt: new Date().toISOString() }),query.key,callToken);
        } catch (e) {
          if (!(e instanceof ProviderError)) throw e;
          const tries = Number(db.prepare("SELECT attempts FROM attempts WHERE key=?").get(query.key)?.attempts);
          const next = Math.max(Date.now() + (2 ** tries) * 1000, Date.parse(e.retryAfter ?? "") || 0);
          db.prepare("UPDATE attempts SET state=?,retry_at=?,error=?,token=NULL WHERE key=? AND token=?")
            .run(e.retryable && tries < 3 ? "retry" : "failed",next,e.code,query.key,callToken);
        }
      }
      const row = db.prepare("SELECT * FROM attempts WHERE key=?").get(query.key) as unknown as ProbeRow | undefined;
      const page: (PageResult & {observedAt:string}) | null = row?.result ? JSON.parse(row.result) : null;
      output.push({ platform: query.platform, kind: query.kind, start: query.start, end: query.end, limit: query.limit,
        observedAt: page?.observedAt ?? null, attempts: row?.attempts ?? 0, status: skipped && !["done","failed"].includes(skipped) ? skipped : row?.state,
        reason: row?.error ?? null, nextAttemptAt: row && ["retry","running"].includes(row.state) ? new Date(row.retry_at).toISOString() : null,
        returned: page?.returned ?? null, coverage: page?.coverage ?? null });
      if (query.kind === "workspace" && row?.state !== "done") stopReason = "workspace_blocked";
      if (["invalid_key","provider_quota"].includes(row?.error ?? "")) stopReason = row!.error;
    }
    return { runId: run.id, mode: "live", purpose: "probe", strategy: plan.strategy, startedAt: run.started,
      budget: Math.min(plan.budget,run.budget), requests: Number(db.prepare("SELECT coalesce(sum(attempts),0) AS n FROM attempts").get()!.n),
      evidenceFile: filename, providerCreditCost: null, queries: output };
  } finally { db.close(); }
}
