# Node Task Runner

Minimal Dockerized app that discovers Node.js tasks from a mounted volume and runs them on cron schedules.

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

volumes/tasks/example-task/config.yaml
volumes/tasks/example-task/task.js

config.yaml

name: Example task
schedule: "_/2 _ \* \* \*"

task.js

console.log("Task started", new Date().toISOString());
console.log("Task finished");

Use Node process exit code to report success/failure (0 is success).

## Run locally

1. Install dependencies.

npm install

2. Create your task folders under volumes/tasks.

3. Start app.

npm start

4. Open:

http://localhost:3000

## Run with Docker Compose

docker compose up --build

Mounted paths:

- volumes/tasks -> /app/volumes/tasks (read-only)
- volumes/logs -> /app/volumes/logs
- volumes/data -> /app/volumes/data

## API summary

- GET /api/tasks
- PUT /api/tasks/:taskId
- POST /api/tasks/:taskId/run
- GET /api/tasks/:taskId/runs
- GET /api/tasks/:taskId/runs/:runId
- GET /api/tasks/:taskId/runs/:runId/logs
- GET /api/health

## Retention

Run metadata and log files older than 90 days are cleaned automatically.

## GHCR publishing

Workflow file: .github/workflows/publish.yml

On pushes to main and version tags, the image is published to:

ghcr.io/<owner>/<repo>

### Auto version tags

The workflow automatically tags images with:

- latest (default branch)
- main (default branch)
- v<package.json version> (for example v0.1.0)
- v<major>.<minor> (for example v0.1)
- v<major> (for example v0)
- git tag ref (when pushing a git tag)
- sha-<commit>

To publish a new semantic version tag series, update version in package.json and push to main.
