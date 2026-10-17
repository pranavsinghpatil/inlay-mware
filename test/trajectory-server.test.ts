import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Script } from "node:vm";
import { createServer, get } from "node:http";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { access, symlink } from "node:fs/promises";
import { startCodexObservation } from "../src/observe-codex.ts";
import { createInlayServer } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import test from "node:test";
import { TrajectoryStore } from "../src/trajectory-store.ts";
import { CodexTrajectoryReader, sourcePseudonym } from "../src/trajectory-reader.ts";
import { createTrajectoryServer } from "../src/trajectory-server.ts";
import { TRAJECTORY_JS } from "../src/trajectory-dashboard.ts";

test("trajectory service presents actual structured tool reports and rejects cross-origin or mutation requests", async t => {
  const root = await mkdtemp(join(tmpdir(), "inlay-trajectory-http-"));
  const source = join(root, "source"), destination = join(root, "metadata"); await mkdir(source);
  const name = "rollout-2026-10-17-00000000-0000-4000-8000-000000000001.jsonl";
  const records = [
    { timestamp: "2026-10-17T00:00:00Z", type: "event_msg", payload: { type: "task_started", turn_id: "PRIVATE_TURN" } },
    { type: "turn_context", payload: { turn_id: "PRIVATE_TURN", model: "gpt-6.1-sol", effort: "high", cwd: "PRIVATE_PATH" } },
    { timestamp: "2026-10-17T00:00:01Z", type: "event_msg", payload: { type: "item_completed", turn_id: "PRIVATE_TURN", item: { type: "CommandExecution", id: "PRIVATE_ID", exit_code: 3, status: "failed", command: ["PRIVATE_COMMAND"], aggregated_output: "PRIVATE_OUTPUT", duration: { secs: 1, nanos: 0 } } } },
    { type: "event_msg", payload: { type: "task_complete", turn_id: "PRIVATE_TURN", last_agent_message: "PRIVATE_ANSWER" } },
  ];
  await writeFile(join(source, name), records.map(r=>JSON.stringify(r)).join("\n")+"\n");
  const store = new TrajectoryStore(destination); await store.ready;
  const reader = new CodexTrajectoryReader(source, store); await reader.poll();
  const server = createTrajectoryServer(store, reader); server.listen(0,"127.0.0.1"); await once(server,"listening");
  t.after(async()=>{ await reader.close(); const done=once(server,"close");server.close();server.closeAllConnections();await done;await store.close();await rm(root,{recursive:true,force:true}); });
  const address=server.address();assert(address&&typeof address!=="string");const base="http://127.0.0.1:"+address.port;
  const response=await fetch(base+"/data"); assert.equal(response.status,200);
  const d=await response.json();assert.equal(d.totals.reportedFailure,1);assert.equal(d.totals.turns,1);assert.equal(d.totals.reportedSuccess,0);
  assert.equal(d.sessions[0].taskVerification,"unavailable");assert.equal(d.coverage.proxyExchangeJoin,"unavailable");
  assert.equal((await (await fetch(base+"/data?model=gpt-6.1-sol&outcome=failure")).json()).sessions.length,1);
  assert.equal((await (await fetch(base+"/data?model=other")).json()).sessions.length,0);
  const events=await (await fetch(base+"/events?session="+sourcePseudonym(name))).json();assert.equal(events.rows.length,4);assert.equal(events.rows.at(-1).outcome,"unknown");
  assert(!JSON.stringify([d,events]).includes("PRIVATE_"));
  const foreignHeaders: Record<string,string>[] = [{Origin:"https://example.com"},{"Sec-Fetch-Site":"cross-site"}];
  for(const headers of foreignHeaders)assert.equal((await fetch(base+"/data",{headers})).status,403,JSON.stringify(headers));
  const foreignHost = await new Promise<number|undefined>((resolve,reject)=>{get(base+"/data",{headers:{Host:"example.com"}},r=>{r.resume();resolve(r.statusCode);}).on("error",reject);});
  assert.equal(foreignHost,403);
  assert.equal((await fetch(base+"/data",{method:"POST"})).status,405);
  assert.equal((await fetch(base+"/events?session=../secret")).status,400);
  assert.equal((await fetch(base+"/data?after=-1")).status,400);
  assert.equal((await fetch(base+"/source")).status,404);
  const html=await fetch(base+"/");assert.match(await html.text(),/Agent trajectories/);assert.match(html.headers.get("content-security-policy")!,/script-src 'self'/);
  assert.equal(html.headers.get("access-control-allow-origin"),null);
  new Script(TRAJECTORY_JS);
});

test("dashboard trajectory navigation is local-only and leaves proxy endpoints available", async t => {
  const server=createInlayServer(loadConfig({}));server.listen(0,"127.0.0.1");await once(server,"listening");
  t.after(async()=>{const done=once(server,"close");server.close();server.closeAllConnections();await done;});
  const address=server.address();assert(address&&typeof address!=="string");const base="http://127.0.0.1:"+address.port;
  const r=await fetch(base+"/trajectories",{redirect:"manual"});assert.equal(r.status,302);assert.equal(r.headers.get("location"),"http://127.0.0.1:8788/");
  assert.equal((await fetch(base+"/trajectories",{headers:{Origin:"https://example.com"},redirect:"manual"})).status,403);
  assert.equal((await fetch(base+"/health")).status,200);assert.equal((await fetch(base+"/metrics")).status,200);
});

test("observer CLI exits unsuccessfully on a bound port and releases its own archive lock", async t => {
  const root=await mkdtemp(join(tmpdir(),"inlay-trajectory-bind-"));const source=join(root,"source"),archive=join(root,"archive");await mkdir(source);
  const occupied=createServer();occupied.listen(0,"127.0.0.1");await once(occupied,"listening");
  t.after(async()=>{const done=once(occupied,"close");occupied.close();await done;await rm(root,{recursive:true,force:true});});
  const address=occupied.address();assert(address&&typeof address!=="string");
  const result=await new Promise<{code:number|string|null,stderr:string}>((resolve)=>{
    execFile(process.execPath,["--experimental-strip-types",fileURLToPath(new URL("../src/observe-codex.ts",import.meta.url))],{timeout:10000,env:{...process.env,INLAY_CODEX_RECORDS_DIR:source,INLAY_TRAJECTORY_DIR:archive,INLAY_TRAJECTORY_PORT:String(address.port)}},(error,_stdout,stderr)=>resolve({code:error?.code??null,stderr}));
  });
  assert.equal(result.code,1);assert.match(result.stderr,/listener unavailable/);
  await assert.rejects(access(join(archive,"observer.lock")));
});

test("rejects physical source/archive overlap through a parent junction before creating archive data", async t => {
  const root=await mkdtemp(join(tmpdir(),"inlay-trajectory-overlap-")),source=join(root,"source"),alias=join(root,"alias");await mkdir(source);
  t.after(async()=>{await rm(root,{recursive:true,force:true});});
  try { await symlink(source,alias,process.platform==="win32"?"junction":"dir"); }
  catch { t.skip("This environment cannot create the source-alias fixture.");return; }
  await assert.rejects(startCodexObservation({INLAY_CODEX_RECORDS_DIR:source,INLAY_TRAJECTORY_DIR:join(alias,"metadata")}),/physically separate/);
  await assert.rejects(access(join(source,"metadata")));
});
