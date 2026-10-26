/** Mission dialogs render live adapter data; authorization remains with existing actions. */
function escapeText(value) {
  return String(value ?? "").replace(
    /[&<>"']/gu,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );
}

function selected(value, expected) {
  return value === expected ? " selected" : "";
}

function disabled(pending) {
  return pending ? " disabled" : "";
}

function icon(name) {
  const paths = {
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    flag: '<path d="M5 21V3m0 1h7l2 2h6v9h-6l-2-2H5"/>',
  };
  return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ""}</svg>`;
}

/** Only assigneeHtml is trusted HTML from the authorized named-person/role picker. */
export function renderCoalitionMissionCreateForm({
  draft = {},
  pending = false,
  scopeId = "",
  assigneeHtml = "",
  presets = [],
  formKind = "coalition-missions-create",
  submitLabel = "Create mission",
} = {}) {
  const presetKey = String(draft.presetKey || "general");
  const priority = String(draft.priority || "normal");
  const deadlineMode = String(draft.deadlineMode || "indefinite");
  const timeoutPolicy = String(draft.timeoutPolicy || "escalate");
  const preset = presets.find((item) => item.key === presetKey);
  const presetOptions = presets.length
    ? presets
    : [{ key: "general", label: "General mission", description: "" }];
  const timingIsConfigured =
    deadlineMode !== "indefinite" ||
    Boolean(draft.dueHours) ||
    Boolean(draft.timeoutHours);
  const inherited = Array.isArray(draft.config?.successConditions)
    ? draft.config.successConditions
    : [];
  const checklist =
    typeof draft.presentationChecklist === "string"
      ? draft.presentationChecklist
      : "Confirm the plan\nFinish the work\nShare a short update";
  return `<form class="mission-create-form" data-route-form="${escapeText(formKind)}" aria-busy="${pending}">
    <input type="hidden" name="templateId" value="${escapeText(draft.templateId || "")}" />
    <input type="hidden" name="templateVersion" value="${escapeText(draft.templateVersion || "")}" />
    <input type="hidden" name="scopeType" value="coalition" />
    <input type="hidden" name="scopeId" value="${escapeText(scopeId)}" />
    <input type="hidden" name="assignee" value="${escapeText(draft.assignee || "")}" />
    <input type="hidden" name="targetMode" value="${escapeText(draft.targetMode || "user")}" />
    <input type="hidden" name="presentationOptions" value="1" />
    <input type="hidden" name="presentationConditions" value="${escapeText(JSON.stringify(inherited))}" />
    <div class="dialog-body form-grid">
      <label class="field full-width"><span>Mission title</span><input name="title" value="${escapeText(draft.title || "")}" placeholder="What needs to get done?" maxlength="160"${disabled(pending)} required /></label>
      <label class="field full-width"><span>Objective</span><textarea name="description" rows="3" placeholder="Describe the outcome and any useful context."${disabled(pending)}>${escapeText(draft.description || "")}</textarea></label>
      ${assigneeHtml ? `<div class="full-width mission-create-assignment">${assigneeHtml}</div>` : '<p class="full-width footer-note">No eligible teammates or roles are currently available for assignment.</p>'}
      <label class="field"><span>Due date</span><input type="date" name="presentationDueDate" data-missions-due-date value="${escapeText(draft.presentationDueDate || "")}"${disabled(pending)} /></label>
      <label class="field"><span>Priority</span><select name="priority"${disabled(pending)}>${[
        ["low", "Low"],
        ["normal", "Normal"],
        ["high", "High"],
        ["urgent", "Urgent"],
      ]
        .map(
          ([key, label]) =>
            `<option value="${key}"${selected(priority, key)}>${label}</option>`,
        )
        .join("")}</select></label>
      <label class="field full-width"><span>Mission type</span><select name="presetKey"${disabled(pending)}>${presetOptions
        .map(
          (item) =>
            `<option value="${escapeText(item.key)}"${selected(presetKey, item.key)}>${escapeText(item.label)}</option>`,
        )
        .join("")}</select></label>
      <label class="check-item full-width"><input type="checkbox" name="presentationRequiresReview"${draft.presentationRequiresReview !== false ? " checked" : ""}${disabled(pending)} /><span>Require review before this mission is complete</span></label>
      <details class="advanced-settings full-width" data-mission-disclosure="create-timing"${timingIsConfigured ? " open" : ""}>
        <summary>Checklist & advanced settings</summary>
        <label class="field"><span>Checklist · one step per line</span><textarea name="presentationChecklist" rows="4"${disabled(pending)}>${escapeText(checklist)}</textarea></label>
        ${preset?.description ? `<p class="footer-note">${escapeText(preset.description)}</p>` : ""}
        <div class="form-grid mission-timing-grid">
          <label class="field"><span>Deadline</span><select name="deadlineMode"${disabled(pending)}>
            <option value="indefinite"${selected(deadlineMode, "indefinite")}>No deadline</option>
            <option value="due_at"${selected(deadlineMode, "due_at")}>${draft.presentationDueDate ? "On selected date" : "Due in hours"}</option>
            <option value="duration_after_activation"${selected(deadlineMode, "duration_after_activation")}>Hours after activation</option>
          </select></label>
          <label class="field"><span>Hours until due</span><input name="dueHours" type="number" min="0" step="any" value="${escapeText(draft.dueHours || "")}" placeholder="48"${disabled(pending)} /></label>
          <label class="field"><span>Timeout action</span><select name="timeoutPolicy"${disabled(pending)}>
            <option value="escalate"${selected(timeoutPolicy, "escalate")}>Escalate</option>
            <option value="none"${selected(timeoutPolicy, "none")}>None</option>
            <option value="auto_unassign"${selected(timeoutPolicy, "auto_unassign")}>Auto-unassign</option>
            <option value="auto_fail"${selected(timeoutPolicy, "auto_fail")}>Auto-fail</option>
          </select></label>
          <label class="field"><span>Timeout grace hours</span><input name="timeoutHours" type="number" min="0" step="1" value="${escapeText(draft.timeoutHours || "")}" placeholder="24"${disabled(pending)} /></label>
        </div>
        <p>Follow-up tasks and evidence can be added from the mission details.</p>
      </details>
    </div>
    <footer class="dialog-footer"><button class="secondary-button" type="button" data-action="coalition-missions-ui-close-create"${disabled(pending)}>Cancel</button><button class="primary-button" type="submit"${disabled(pending)}>${escapeText(pending ? "Saving…" : submitLabel)}</button></footer>
  </form>`;
}

function renderTaskList(jobs) {
  if (!jobs.length) {
    return '<p class="footer-note">No tasks are available for this mission.</p>';
  }
  return `<div class="checklist mission-task-list">${jobs
    .map(
      (
        job,
      ) => `<button type="button" class="check-item mission-task-choice${job.done ? " done" : ""}" data-action="coalition-missions-ui-select-job" data-id="${escapeText(job.id)}" aria-pressed="${Boolean(job.selected)}">
      <span class="mission-task-indicator${job.done ? " is-complete" : ""}" aria-hidden="true">${job.done ? icon("check") : ""}</span>
      <span class="mission-task-title">${escapeText(job.title || "Mission task")}</span>
      <small>${escapeText(job.statusLabel || (job.done ? "Complete" : ""))}</small>
    </button>`,
    )
    .join("")}</div>`;
}

/** Text fields are escaped; explicit Html slots come from existing permission-gated adapters. */
export function renderCoalitionMissionDetail(model = {}) {
  const mission = model.mission || {};
  const jobs = Array.isArray(model.jobs) ? model.jobs : [];
  const task = model.selectedJob || null;
  const events = Array.isArray(model.events) ? model.events : [];
  const completed = jobs.filter((job) => job.done).length;
  const priority = String(mission.priority || "normal");
  const priorityLabels = {
    low: "Low priority",
    normal: "Normal priority",
    high: "High priority",
    urgent: "Urgent priority",
  };
  const note =
    task?.note ||
    "Add a short update about what you finished. Include any links or evidence your team needs to review the work.";
  const updateHtml = task?.updateHtml || "";
  const evidenceHtml = `${task?.description && task.description !== mission.description ? `<p>${escapeText(task.description)}</p>` : ""}${task?.guidanceHtml || ""}${task?.artifactHtml || ""}${task?.followUpHtml || ""}${model.supportHtml || model.sourceHtml ? `<div class="note-actions">${model.supportHtml || ""}${model.sourceHtml || ""}</div>` : ""}`;
  return `<header class="dialog-header"><span class="eyebrow">${escapeText(mission.project || "Mission")}</span><button type="button" class="icon-button" data-action="coalition-missions-ui-close-detail" aria-label="Close mission details">${icon("close")}</button></header>
    <div class="dialog-body">
      <h2 id="coalition-mission-detail-title">${escapeText(mission.title || "Mission")}</h2>
      <div class="detail-badges"><span class="status-badge" data-status="${escapeText(mission.status || "active")}">${escapeText(mission.statusLabel || "In progress")}</span><span class="priority-label">${["high", "urgent"].includes(priority) ? icon("flag") : ""}${escapeText(priorityLabels[priority] || "Normal priority")}</span></div>
      ${model.error ? `<div class="note-box danger" role="alert">${escapeText(model.error)}</div>` : ""}
      <div class="detail-meta"><div><span>Assigned to</span>${mission.assigneeHtml || "<strong>Unassigned</strong>"}</div><div><span>Due</span><strong>${escapeText(mission.dueLabel || "No deadline")}</strong></div></div>
      <section class="detail-section"><h3>The objective</h3><p>${escapeText(mission.description || "Review the task details and completion requirements below.")}</p></section>
      <section class="detail-section"><div class="section-heading"><h3>Checklist</h3><span>${completed} of ${jobs.length} complete</span></div>${renderTaskList(jobs)}</section>
      <section class="detail-section mission-task-content"><h3>Notes &amp; evidence</h3><p>${escapeText(note)}</p>${updateHtml}${model.actionDraftHtml || ""}</section>
      <section class="detail-section"><h3>Recent activity</h3>${events.length ? events.map((event) => `<div class="activity-line"><span class="activity-dot"></span><div><p><strong>${escapeText(event.actor || "Team member")}</strong> ${escapeText(event.action || "updated the mission")}</p><small>${escapeText(event.time || "")}</small></div></div>`).join("") : '<p class="footer-note">No activity to show yet.</p>'}</section>
      ${evidenceHtml ? `<details class="advanced-settings mission-evidence-support" data-mission-disclosure="evidence-support"><summary>Evidence &amp; task options</summary><div class="mission-evidence-content">${evidenceHtml}</div></details>` : ""}
      ${model.managerHtml ? `<details class="advanced-settings mission-settings" data-mission-disclosure="settings"><summary>Mission settings</summary>${model.managerHtml}</details>` : ""}
    </div>
    <footer class="dialog-footer">${model.footerHtml || '<span class="footer-note">Select a task to see its available actions.</span>'}</footer>`;
}
