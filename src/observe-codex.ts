import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep, basename, dirname } from "node:path";
import { realpath } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { CodexTrajectoryReader } from "./trajectory-reader.ts";
import { TrajectoryStore } from "./trajectory-store.ts";
import { createTrajectoryServer } from "./trajectory-server.ts";

async function physicalPath(path: string): Promise<string> {
  const missing: string[] = []; let ancestor = path;
  for (;;) {
    try { return resolve(await realpath(ancestor), ...missing.slice().reverse()); }
    catch (error) {
      if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") throw error;
      const parent = dirname(ancestor); if (parent === ancestor) throw error;
      missing.push(basename(ancestor)); ancestor = parent;
    }
  }
}

export async function startCodexObservation(env: NodeJS.ProcessEnv = process.env) {
  const portText = env.INLAY_TRAJECTORY_PORT || "8788";
  const maxText = env.INLAY_TRAJECTORY_MAX_BYTES || String(512 * 1024 * 1024);
  const port = Number(portText), maxBytes = Number(maxText);
  if (!/^[1-9][0-9]*$/.test(portText) || !Number.isSafeInteger(port) || port > 65535) throw new Error("Invalid local trajectory port.");
  if (!/^[1-9][0-9]*$/.test(maxText) || !Number.isSafeInteger(maxBytes) || maxBytes < 4096) throw new Error("Invalid trajectory storage limit.");
  const codexHome = env.CODEX_HOME || join(homedir(), ".codex");
  const source = resolve(env.INLAY_CODEX_RECORDS_DIR || join(codexHome, "sessions"));
  const destination = resolve(env.INLAY_TRAJECTORY_DIR || join(homedir(), ".inlay", "trajectories"));
  const inside = (a: string, b: string) => { const r = relative(a,b); return r === "" || (!isAbsolute(r) && r !== ".." && !r.startsWith(".." + sep)); };
  if (inside(source,destination) || inside(destination,source)) throw new Error("Trajectory archive must be separate from source records.");
  const [physicalSource, physicalDestination] = await Promise.all([physicalPath(source), physicalPath(destination)]);
  if (inside(physicalSource,physicalDestination) || inside(physicalDestination,physicalSource)) throw new Error("Trajectory archive must be physically separate from source records.");
  const store = new TrajectoryStore(destination, maxBytes);
  await store.ready;
  const reader = new CodexTrajectoryReader(source, store);
  const server = createTrajectoryServer(store, reader);
  // Error text and paths are deliberately excluded from diagnostics.
  server.on("error", () => { console.error("Inlay trajectory listener unavailable."); process.exitCode = 1; void reader.close().then(() => store.close()); });
  server.listen(port, "127.0.0.1", () => { console.log("Inlay local Codex trajectory observer listening."); });
  process.once("SIGINT", () => server.close()); process.once("SIGTERM", () => server.close());
  return { server, reader, store };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void startCodexObservation().catch(() => { console.error("Inlay trajectory startup unavailable."); process.exitCode = 1; });
}
