/** Template presentation preserves the existing save contract and hidden identities. */
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

function configuredValue(draft, config, key, fallback = "") {
  return String(draft[key] ?? config[key] ?? fallback);
}

function templateChecklist(draft, config) {
  if (typeof draft.presentationChecklist === "string")
    return draft.presentationChecklist;
  const conditions = Array.isArray(config.successConditions)
    ? config.successConditions
    : [];
  return conditions
    .filter((condition) =>
      ["checklist", "checklist_completed"].includes(condition?.type),
    )
    .map((condition) => String(condition.label || "").trim())
    .filter(Boolean)
    .join("\n");
}

/** The parent adapter translates presentation fields and performs authorized template writes. */
export function renderCoalitionMissionTemplateForm({
  draft = {},
  pending = false,
  scopeId = "",
  roles = [],
  presets = [],
} = {}) {
  const config =
    draft.config && typeof draft.config === "object" ? draft.config : {};
  const templateId = String(draft.templateId || "");
  const targetMode = configuredValue(draft, config, "targetMode", "role_claim");
  const assignee = String(draft.assignee || "");
  const category = String(
    draft.presentationCategory || config.category || "Field work",
  );
  const categories = [
    { value: "Field work", label: "Field work" },
    { value: "Volunteer experience", label: "Volunteer experience" },
    { value: "Community events", label: "Community events" },
  ];
  if (!categories.some((item) => item.value === category))
    categories.push({
      value: category,
      label: category.replace(/[_-]+/gu, " "),
    });
  const roleOptions = Array.isArray(roles) ? roles : [];
  const presetOptions =
    Array.isArray(presets) && presets.length
      ? presets
      : [{ key: "general", label: "General mission" }];
  const presetKey = configuredValue(draft, config, "presetKey", "general");
  const priority = configuredValue(draft, config, "priority", "normal");
  const deadlineMode = configuredValue(
    draft,
    config,
    "deadlineMode",
    "indefinite",
  );
  const dueHours = configuredValue(draft, config, "dueHours");
  const timeoutPolicy = configuredValue(
    draft,
    config,
    "timeoutPolicy",
    "escalate",
  );
  const timeoutHours = configuredValue(draft, config, "timeoutHours");
  const isRoleTarget = ["role_claim", "role_fanout"].includes(targetMode);
  const retainedRole =
    isRoleTarget &&
    assignee &&
    !roleOptions.some((role) => String(role.value) === assignee);

  return `<form class="mission-template-form" data-route-form="coalition-missions-template-save" aria-busy="${Boolean(pending)}">
    <input type="hidden" name="templateId" value="${escapeText(templateId)}" />
    <input type="hidden" name="templateVersion" value="${escapeText(draft.templateVersion ?? draft.version ?? "")}" />
    <input type="hidden" name="scopeType" value="coalition" />
    <input type="hidden" name="scopeId" value="${escapeText(scopeId)}" />
    <input type="hidden" name="assignee" value="${escapeText(assignee)}" />
    <input type="hidden" name="targetMode" value="${escapeText(targetMode)}" />
    <div class="dialog-body form-grid">
      <label class="field full-width"><span>Template name</span><input name="title" value="${escapeText(draft.title || "")}" placeholder="e.g. Neighborhood outreach shift" maxlength="160"${disabled(pending)} required /></label>
      <label class="field full-width"><span>Objective</span><textarea name="description" rows="3" placeholder="What should this mission achieve?"${disabled(pending)}${templateId ? "" : " required"}>${escapeText(draft.description || "")}</textarea></label>
      <label class="field"><span>Category</span><select name="presentationCategory" data-missions-template-category${disabled(pending)}>${categories
        .map(
          (item) =>
            `<option value="${escapeText(item.value)}"${selected(category, item.value)}>${escapeText(item.label)}</option>`,
        )
        .join("")}</select></label>
      <label class="field"><span>Suggested role</span><select name="presentationRole" data-missions-template-role${disabled(pending)}><option value="">Choose a role</option>${roleOptions
        .map(
          (role) =>
            `<option value="${escapeText(role.value)}"${selected(isRoleTarget ? assignee : "", String(role.value))}>${escapeText(role.label || "Role")}</option>`,
        )
        .join(
          "",
        )}${retainedRole ? `<option value="${escapeText(assignee)}" selected>Selected role</option>` : ""}</select></label>
      <label class="field full-width"><span>Checklist · one step per line</span><textarea name="presentationChecklist" data-missions-template-checklist rows="4" placeholder="Confirm the plan&#10;Complete the work&#10;Share an update"${disabled(pending)}${templateId ? "" : " required"}>${escapeText(templateChecklist(draft, config))}</textarea></label>
      <details class="advanced-settings full-width" data-mission-disclosure="template-settings">
        <summary>Advanced settings</summary>
        <div class="form-grid mission-timing-grid">
          <label class="field full-width"><span>Preset</span><select name="presetKey"${disabled(pending)}>${presetOptions
            .map(
              (preset) =>
                `<option value="${escapeText(preset.key)}"${selected(presetKey, String(preset.key))}>${escapeText(preset.label || "Mission preset")}</option>`,
            )
            .join("")}</select></label>
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
          <label class="field"><span>Deadline</span><select name="deadlineMode"${disabled(pending)}>
            <option value="indefinite"${selected(deadlineMode, "indefinite")}>No deadline</option>
            <option value="due_at"${selected(deadlineMode, "due_at")}>Due in hours</option>
            <option value="duration_after_activation"${selected(deadlineMode, "duration_after_activation")}>Hours after activation</option>
          </select></label>
          <label class="field"><span>Hours until due</span><input name="dueHours" type="number" min="0" step="any" value="${escapeText(dueHours)}" placeholder="48"${disabled(pending)} /></label>
          <label class="field"><span>Timeout action</span><select name="timeoutPolicy"${disabled(pending)}>
            <option value="escalate"${selected(timeoutPolicy, "escalate")}>Escalate</option>
            <option value="none"${selected(timeoutPolicy, "none")}>None</option>
            <option value="auto_unassign"${selected(timeoutPolicy, "auto_unassign")}>Auto-unassign</option>
            <option value="auto_fail"${selected(timeoutPolicy, "auto_fail")}>Auto-fail</option>
          </select></label>
          <label class="field"><span>Timeout grace hours</span><input name="timeoutHours" type="number" min="0" step="1" value="${escapeText(timeoutHours)}" placeholder="24"${disabled(pending)} /></label>
        </div>
      </details>
    </div>
    <footer class="dialog-footer"><button class="secondary-button" type="button" data-action="coalition-missions-ui-close-template"${disabled(pending)}>Cancel</button><button class="primary-button" type="submit"${disabled(pending)}>${pending ? "Saving…" : "Save template"}</button></footer>
  </form>`;
}
