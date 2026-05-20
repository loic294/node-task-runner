import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import yaml from "js-yaml";
import cron from "node-cron";
import cronParser from "cron-parser";
import { v4 as uuidv4 } from "uuid";

export class TaskEngine {
  constructor(config) {
    this.config = config;
    this.tasks = new Map();
    this.jobs = new Map();
    this.runningCounts = new Map();
    this.stateFile = path.join(this.config.dataDir, "tasks-state.json");
    this.runsDir = path.join(this.config.dataDir, "runs");
    this.discoveryTimer = null;
    this.retentionTimer = null;
  }

  async init() {
    await this.loadState();
    await this.discoverTasks();
    this.discoveryTimer = setInterval(async () => {
      await this.discoverTasks();
    }, this.config.discoveryIntervalMs);
    this.retentionTimer = setInterval(
      async () => {
        await this.cleanupRetention();
      },
      6 * 60 * 60 * 1000,
    );
  }

  async shutdown() {
    if (this.discoveryTimer) {
      clearInterval(this.discoveryTimer);
    }
    if (this.retentionTimer) {
      clearInterval(this.retentionTimer);
    }
    for (const job of this.jobs.values()) {
      job.stop();
    }
  }

  async loadState() {
    try {
      const raw = await fsp.readFile(this.stateFile, "utf8");
      const state = JSON.parse(raw);
      if (Array.isArray(state.tasks)) {
        for (const task of state.tasks) {
          this.tasks.set(task.id, task);
        }
      }
    } catch {
      await this.persistState();
    }
  }

  async persistState() {
    const tasks = [...this.tasks.values()].map((task) => ({ ...task }));
    await fsp.writeFile(
      this.stateFile,
      JSON.stringify({ tasks }, null, 2),
      "utf8",
    );
  }

  async readTaskConfig(taskDir) {
    const configPath = path.join(taskDir, "config.yaml");
    const scriptPath = path.join(taskDir, "task.js");

    const [configExists, scriptExists] = await Promise.all([
      fileExists(configPath),
      fileExists(scriptPath),
    ]);

    if (!configExists || !scriptExists) {
      return null;
    }

    const rawYaml = await fsp.readFile(configPath, "utf8");
    const parsed = yaml.load(rawYaml);

    if (!parsed || typeof parsed !== "object") {
      throw new Error("Invalid YAML object");
    }

    const name = String(parsed.name || "").trim();
    const schedule = String(parsed.schedule || "").trim();

    if (!name) {
      throw new Error("config.yaml missing name");
    }

    if (!schedule || !cron.validate(schedule)) {
      throw new Error("config.yaml has invalid cron schedule");
    }

    return {
      name,
      schedule,
      configPath,
      scriptPath,
    };
  }

  async discoverTasks() {
    const entries = await fsp.readdir(this.config.tasksDir, {
      withFileTypes: true,
    });
    const discovered = new Set();

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const taskId = entry.name;
      const folderPath = path.join(this.config.tasksDir, entry.name);

      try {
        const config = await this.readTaskConfig(folderPath);
        if (!config) {
          continue;
        }

        discovered.add(taskId);

        const existing = this.tasks.get(taskId);
        const next = {
          id: taskId,
          folderPath,
          configPath: config.configPath,
          scriptPath: config.scriptPath,
          name: config.name,
          schedule: config.schedule,
          lastRunAt: existing?.lastRunAt || null,
          lastRunStatus: existing?.lastRunStatus || null,
          lastSuccessfulRun: existing?.lastSuccessfulRun || null,
          lastRunId: existing?.lastRunId || null,
          configError: null,
        };

        this.tasks.set(taskId, next);
        this.syncJob(taskId, next.schedule);
      } catch (error) {
        discovered.add(taskId);
        const existing = this.tasks.get(taskId) || {
          id: taskId,
          folderPath,
          lastRunAt: null,
          lastRunStatus: null,
          lastSuccessfulRun: null,
          lastRunId: null,
        };
        this.tasks.set(taskId, {
          ...existing,
          name: existing.name || taskId,
          schedule: existing.schedule || "",
          configError:
            error instanceof Error ? error.message : "Invalid config",
        });
        this.removeJob(taskId);
      }
    }

    for (const [taskId] of this.tasks.entries()) {
      if (!discovered.has(taskId)) {
        this.tasks.delete(taskId);
        this.removeJob(taskId);
      }
    }

