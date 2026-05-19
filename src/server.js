import express from "express";
import path from "node:path";
import { ensureBaseDirs, config } from "./config.js";
import { TaskEngine } from "./services/taskEngine.js";

ensureBaseDirs();

const app = express();
const engine = new TaskEngine(config);

app.use(express.json());
app.use(express.static(path.resolve(process.cwd(), "public")));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/tasks", (_req, res) => {
  res.json({ tasks: engine.getTasks() });
});

app.put("/api/tasks/:taskId", async (req, res) => {
  try {
    const task = await engine.updateTask(req.params.taskId, req.body || {});
    res.json({ task });
  } catch (error) {
    res
      .status(400)
      .json({
        error: error instanceof Error ? error.message : "Invalid request",
      });
  }
});

app.post("/api/tasks/:taskId/run", async (req, res) => {
  try {
    const result = await engine.runTask(req.params.taskId, "manual");
    res.status(202).json({ runId: result.runId });
  } catch (error) {
    res
      .status(400)
      .json({
        error: error instanceof Error ? error.message : "Could not run task",
      });
  }
});

app.get("/api/tasks/:taskId/runs", async (req, res) => {
  const runs = await engine.getRuns(req.params.taskId);
  res.json({ runs });
});

app.get("/api/tasks/:taskId/runs/:runId", async (req, res) => {
  const run = await engine.getRun(req.params.taskId, req.params.runId);
  if (!run) {
    return res.status(404).json({ error: "Run not found" });
  }
  return res.json({ run });
});

app.get("/api/tasks/:taskId/runs/:runId/logs", async (req, res) => {
  const log = await engine.getRunLog(req.params.taskId, req.params.runId);
  if (!log) {
    return res.status(404).json({ error: "Run not found" });
  }
  return res.json(log);
});

app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ error: "Not found" });
  }
  return res.sendFile(path.resolve(process.cwd(), "public", "index.html"));
});

async function start() {
  await engine.init();
  app.listen(config.port, () => {
    console.log(`Task runner listening on http://localhost:${config.port}`);
  });
}

start().catch((error) => {
  console.error("Failed to start server", error);
  process.exit(1);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await engine.shutdown();
    process.exit(0);
  });
}
