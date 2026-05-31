# Node Task Runner

Minimal Dockerized app that discovers Node.js tasks from a mounted volume and runs them on cron schedules.

<img alt="Screenshot of the task runner" src="https://github.com/user-attachments/assets/cbc705e1-2101-4b2e-97dc-0f1be5d00f3b" style="max-width: 100%; height: auto;" />

## Features

- Auto-discovery of task folders from a mounted directory.
- Each task folder must contain task.js and config.yaml.
- Cron-based scheduling using config.yaml.
- Manual Run now from the web interface.
- Edit task name and schedule in the UI, with write-back to config.yaml.
- Run history and per-run log viewing in UI.
- File-based persistence for run metadata and logs.
- GitHub Actions workflow for publishing Docker images to GHCR.

## Task folder contract

Each subfolder inside volumes/tasks represents one task.

Example:

```text
volumes/tasks/example-task/
	config.yaml
	task.js
```

```yaml
# volumes/tasks/example-task/config.yaml
name: Example task
schedule: "*/5 * * * *"
# Optional: re-run the task up to `retries` extra times after a failure,
# waiting `retryDelaySeconds` between attempts.
retries: 0
retryDelaySeconds: 0
```

```js
// volumes/tasks/example-task/task.js
console.log("Task started", new Date().toISOString());
console.log("Task finished");
process.exit(0);
```

Use Node process exit code to report success/failure (0 is success).

## Run locally

1. Install dependencies.

```bash
npm install
```

2. Create your task folders under `volumes/tasks`.

3. Start the app.

```bash
npm start
```

4. Open the UI:

```text
http://localhost:3000
```

### Enable pre-commit version bump

This project bumps `package.json` patch version on every commit via a local Git pre-commit hook.

```bash
npm run setup-hooks
```

## Run with Docker Compose

Pull the published image:

```bash
docker pull ghcr.io/loic294/node-task-runner:latest
```

Create a docker-compose.yml file:

```yaml
services:
	app:
		image: ghcr.io/loic294/node-task-runner:latest
		ports:
			- "3000:3000"
		environment:
			PORT: "3000"
			TASKS_DIR: /app/volumes/tasks
			LOGS_DIR: /app/volumes/logs
			DATA_DIR: /app/volumes/data
			DISCOVERY_INTERVAL_MS: "30000"
			RETENTION_DAYS: "90"
			TASK_TIMEZONE: "America/Los_Angeles"
			MAX_LOG_BYTES: "200000"
			TASK_TIMEOUT_MS: "0"
		volumes:
			- ./volumes/tasks:/app/volumes/tasks
			- ./volumes/logs:/app/volumes/logs
			- ./volumes/data:/app/volumes/data
		restart: unless-stopped
```

Start the stack:

```bash
docker compose up -d
```

Mounted paths:

- volumes/tasks -> /app/volumes/tasks (read-only)
- volumes/logs -> /app/volumes/logs
- volumes/data -> /app/volumes/data