    await this.persistState();
  }

  removeJob(taskId) {
    const existingJob = this.jobs.get(taskId);
    if (existingJob) {
      existingJob.stop();
      this.jobs.delete(taskId);
    }
  }

  syncJob(taskId, schedule) {
    const current = this.jobs.get(taskId);
    if (
      current &&
      current.schedule === schedule &&
      current.timezone === this.config.scheduleTimezone
    ) {
      return;
    }

    this.removeJob(taskId);

    const job = cron.schedule(
      schedule,
      async () => {
        try {
          await this.runTask(taskId, "schedule");
        } catch {}
      },
      {
        timezone: this.config.scheduleTimezone,
      },
    );

    job.schedule = schedule;
    job.timezone = this.config.scheduleTimezone;
    this.jobs.set(taskId, job);
  }

  async updateTask(taskId, payload) {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error("Task not found");
    }

    if (task.configError) {
      throw new Error("Cannot update a task with invalid config");
    }

    const nextName =
      typeof payload.name === "string" ? payload.name.trim() : task.name;
    const nextSchedule =
      typeof payload.schedule === "string"
        ? payload.schedule.trim()
        : task.schedule;

    if (!nextName) {
      throw new Error("Name cannot be empty");
    }

    if (!cron.validate(nextSchedule)) {
      throw new Error("Invalid cron schedule");
    }

    const hasConfigChange =
      task.name !== nextName || task.schedule !== nextSchedule;
    if (!hasConfigChange) {
      return { ...task };
    }

    const previousConfig = {
      name: task.name,
      schedule: task.schedule,
    };

    const data = {
      name: nextName,
      schedule: nextSchedule,
    };

    await fsp.writeFile(task.configPath, yaml.dump(data), "utf8");

    try {
      await this.commitTaskConfigChange(taskId, task.configPath);
    } catch (error) {
      await fsp.writeFile(task.configPath, yaml.dump(previousConfig), "utf8");
      await runCommand("git", [
        "add",
        "--",
        toGitPath(path.relative(process.cwd(), task.configPath)),
      ]);
      throw error;
    }

    task.name = nextName;
    task.schedule = nextSchedule;
    task.configError = null;

    this.syncJob(taskId, nextSchedule);
    await this.persistState();

    return { ...task };
  }

  async commitTaskConfigChange(taskId, configPath) {
    const insideWorkTree = await runCommand("git", [
      "rev-parse",
      "--is-inside-work-tree",
    ]);

    if (!insideWorkTree.ok || insideWorkTree.stdout.trim() !== "true") {
      throw new Error("Config updated but not inside a git repository");
    }

    const relativePath = path.relative(process.cwd(), configPath);
    const gitPath = toGitPath(relativePath);

    const addResult = await runCommand("git", ["add", "--", gitPath]);
    if (!addResult.ok) {
      throw new Error(
        `Config updated but failed to stage file: ${addResult.stderr.trim()}`,
      );
    }

    const stagedDiffResult = await runCommand("git", [
      "diff",
      "--cached",
      "--quiet",
      "--",
      gitPath,
    ]);

    if (stagedDiffResult.code === 0) {
      return;
    }

    if (stagedDiffResult.code !== 1) {
      throw new Error(
        `Config updated but failed to inspect staged diff: ${stagedDiffResult.stderr.trim()}`,
      );
    }

    const commitResult = await runCommand("git", [
      "commit",
      "-m",
      `chore(task): update ${taskId} config`,
      "--",
      gitPath,
    ]);

    if (!commitResult.ok) {
      throw new Error(
        `Config updated but git commit failed: ${commitResult.stderr.trim()}`,
      );
    }
  }

  getTasks() {
    const tasks = [...this.tasks.values()].map((task) => ({
      ...task,
      runningCount: this.runningCounts.get(task.id) || 0,
      nextRunAt: task.configError ? null : this.getNextRunAt(task.schedule),
    }));

    tasks.sort((a, b) => a.id.localeCompare(b.id));
    return tasks;
  }

  getNextRunAt(schedule) {
    if (!schedule || !cron.validate(schedule)) {
      return null;
    }

    try {
      const parser = cronParser.CronExpressionParser || cronParser;
      const interval = parser.parse(schedule, {
        tz: this.config.scheduleTimezone,
      });
      const next = interval.next();
      const nextDate = typeof next.toDate === "function" ? next.toDate() : next;

      if (!(nextDate instanceof Date) || Number.isNaN(nextDate.getTime())) {
        return null;
      }

      return nextDate.toISOString();
    } catch {
      return null;
    }
  }

  async getRuns(taskId) {
    const filePath = path.join(this.runsDir, `${taskId}.json`);
    try {
      const raw = await fsp.readFile(filePath, "utf8");
      const runs = JSON.parse(raw);
      runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
      return runs;
    } catch {
      return [];
    }
  }

  async getRun(taskId, runId) {
    const runs = await this.getRuns(taskId);
    return runs.find((run) => run.id === runId) || null;
  }

  async saveRuns(taskId, runs) {
    const filePath = path.join(this.runsDir, `${taskId}.json`);
    await fsp.writeFile(filePath, JSON.stringify(runs, null, 2), "utf8");
  }

  async appendRun(taskId, run) {
    const runs = await this.getRuns(taskId);
    runs.push(run);
    await this.saveRuns(taskId, runs);
  }

  async updateRun(taskId, runId, patch) {
    const runs = await this.getRuns(taskId);
    const index = runs.findIndex((run) => run.id === runId);
    if (index === -1) {
      return;
    }
    runs[index] = { ...runs[index], ...patch };
    await this.saveRuns(taskId, runs);
  }

  async runTask(taskId, triggeredBy = "manual") {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error("Task not found");
    }

    if (task.configError) {
      throw new Error("Task config is invalid");
    }

    const runId = uuidv4();
    const taskLogDir = path.join(this.config.logsDir, taskId);
    await fsp.mkdir(taskLogDir, { recursive: true });

    const logFile = path.join(taskLogDir, `${runId}.log`);
    const startedAt = new Date().toISOString();

    const run = {
      id: runId,
      taskId,
      status: "running",
      startedAt,
      completedAt: null,
      durationMs: null,
      exitCode: null,
      triggeredBy,
      logFile,
    };

    await this.appendRun(taskId, run);

    const logStream = fs.createWriteStream(logFile, { flags: "a" });
    this.runningCounts.set(taskId, (this.runningCounts.get(taskId) || 0) + 1);

    const child = spawn(process.execPath, [task.scriptPath], {
      cwd: task.folderPath,
      env: {
        ...process.env,
        TASK_ID: taskId,
        RUN_ID: runId,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timeoutMs = Number.parseInt(process.env.TASK_TIMEOUT_MS || "0", 10);
    let didTimeout = false;
    let timeout = null;

    if (timeoutMs > 0) {
      timeout = setTimeout(() => {
        didTimeout = true;
        child.kill("SIGKILL");
      }, timeoutMs);
    }

    child.stdout.on("data", (chunk) => {
      logStream.write(chunk);
    });

    child.stderr.on("data", (chunk) => {
      logStream.write(chunk);
    });

    const finalized = new Promise((resolve) => {
      child.on("close", async (code) => {
        if (timeout) {
          clearTimeout(timeout);
        }

        const completedAt = new Date().toISOString();
        const durationMs =
          new Date(completedAt).getTime() - new Date(startedAt).getTime();
        const status = didTimeout
          ? "timeout"
          : code === 0
            ? "success"
            : "failed";

        this.runningCounts.set(
          taskId,
          Math.max(0, (this.runningCounts.get(taskId) || 1) - 1),
        );

        await this.updateRun(taskId, runId, {
          status,
          completedAt,
          durationMs,
          exitCode: didTimeout ? null : code,
        });

        const liveTask = this.tasks.get(taskId);
        if (liveTask) {
          liveTask.lastRunAt = completedAt;
          liveTask.lastRunStatus = status;
          liveTask.lastRunId = runId;
          if (status === "success") {
            liveTask.lastSuccessfulRun = completedAt;
          }
          await this.persistState();
        }

        logStream.end();
        resolve();
      });
    });

    return {
      runId,
      done: finalized,
    };
  }

  async getRunLog(taskId, runId) {
    const run = await this.getRun(taskId, runId);
    if (!run) {
      return null;
    }

    try {
      const stats = await fsp.stat(run.logFile);
      const start = Math.max(0, stats.size - this.config.maxLogBytes);
      const content = await readSlice(run.logFile, start);
      return {
        run,
        content,
        truncated: start > 0,
      };
    } catch {
      return {
        run,
        content: "",
        truncated: false,
      };
    }
  }

  async cleanupRetention() {
    const threshold =
      Date.now() - this.config.retentionDays * 24 * 60 * 60 * 1000;
    const taskIds = [...this.tasks.keys()];

    for (const taskId of taskIds) {
      const runs = await this.getRuns(taskId);
      const keep = [];

      for (const run of runs) {
        const started = new Date(run.startedAt).getTime();
        if (
          run.status === "running" ||
          Number.isNaN(started) ||
          started >= threshold
        ) {
          keep.push(run);
          continue;
        }

        try {
          await fsp.rm(run.logFile, { force: true });
        } catch {}
      }

      if (keep.length !== runs.length) {
        await this.saveRuns(taskId, keep);
      }
    }
  }
}

async function readSlice(filePath, start) {
  const stream = fs.createReadStream(filePath, { encoding: "utf8", start });
  let output = "";
  for await (const chunk of stream) {
    output += chunk;
  }
  return output;
}

async function fileExists(filePath) {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function toGitPath(filePath) {
  return filePath.split(path.sep).join("/");
}

async function runCommand(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      resolve({
        ok: code === 0,
        code,
        stdout,
        stderr,
      });
    });
  });
}
