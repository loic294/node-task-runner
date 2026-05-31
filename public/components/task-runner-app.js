class TaskRunnerApp extends HTMLElement {
  connectedCallback() {
    this.runMonitorTimer = null;
    this.liveTraceTimer = null;
    this.state = {
      tasks: [],
      loading: false,
      error: "",
      route: this.parseRoute(),
      message: "",
      editing: {},
      liveTrace: {
        enabled: false,
        taskId: null,
        runId: null,
        autoScroll: true,
      },
    };

    window.addEventListener("hashchange", () => {
      this.state.route = this.parseRoute();
      if (
        this.state.route.name !== "run" ||
        this.state.route.taskId !== this.state.liveTrace.taskId ||
        this.state.route.runId !== this.state.liveTrace.runId
      ) {
        this.stopLiveTrace();
      }
      this.render();
    });

    this.render();
    this.refresh();
  }

  disconnectedCallback() {
    if (this.runMonitorTimer) {
      clearInterval(this.runMonitorTimer);
      this.runMonitorTimer = null;
    }

    this.stopLiveTrace();
  }

  parseRoute() {
    const hash = window.location.hash.replace(/^#/, "") || "/";
    const parts = hash.split("/").filter(Boolean);

    if (parts[0] === "tasks" && parts[2] === "runs" && parts[3]) {
      return { name: "run", taskId: parts[1], runId: parts[3] };
    }

    if (parts[0] === "tasks" && parts[1] && parts[2] === "runs") {
      return { name: "runs", taskId: parts[1] };
    }

    return { name: "tasks" };
  }

  setState(patch) {
    this.state = { ...this.state, ...patch };
  }

  updateFeedback() {
    const loadingEl = this.querySelector("#loadingNotice");
    const errorEl = this.querySelector("#errorNotice");
    const toastEl = this.querySelector("#toastNotice");
    const toastTextEl = this.querySelector("#toastText");

    if (!loadingEl || !errorEl || !toastEl || !toastTextEl) {
      this.render();
      return;
    }

    loadingEl.textContent = this.state.loading ? "Loading..." : "";
    loadingEl.classList.toggle("hidden", !this.state.loading);

    errorEl.textContent = this.state.error || "";
    errorEl.classList.toggle("hidden", !this.state.error);

    const hasMessage = Boolean(this.state.message);
    toastTextEl.textContent = this.state.message || "";
    toastEl.classList.toggle("hidden", !hasMessage);
  }

  getPageTitle() {
    const route = this.state.route;
    if (route.name === "runs") {
      return "Task Runs";
    }
    if (route.name === "run") {
      return "Run Details";
    }
    return "Tasks";
  }

  renderNavbar() {
    const route = this.state.route;
    let actions = "";
    let leftBack = "";

    if (route.name === "tasks") {
      actions = `<button id="refreshTasks">${renderIcon("refresh")}<span>Refresh</span></button>`;
    } else if (route.name === "runs") {
      leftBack = `<a class="button-link nav-back" href="#/" aria-label="Back to tasks" title="Back to tasks">${renderIcon("arrow-left")}</a>`;
      actions = "";
    } else {
      leftBack = `<a class="button-link nav-back" href="#/tasks/${route.taskId}/runs" aria-label="Back to runs" title="Back to runs">${renderIcon("arrow-left")}</a>`;
      actions = `
        <button id="refreshRun">${renderIcon("refresh")}<span>Refresh logs</span></button>
      `;
    }

    return `
      <nav class="top-nav">
        <div class="top-nav-inner">
          <div class="nav-left">
            <div class="nav-left-top">
              ${leftBack}
              <h1>Node Task Runner</h1>
            </div>
          </div>
          <div class="nav-right">${actions}</div>
        </div>
      </nav>
    `;
  }

  async refresh(options = {}) {
    const background = Boolean(options.background);

    if (!background) {
      this.setState({ loading: true, error: "" });
      this.updateFeedback();
    }

    try {
      const response = await fetch("/api/tasks");
      const payload = await response.json();
      this.setState({ tasks: payload.tasks || [], loading: false });

      const hasRunningTasks = (payload.tasks || []).some(
        (task) => Number(task.runningCount || 0) > 0,
      );

      if (this.runMonitorTimer && !hasRunningTasks) {
        this.stopRunMonitor();
      }

      if (
        this.state.route.name === "tasks" &&
        this.querySelector("#taskCards")
      ) {
        this.updateTasksList();
        this.updateFeedback();
      } else if (!background) {
        this.render();
      }
    } catch {
      this.setState({ loading: false, error: "Could not load tasks" });
      this.updateFeedback();
    }
  }

  startRunMonitor() {
    if (this.runMonitorTimer) {
      return;
    }

    this.runMonitorTimer = setInterval(() => {
      this.refresh({ background: true });
    }, 2000);
  }

  stopRunMonitor() {
    if (!this.runMonitorTimer) {
      return;
    }

    clearInterval(this.runMonitorTimer);
    this.runMonitorTimer = null;
  }

  startLiveTrace(taskId, runId) {
    if (
      this.state.liveTrace.enabled &&
      this.state.liveTrace.taskId === taskId &&
      this.state.liveTrace.runId === runId
    ) {
      return;
    }

    this.stopLiveTrace();

    this.setState({
      liveTrace: {
        enabled: true,
        taskId,
        runId,
        autoScroll: true,
      },
    });

    this.liveTraceTimer = setInterval(async () => {
      await this.refreshRunDetail(taskId, runId, { background: true });
    }, 2000);

    this.updateLiveTraceButton();
    this.updateAutoScrollButton();
  }

  stopLiveTrace() {
    if (this.liveTraceTimer) {
      clearInterval(this.liveTraceTimer);
      this.liveTraceTimer = null;
    }

    if (this.state.liveTrace.enabled) {
      this.setState({
        liveTrace: {
          enabled: false,
          taskId: null,
          runId: null,
        },
      });
      this.updateLiveTraceButton();
      this.updateAutoScrollButton();
    }
  }

  updateLiveTraceButton() {
    const button = this.querySelector("#liveTraceToggle");
    if (!button) {
      return;
    }

    if (this.state.liveTrace.enabled) {
      button.innerHTML = `${renderIcon("pause")}<span>Stop live trace</span>`;
      return;
    }

    button.innerHTML = `${renderIcon("activity")}<span>Start live trace</span>`;
  }

  updateAutoScrollButton() {
    const button = this.querySelector("#autoScrollToggle");
    if (!button) {
      return;
    }

    button.textContent = this.state.liveTrace.autoScroll
      ? "Disable auto-scroll"
      : "Enable auto-scroll";
  }

  scrollRunLogToBottom() {
    const logContainer = this.querySelector(".run-detail-logs");
    if (!logContainer) {
      return;
    }

    logContainer.scrollTop = logContainer.scrollHeight;
  }

  async fetchRunDetail(taskId, runId) {
    const logResp = await fetch(`/api/tasks/${taskId}/runs/${runId}/logs`);
    const payload = await logResp.json();
    if (!logResp.ok) {
      throw new Error(payload.error || "Run not found");
    }
    return payload;
  }

  async refreshRunDetail(taskId, runId, options = {}) {
    try {
      const payload = await this.fetchRunDetail(taskId, runId);
      const run = payload.run;

      if (
        run.status === "running" &&
        !(
          this.state.liveTrace.enabled &&
          this.state.liveTrace.taskId === taskId &&
          this.state.liveTrace.runId === runId
        )
      ) {
        this.startLiveTrace(taskId, runId);
      }

      const statusEl = this.querySelector("#runStatus");
      const startedEl = this.querySelector("#runStarted");
      const completedEl = this.querySelector("#runCompleted");
      const triggerEl = this.querySelector("#runTrigger");
      const logEl = this.querySelector("#runLog");
      const tailNoticeEl = this.querySelector("#runTailNotice");
      const traceToggle = this.querySelector("#liveTraceToggle");

      if (
        !statusEl ||
        !startedEl ||
        !completedEl ||
        !triggerEl ||
        !logEl ||
        !tailNoticeEl
      ) {
        if (!options.background) {
          await this.render();
        }
        return;
      }

      statusEl.innerHTML = `<span class="badge ${run.status}">${run.status}</span>`;
      startedEl.textContent = this.formatDate(run.startedAt);
      completedEl.textContent = this.formatDate(run.completedAt);
      triggerEl.textContent = run.triggeredBy || "-";
      logEl.textContent = payload.content || "";

      tailNoticeEl.textContent = payload.truncated
        ? "Showing tail of log file."
        : "";
      tailNoticeEl.classList.toggle("hidden", !payload.truncated);

      if (traceToggle) {
        const isRunning = run.status === "running";
        traceToggle.classList.toggle("hidden", !isRunning);
      }

      const autoScrollToggle = this.querySelector("#autoScrollToggle");
      if (autoScrollToggle) {
        autoScrollToggle.classList.toggle("hidden", run.status !== "running");
        this.updateAutoScrollButton();
      }

      if (run.status !== "running") {
        this.stopLiveTrace();
      } else if (
        this.state.liveTrace.enabled &&
        this.state.liveTrace.taskId === taskId &&
        this.state.liveTrace.runId === runId &&
        this.state.liveTrace.autoScroll
      ) {
        this.scrollRunLogToBottom();
      }
    } catch (error) {
      if (!options.background) {
        this.setState({ error: error.message || "Could not load run logs" });
        this.updateFeedback();
      }
      this.stopLiveTrace();
    }
  }

  async runNow(taskId, button) {
    button.disabled = true;
    this.setState({ message: "" });
    this.updateFeedback();

    try {
      const response = await fetch(`/api/tasks/${taskId}/run`, {
        method: "POST",
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Could not run task");
      }

      this.setState({ message: `Task started. Run id: ${payload.runId}` });
      this.updateFeedback();
      this.startRunMonitor();
      await this.refresh();
    } catch (error) {
      this.setState({ error: error.message || "Could not run task" });
      this.updateFeedback();
    } finally {
      button.disabled = false;
    }
  }

  async saveTask(taskId, card) {
    const nameInput = card.querySelector('[name="name"]');
    const scheduleInput = card.querySelector('[name="schedule"]');
    const retriesInput = card.querySelector('[name="retries"]');
    const retryDelayInput = card.querySelector('[name="retryDelaySeconds"]');
    const button = card.querySelector("button.save");

    button.disabled = true;
    this.setState({ message: "", error: "" });
    this.updateFeedback();

    try {
      const response = await fetch(`/api/tasks/${taskId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: nameInput.value,
          schedule: scheduleInput.value,
          retries: retriesInput ? Number(retriesInput.value) : undefined,
          retryDelaySeconds: retryDelayInput
            ? Number(retryDelayInput.value)
            : undefined,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Save failed");
      }

      this.setState({
        message: "Task updated",
        editing: { ...this.state.editing, [taskId]: false },
      });
      this.updateFeedback();
      await this.refresh();
    } catch (error) {
      this.setState({ error: error.message || "Save failed" });
      this.updateFeedback();
    } finally {
      button.disabled = false;
    }
  }

  statusBadge(task) {
    if (task.runningCount > 0) {
      return '<span class="badge running">running</span>';
    }

    const status = task.lastRunStatus || "idle";
    const hasHistoryPopover = ["success", "failed", "timeout"].includes(status);

    if (!hasHistoryPopover) {
      return `<span class="badge ${status}">${status}</span>`;
    }

    const lastSuccess = escapeHtml(this.formatDate(task.lastSuccessfulRun));
    const lastRun = escapeHtml(this.formatDate(task.lastRunAt));

    return `
      <span class="status-with-popover">
        <span class="badge ${status}">${status}</span>
        <span class="status-popover" role="tooltip">
          <strong>Last success:</strong> ${lastSuccess}<br />
          <strong>Last run:</strong> ${lastRun}
        </span>
      </span>
    `;
  }

  formatDate(value) {
    if (!value) {
      return "-";
    }
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) {
      return "-";
    }
    return d.toLocaleString();
  }

  formatNextRun(value) {
    if (!value) {
      return "-";
    }

    const target = new Date(value);
    if (Number.isNaN(target.getTime())) {
      return "-";
    }

    const now = new Date();
    const diffMs = target.getTime() - now.getTime();
    const absMs = Math.abs(diffMs);
    const minuteMs = 60 * 1000;
    const hourMs = 60 * minuteMs;
    const dayMs = 24 * hourMs;
    let unit = "minute";
    let amount = Math.round(diffMs / minuteMs);

    if (absMs >= dayMs) {
      unit = "day";
      amount = Math.round(diffMs / dayMs);
    } else if (absMs >= hourMs) {
      unit = "hour";
      amount = Math.round(diffMs / hourMs);
    }

    const formatter = new Intl.RelativeTimeFormat(undefined, {
      numeric: "auto",
    });
    return formatter.format(amount, unit);
  }

  toggleEdit(taskId) {
    this.setState({
      editing: {
        ...this.state.editing,
        [taskId]: !this.state.editing[taskId],
      },
    });

    if (this.state.route.name === "tasks") {
      this.updateTasksList();
    }
  }

  renderTaskCard(task) {
    const isEditing = Boolean(this.state.editing[task.id]);

    if (task.configError) {
      return `
        <article class="card" data-task-id="${task.id}">
          <div class="card-head">
            <h3>${task.id}</h3>
          </div>
          <p class="error">${task.configError}</p>
          <p class="meta">Fix ${task.id}/config.yaml to enable scheduling.</p>
        </article>
      `;
    }

    if (isEditing) {
      return `
        <article class="card" data-task-id="${task.id}">
          <div class="card-head">
            <h3>${task.name}</h3>
            <button class="edit-toggle" type="button">${renderIcon("x")}<span>Close</span></button>
          </div>
          <div class="edit-panel open">
            <label class="meta">Name</label>
            <input name="name" value="${escapeHtml(task.name)}" />
            <label class="meta">Cron schedule</label>
            <input name="schedule" value="${escapeHtml(task.schedule)}" />
            <label class="meta">Retries on failure</label>
            <input name="retries" type="number" min="0" step="1" value="${Number(task.retries) || 0}" />
            <label class="meta">Retry delay (seconds)</label>
            <input name="retryDelaySeconds" type="number" min="0" step="1" value="${Number(task.retryDelaySeconds) || 0}" />
            <button class="save primary" type="button">${renderIcon("save")}<span>Save</span></button>
          </div>
        </article>
      `;
    }

    const retries = Number(task.retries) || 0;
    const retryDelay = Number(task.retryDelaySeconds) || 0;
    const retryMeta =
      retries > 0
        ? `<p class="meta"><b>Retries:</b> ${retries} (every ${retryDelay}s)</p>`
        : "";

    return `
      <article class="card" data-task-id="${task.id}">
        <div class="card-head">
          <h3>${task.name}</h3>
          <button class="edit-toggle" type="button">${renderIcon("edit")}<span>Edit</span></button>
        </div>
        <p class="meta"><b>Folder:</b> ${task.id}</p>
        <p class="meta"><b>Status:</b> ${this.statusBadge(task)}</p>
        <p class="meta"><b>Next run:</b> ${this.formatNextRun(task.nextRunAt)}</p>
        ${retryMeta}
        <div class="card-actions">
          <button class="primary run">${renderIcon("play")}<span>Run now</span></button>
          <a class="button-link action-link" href="#/tasks/${task.id}/runs">${renderIcon("list")}<span>View runs</span></a>
        </div>
      </article>
    `;
  }

  renderTasks() {
    const cards = this.state.tasks
      .map((task) => this.renderTaskCard(task))
      .join("");

    return `
      <section id="taskCards" class="card-grid">
        ${cards || '<p class="notice">No tasks discovered yet.</p>'}
      </section>
    `;
  }

  updateTasksList() {
    const taskCards = this.querySelector("#taskCards");
    if (!taskCards) {
      this.render();
      return;
    }

    const cards = this.state.tasks
      .map((task) => this.renderTaskCard(task))
      .join("");

    taskCards.innerHTML =
      cards || '<p class="notice">No tasks discovered yet.</p>';
    this.bindCardEvents();
  }

  async renderRunsView(taskId) {
    try {
      const [tasksResp, runsResp] = await Promise.all([
        fetch("/api/tasks"),
        fetch(`/api/tasks/${taskId}/runs`),
      ]);
      const tasksPayload = await tasksResp.json();
      const runsPayload = await runsResp.json();
      const task = (tasksPayload.tasks || []).find((t) => t.id === taskId);

      if (!task) {
        return `
          <article class="card runs-page-card">
            <h2>Task not found</h2>
            <p><a class="button-link" href="#/">${renderIcon("arrow-left")}<span>Back to tasks</span></a></p>
          </article>
        `;
      }

      const rows = (runsPayload.runs || [])
        .map(
          (run) => `
            <tr class="run-row" data-href="#/tasks/${taskId}/runs/${run.id}">
              <td>${run.id.slice(0, 8)}</td>
              <td>${run.status}</td>
              <td>${this.formatDate(run.startedAt)}</td>
              <td>${run.durationMs ?? "-"}</td>
              <td>${run.triggeredBy}${run.maxAttempts > 1 ? ` (${run.attempt || 1}/${run.maxAttempts})` : ""}</td>
            </tr>
          `,
        )
        .join("");

      return `
        <article class="card runs-page-card">
          <h2>${escapeHtml(task.name)} runs</h2>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Status</th>
                  <th>Started</th>
                  <th>Duration (ms)</th>
                  <th>Trigger</th>
                </tr>
              </thead>
              <tbody>
                ${rows || '<tr><td colspan="5">No runs yet</td></tr>'}
              </tbody>
            </table>
          </div>
        </article>
      `;
    } catch {
      return `
        <article class="card runs-page-card">
          <h2>Run history</h2>
          <p class="error">Could not load run history.</p>
          <p><a class="button-link" href="#/">${renderIcon("arrow-left")}<span>Back to tasks</span></a></p>
        </article>
      `;
    }
  }

  async renderRunDetailView(taskId, runId) {
    try {
      const payload = await this.fetchRunDetail(taskId, runId);

      const run = payload.run;
      if (
        run.status === "running" &&
        !(
          this.state.liveTrace.enabled &&
          this.state.liveTrace.taskId === taskId &&
          this.state.liveTrace.runId === runId
        )
      ) {
        this.startLiveTrace(taskId, runId);
      }

      const isRunning = run.status === "running";
      return `
        <article class="card run-detail-card">
          <section class="run-detail-top">
            <div class="run-detail-head">
              <h2>Run ${run.id}</h2>
              ${
                isRunning
                  ? `<div class="run-detail-controls">
                      <button id="liveTraceToggle" type="button">${
                        this.state.liveTrace.enabled &&
                        this.state.liveTrace.taskId === taskId &&
                        this.state.liveTrace.runId === runId
                          ? `${renderIcon("pause")}<span>Stop live trace</span>`
                          : `${renderIcon("activity")}<span>Start live trace</span>`
                      }</button>
                      <button id="autoScrollToggle" type="button">${
                        this.state.liveTrace.autoScroll
                          ? "Disable auto-scroll"
                          : "Enable auto-scroll"
                      }</button>
                    </div>`
                  : ""
              }
            </div>
            <p class="meta">Task: <strong>${escapeHtml(run.taskId || taskId)}</strong></p>
            <p class="meta">Status: <span id="runStatus"><span class="badge ${run.status}">${run.status}</span></span></p>
            <p class="meta">Started: <span id="runStarted">${this.formatDate(run.startedAt)}</span></p>
            <p class="meta">Completed: <span id="runCompleted">${this.formatDate(run.completedAt)}</span></p>
            <p class="meta">Trigger: <span id="runTrigger">${run.triggeredBy}${run.maxAttempts > 1 ? ` (attempt ${run.attempt || 1} of ${run.maxAttempts})` : ""}</span></p>
          </section>
          <section class="run-detail-logs">
            <pre id="runLog">${escapeHtml(payload.content || "")}</pre>
            <p id="runTailNotice" class="notice ${payload.truncated ? "" : "hidden"}">${
              payload.truncated ? "Showing tail of log file." : ""
            }</p>
          </section>
        </article>
      `;
    } catch (error) {
      return `
        <article class="card runs-page-card">
          <h2>Run details</h2>
          <p class="error">${error.message || "Could not load run logs"}</p>
          <p><a class="button-link" href="#/tasks/${taskId}/runs">${renderIcon("arrow-left")}<span>Back to runs</span></a></p>
        </article>
      `;
    }
  }

  async render() {
    const route = this.state.route;
    let body = "";

    if (route.name === "runs") {
      body = await this.renderRunsView(route.taskId);
    } else if (route.name === "run") {
      body = await this.renderRunDetailView(route.taskId, route.runId);
    } else {
      body = this.renderTasks();
    }

    const mainClass = route.name === "run" ? "main-run-detail" : "";

    this.innerHTML = `
      ${this.renderNavbar()}
      <main class="${mainClass}">
        ${body}
        <p id="loadingNotice" class="notice ${this.state.loading ? "" : "hidden"}">${
          this.state.loading ? "Loading..." : ""
        }</p>
        <p id="errorNotice" class="error ${this.state.error ? "" : "hidden"}">${
          this.state.error ? escapeHtml(this.state.error) : ""
        }</p>
      </main>
      <div id="toastNotice" class="toast ${this.state.message ? "" : "hidden"}" role="status" aria-live="polite">
        <p id="toastText" class="toast-text">${
          this.state.message ? escapeHtml(this.state.message) : ""
        }</p>
        <button id="toastDismiss" class="toast-dismiss" type="button" aria-label="Dismiss notification">
          ${renderIcon("x")}
        </button>
      </div>
    `;

    this.bindEvents();
    this.updateFeedback();

    if (
      route.name === "run" &&
      this.state.liveTrace.enabled &&
      this.state.liveTrace.taskId === route.taskId &&
      this.state.liveTrace.runId === route.runId &&
      this.state.liveTrace.autoScroll
    ) {
      this.scrollRunLogToBottom();
    }
  }

  bindEvents() {
    const refresh = this.querySelector("#refreshTasks");
    if (refresh) {
      refresh.addEventListener("click", () => this.refresh());
    }

    const toastDismiss = this.querySelector("#toastDismiss");
    if (toastDismiss) {
      toastDismiss.onclick = () => {
        this.setState({ message: "" });
        this.updateFeedback();
      };
    }

    this.bindCardEvents();

    const refreshRun = this.querySelector("#refreshRun");
    if (refreshRun) {
      refreshRun.onclick = async () => {
        if (this.state.route.name !== "run") {
          return;
        }
        await this.refreshRunDetail(
          this.state.route.taskId,
          this.state.route.runId,
        );
      };
    }

    const liveTraceToggle = this.querySelector("#liveTraceToggle");
    if (liveTraceToggle) {
      liveTraceToggle.onclick = async () => {
        const route = this.state.route;
        if (route.name !== "run") {
          return;
        }

        if (
          this.state.liveTrace.enabled &&
          this.state.liveTrace.taskId === route.taskId &&
          this.state.liveTrace.runId === route.runId
        ) {
          this.stopLiveTrace();
          return;
        }

        this.startLiveTrace(route.taskId, route.runId);
        await this.refreshRunDetail(route.taskId, route.runId, {
          background: true,
        });
      };
    }

    const autoScrollToggle = this.querySelector("#autoScrollToggle");
    if (autoScrollToggle) {
      autoScrollToggle.onclick = () => {
        const route = this.state.route;
        if (route.name !== "run") {
          return;
        }

        const autoScrollEnabled = !this.state.liveTrace.autoScroll;
        this.setState({
          liveTrace: {
            ...this.state.liveTrace,
            autoScroll: autoScrollEnabled,
          },
        });
        this.updateAutoScrollButton();

        if (autoScrollEnabled) {
          this.scrollRunLogToBottom();
        }
      };
    }

    this.bindRunRowEvents();
  }

  bindRunRowEvents() {
    for (const row of this.querySelectorAll("tr.run-row[data-href]")) {
      row.onclick = () => {
        const href = row.getAttribute("data-href");
        if (href) {
          window.location.hash = href;
        }
      };
    }
  }

  bindCardEvents() {
    for (const card of this.querySelectorAll(".card[data-task-id]")) {
      const taskId = card.getAttribute("data-task-id");
      const runButton = card.querySelector("button.run");
      const saveButton = card.querySelector("button.save");
      const editButton = card.querySelector("button.edit-toggle");

      if (runButton) {
        runButton.onclick = () => this.runNow(taskId, runButton);
      }
      if (saveButton) {
        saveButton.onclick = () => this.saveTask(taskId, card);
      }
      if (editButton) {
        editButton.onclick = () => this.toggleEdit(taskId);
      }
    }
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

customElements.define("task-runner-app", TaskRunnerApp);

function renderIcon(name) {
  const icons = {
    refresh:
      '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.13-3.36L23 10M1 14l5.36 4.36A9 9 0 0 0 20.49 15"></path></svg>',
    "arrow-left":
      '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>',
    edit: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>',
    x: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>',
    save: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>',
    play: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>',
    pause:
      '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>',
    activity:
      '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>',
    list: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>',
  };

  return icons[name] || "";
}
