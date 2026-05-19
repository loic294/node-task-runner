import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();

function resolveDir(value, fallback) {
  return path.resolve(value || fallback);
}

export const config = {
  port: Number.parseInt(process.env.PORT || "3000", 10),
  tasksDir: resolveDir(
    process.env.TASKS_DIR,
    path.join(rootDir, "volumes", "tasks"),
  ),
  logsDir: resolveDir(
    process.env.LOGS_DIR,
    path.join(rootDir, "volumes", "logs"),
  ),
  dataDir: resolveDir(
    process.env.DATA_DIR,
    path.join(rootDir, "volumes", "data"),
  ),
  discoveryIntervalMs: Number.parseInt(
    process.env.DISCOVERY_INTERVAL_MS || "30000",
    10,
  ),
  retentionDays: Number.parseInt(process.env.RETENTION_DAYS || "90", 10),
  maxLogBytes: Number.parseInt(process.env.MAX_LOG_BYTES || "200000", 10),
};

export function ensureBaseDirs() {
  fs.mkdirSync(config.tasksDir, { recursive: true });
  fs.mkdirSync(config.logsDir, { recursive: true });
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(path.join(config.dataDir, "runs"), { recursive: true });
}
