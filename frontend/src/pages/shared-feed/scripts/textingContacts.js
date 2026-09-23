import {
  escapeText as e,
  label,
  count,
  id,
  list,
  button,
  go,
  head,
  stat,
  field,
  select,
  notice,
  details,
  reasons,
  uuid,
} from "./textingWorkspaceUi";

const purposes = [
  ["unreviewed", "Not reviewed"],
  ["manual_sms", "Permitted for manual texting"],
  ["sms_with_opt_in", "Only with recorded opt-in"],
  ["not_for_sms", "Not permitted for texting"],
];
const columns = [
  ["phone", "Mobile phone"],
  ["firstName", "First name"],
  ["lastName", "Last name"],
  ["fullName", "Full name"],
  ["sourceId", "Voter / source ID"],
  ["consentStatus", "Consent status"],
];
const bytes = (n) =>
  Number.isSafeInteger(n) ? `${(n / 1048576).toFixed(1)} MB` : "—";
const sourceFields = (source = {}) =>
  `${field("sourceName", "List source", source.name || "", { required: true, extra: 'placeholder="L2, VAN, state voter file…"' })}${field("namespace", "Source namespace", source.namespace || "", { required: true, extra: 'placeholder="Provider + state + export year"' })}${select("purpose", "Permitted use", purposes, source.permittedPurpose || "unreviewed")}`;
const sourceOf = (data) => ({
  name: String(data.get("sourceName") || "").trim(),
  namespace: String(data.get("namespace") || "").trim(),
  permittedPurpose: data.get("purpose"),
  ...(data.get("van") === "on" ? { exportContext: "ngpvan_sms_canvass" } : {}),
});

/** Direct multipart upload: signed S3 destinations only, no account headers/cookies, no redirects. */
export async function uploadContactFile({
  file,
  job,
  api,
  guard,
  progress,
  signal,
  transport = fetch,
}) {
  const size = job.upload?.partSizeBytes;
  if (
    size !== 8388608 ||
    file.name !== job.file?.fileName ||
    file.size !== job.file?.sizeBytes ||
    Math.ceil(file.size / size) !== job.upload.totalParts
  )
    throw new Error("Choose the original file with the same name and size.");
  for (
    let offset = 0, partNumber = 1;
    offset < file.size;
    offset += size, partNumber++
  ) {
    guard();
    const partBytes = await file
      .slice(offset, Math.min(offset + size, file.size))
      .arrayBuffer();
    guard();
    const digest = new Uint8Array(
      await crypto.subtle.digest("SHA-256", partBytes),
    );
    const checksum = btoa(String.fromCharCode(...digest));
    const result = await api(`/imports/${id(job.importId)}/parts`, {
      parts: [{ partNumber, sha256Base64: checksum }],
    });
    const upload = result.upload,
      part = upload?.parts?.[0];
    if (
      upload?.importId !== job.importId ||
      upload.parts.length !== 1 ||
      part?.partNumber !== partNumber ||
      part.sizeBytes !== partBytes.byteLength ||
      (part.sha256Base64 != null && part.sha256Base64 !== checksum) ||
      (part.uploaded === true && part.sha256Base64 !== checksum)
    )
      throw new Error(
        "The file does not match its saved upload. Choose the original file.",
      );
    if (part.uploaded !== true) {
      const url = new URL(part.url),
        headers = part.headers || {},
        names = Object.keys(headers);
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        (url.port && url.port !== "443") ||
        !/^[a-z0-9][a-z0-9.-]+\.s3\.[a-z0-9-]+\.amazonaws\.com$/.test(
          url.hostname,
        ) ||
        part.method !== "PUT" ||
        names.some((k) =>
          ["authorization", "cookie", "host"].includes(k.toLowerCase()),
        ) ||
        names.filter((k) => k.toLowerCase() === "x-amz-checksum-sha256")
          .length !== 1 ||
        headers[
          names.find((k) => k.toLowerCase() === "x-amz-checksum-sha256")
        ] !== checksum
      )
        throw new Error("The signed upload destination could not be verified.");
      guard();
      const response = await transport(url.href, {
        method: "PUT",
        headers,
        body: partBytes,
        credentials: "omit",
        redirect: "error",
        signal,
      });
      if (!response.ok)
        throw new Error(
          "Upload interrupted. Select the original file to resume its verified parts.",
        );
    }
    guard();
    progress(offset + partBytes.byteLength);
  }
}

export function createContacts(r) {
  const state = () => (r.view().contacts ||= {});
  async function load(resource) {
    const s = state();
    if (resource && resource !== "new") {
      s.job = (await r.api(`/imports/${id(resource)}`)).import;
      s.mapping = structuredClone(s.job.mapping || {});
      s.preview = null;
      s.reviewed = false;
      if (s.job.audienceId && r.can("canPrepareProviderAudience"))
        s.transfer = (
          await r.api(`/audiences/${id(s.job.audienceId)}/provider-sync`)
        ).transfer;
    } else if (resource !== "new") {
      const result = await r.api("/imports");
      s.imports = list(result.imports);
      s.cursor = result.nextCursor;
    }
  }
  function mappingForm(s) {
    const map = s.mapping,
      options = [["", "Not mapped"], ...list(map.headers).map((v) => [v, v])];
    return `<form data-workspace-form="mapping" class="pt-card"><div class="pt-eyebrow">STEP 2 OF 3</div><h2>Match your columns</h2><p class="pt-muted">Pick the mobile number column. Map other fields you want to keep.</p><div class="pt-fields">${columns.map(([key, title]) => select(`column_${key}`, title, options, map.fields?.[key] || "", key === "phone")).join("")}</div>${details(
      "Source and consent",
      `<div class="pt-fields">${sourceFields(map.source)}${select(
        "defaultCountryCode",
        "Unprefixed US numbers",
        [
          ["1", "Treat as US (+1)"],
          ["", "Require country code"],
        ],
        map.defaultCountryCode === null ? "" : map.defaultCountryCode || "1",
      )}</div><label class="pt-workspace-check"><input name="van" type="checkbox"${map.source?.exportContext === "ngpvan_sms_canvass" ? " checked" : ""}>VAN SMS canvass export</label><p class="pt-muted">Map exact consent values below. Blank or unrecognized values stay unknown.</p><div class="pt-fields">${field(
        "consentIn",
        "Opted-in values (comma separated)",
        Object.entries(map.consentValues || {})
          .filter(([, v]) => v === "opted_in")
          .map(([k]) => k)
          .join(","),
      )}${field(
        "consentOut",
        "Opted-out values (comma separated)",
        Object.entries(map.consentValues || {})
          .filter(([, v]) => v === "opted_out")
          .map(([k]) => k)
          .join(","),
      )}</div>`,
    )}${map.sampleCsvText ? details("See source sample", `<pre class="pt-workspace-sample">${e(map.sampleCsvText.slice(0, 1800))}</pre>`) : ""}<div class="pt-actions"><button class="pt-btn" type="submit"${r.busy() ? " disabled" : ""}>Preview mapping</button></div></form>${s.preview ? preview(s) : ""}`;
  }
  function preview(s) {
    const p = s.preview;
    return `<section class="pt-card"><div class="pt-eyebrow">SAMPLE REVIEW</div><h2>Check before importing</h2><div class="pt-grid pt-grid--three">${stat("Sample records", count(p.totalRows))}${stat("Valid phones", count(p.counts?.validPhones))}${stat("Opted out", count(p.counts?.optedOut))}</div><div class="pt-workspace-table-wrap"><table class="pt-workspace-table"><thead><tr><th>Row</th><th>Phone</th><th>Consent</th><th>Result</th></tr></thead><tbody>${list(
      p.rows,
    )
      .slice(0, 12)
      .map(
        (row) =>
          `<tr><td>${e(row.recordNumber)}</td><td>${e(row.phone || "No phone")}</td><td>${e(label(row.consentStatus))}</td><td>${e(label(row.disposition))}</td></tr>`,
      )
      .join(
        "",
      )}</tbody></table></div><p class="pt-muted">This is a sample. Full-file validation and duplicate checks follow.</p><label class="pt-workspace-check"><input type="checkbox" data-workspace-change="mapping-reviewed"${s.reviewed ? " checked" : ""}>I reviewed the columns and this list’s permitted use.</label>${button("mapping-save", "Import contacts", { disabled: !s.reviewed || r.busy() })}</section>`;
  }
  function render() {
    const s = state(),
      resource = r.context().resourceId;
    if (!r.can("uploadImports"))
      return (
        head("CONTACTS", "Contacts") +
        notice(
          "Contact access is restricted",
          "An organization administrator can manage contact lists.",
        )
      );
    if (resource === "new")
      return (
        head(
          "CONTACTS",
          "Add your people",
          "Upload a list. Review it before use.",
          go("contacts", "Back", "", true),
        ) +
        `<form class="pt-card pt-workspace-narrow" data-workspace-form="upload"><div class="pt-workspace-upload"><span class="pt-eyebrow">CSV · TSV · DELIMITED TEXT</span><h2>Choose a contact file</h2><label class="pt-field"><span>Contact file</span><input type="file" accept=".csv,.tsv,.txt" data-workspace-change="contact-file"></label><p class="pt-muted">${s.file ? e(s.file.name) + " · " : ""}Up to ${count(r.workspace().limits?.maxImportRows)} rows · ${bytes(r.workspace().limits?.maxUploadBytes)}</p></div><div class="pt-fields">${sourceFields(s.source)}${select(
          "format",
          "File format",
          [
            ["csv", "Comma separated (.csv)"],
            ["tsv", "Tab separated (.tsv)"],
            ["pipe", "Pipe separated"],
          ],
          s.format || "csv",
        )}${select(
          "encoding",
          "Text encoding",
          [
            ["utf-8", "UTF-8"],
            ["utf-16le", "UTF-16 LE"],
            ["utf-16be", "UTF-16 BE"],
            ["windows-1252", "Windows-1252"],
          ],
          s.encoding || "utf-8",
        )}</div><label class="pt-workspace-check"><input name="van" type="checkbox">VAN SMS canvass export</label><p class="pt-muted">Imported records keep their consent status. Existing opt-outs remain blocked.</p><button class="pt-btn" type="submit"${r.busy() ? " disabled" : ""}>Upload file</button></form>`
      );
    if (!resource)
      return (
        head(
          "CONTACTS",
          "Your people",
          "Reviewed lists, ready when you are.",
          button("navigate", "Upload contacts", {
            value: JSON.stringify(["contacts", "new"]),
          }),
        ) +
        `<section class="pt-card">${
          list(s.imports).length
            ? list(s.imports)
                .map(
                  (j) =>
                    `<div class="pt-row"><div><strong>${e(j.file?.fileName)}</strong><p class="pt-muted">${count(j.progress?.rowsStaged)} rows staged · ${e(label(j.status))}</p></div>${go("contacts", "Open", j.importId, true)}</div>`,
                )
                .join("")
            : `<h2>Start with a contact list</h2><p class="pt-muted">Your uploads will appear here.</p>`
        }${s.cursor ? button("imports-more", "Load more", { secondary: true }) : ""}</section>`
      );
    if (!s.job) return "";
    const j = s.job;
    return (
      head(
        "CONTACTS",
        j.file?.fileName || "Import",
        label(j.status),
        go("contacts", "All lists", "", true),
      ) +
      (j.actions?.canReviewMapping
        ? mappingForm(s)
        : `<div class="pt-grid pt-grid--three">${stat("Staged", count(j.progress?.rowsStaged))}${stat("Rejected", count(j.progress?.rowsRejected))}${stat("Parts prepared", count(j.progress?.partitionsPrepared))}</div><section class="pt-card"><div class="pt-row"><h2>${j.status === "staged" ? "List reviewed" : "Import progress"}</h2>${button("import-refresh", "Refresh", { secondary: true })}</div>${j.status === "uploading" ? `<progress class="pt-workspace-progress" value="${e(s.bytes || j.progress?.bytesUploaded || 0)}" max="${e(j.file.sizeBytes)}"></progress><p class="pt-muted">${bytes(s.bytes || j.progress?.bytesUploaded || 0)} of ${bytes(j.file.sizeBytes)}</p><label class="pt-field"><span>Select the original file to resume</span><input type="file" accept=".csv,.tsv,.txt" data-workspace-change="resume-file"></label>${button("upload-resume", "Resume upload", { disabled: !s.file || r.busy() })}${button("upload-stop", "Stop upload", { secondary: true, disabled: !r.busy() })}` : `<p class="pt-muted">${j.status === "staged" ? "Duplicates, invalid numbers and opt-outs have been checked. Preparing a list does not send messages." : "Processing continues in the background. You can leave and check back."}</p>`}${j.error ? notice("Import needs attention", label(j.error.code)) : ""}<div class="pt-actions">${j.actions?.canComplete ? button("import-complete", "Finish upload") : ""}${j.actions?.canRetry ? button("import-retry", "Resume processing", { secondary: true }) : ""}${j.actions?.canRecover ? button("import-recover", "Recover processing", { secondary: true }) : ""}${j.actions?.canReadReports ? button("import-report", "Review records", { secondary: true }) : ""}${j.actions?.canCancel ? button("import-cancel", "Cancel import", { secondary: true }) : ""}</div></section>`) +
      (s.transfer
        ? `<section class="pt-card"><div class="pt-row"><div><h2>${s.transfer.state === "verified" ? "List ready with vendor" : "Prepare list for texting"}</h2><p class="pt-muted">${e(label(s.transfer.state))}</p></div>${button("transfer-refresh", "Refresh", { secondary: true })}</div><p class="pt-muted">Each part contains at most 20,000 contacts. No messages are sent.</p>${list(
            s.transfer.partitions,
          )
            .map(
              (p) =>
                `<div class="pt-row"><span>Part ${e(p.partitionIndex + 1)}</span><span>${count(p.verifiedCount)} / ${count(p.contactCount)} verified</span></div>`,
            )
            .join(
              "",
            )}${button("transfer-start", "Prepare contacts", { disabled: s.transfer.canAdvance !== true || s.transferNeedsRead || r.busy() })}${reasons(s.transfer.blockedReasons)}</section>`
        : "") +
      (s.report
        ? `<section class="pt-card"><h2>Contact review</h2><div class="pt-workspace-table-wrap"><table class="pt-workspace-table"><thead><tr><th>Row</th><th>Result</th><th>Details</th></tr></thead><tbody>${s.report.rows.map((row) => `<tr><td>${e(row.recordNumber)}</td><td>${e(label(row.disposition || row.status))}</td><td>${e(list(row.reasons).map(label).join(", "))}</td></tr>`).join("")}</tbody></table></div>${s.report.nextCursor ? button("import-report-more", "More records", { secondary: true }) : ""}</section>`
        : "")
    );
  }
  function settings(form) {
    const d = new FormData(form),
      fields = {},
      consentValues = {};
    for (const [name] of columns)
      if (d.get(`column_${name}`)) fields[name] = d.get(`column_${name}`);
    for (const [key, status] of [
      ["consentIn", "opted_in"],
      ["consentOut", "opted_out"],
    ])
      for (const value of String(d.get(key) || "")
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean)) {
        if (consentValues[value] && consentValues[value] !== status)
          throw new Error(
            "A consent value cannot mean both opted in and opted out.",
          );
        consentValues[value] = status;
      }
    return {
      fields,
      source: sourceOf(d),
      defaultCountryCode: d.get("defaultCountryCode") || null,
      consentValues,
    };
  }
  async function sendFile(s) {
    const controller = r.newUploadController();
    await uploadContactFile({
      file: s.file,
      job: s.job,
      api: r.api,
      guard: r.guard,
      signal: controller.signal,
      progress: (n) => {
        s.bytes = n;
        r.changed();
      },
    });
    r.guard();
    s.job = (await r.api(`/imports/${id(s.job.importId)}/complete`, {})).import;
    r.navigate("contacts", s.job.importId);
  }
  async function submit(kind, form) {
    const s = state();
    if (kind === "upload") {
      if (
        !r.can("uploadImports") ||
        !s.file ||
        s.file.size < 1 ||
        s.file.size > r.workspace().limits.maxUploadBytes
      )
        throw new Error("Choose a nonempty file within the upload limit.");
      const d = new FormData(form);
      s.source = sourceOf(d);
      s.format = d.get("format");
      s.encoding = d.get("encoding");
      s.attempt ||= {
        clientRequestId: uuid(),
        fileName: s.file.name,
        sizeBytes: s.file.size,
        format: s.format,
        encoding: s.encoding,
        delimiter: s.format === "tsv" ? "\t" : s.format === "pipe" ? "|" : ",",
        source: s.source,
      };
      s.job = (await r.api("/imports", s.attempt)).import;
      // Navigate after creation so an interrupted upload remains reachable by its durable ID.
      const jobId = s.job.importId;
      try {
        await sendFile(s);
      } catch (error) {
        r.guard();
        r.navigate("contacts", jobId);
        throw error;
      }
      return true;
    }
    if (kind === "mapping") {
      s.settings = settings(form);
      s.mapping = { ...s.mapping, ...s.settings };
      s.reviewed = false;
      s.preview = (
        await r.api(`/imports/${id(s.job.importId)}/preview`, s.settings)
      ).preview;
      return true;
    }
    return false;
  }
  async function action(name) {
    const s = state(),
      j = s.job;
    if (name === "imports-more") {
      const res = await r.api(`/imports?cursor=${id(s.cursor)}`);
      s.imports.push(...list(res.imports));
      s.cursor = res.nextCursor;
      return true;
    }
    if (name === "upload-resume") {
      await sendFile(s);
      return true;
    }
    if (name === "import-refresh") {
      await load(j.importId);
      return true;
    }
    if (name === "mapping-save") {
      if (!s.preview || !s.reviewed || !s.settings?.fields.phone)
        throw new Error("Review the mapping first.");
      s.preview = null;
      s.reviewed = false;
      s.job = (
        await r.api(`/imports/${id(j.importId)}/mapping`, {
          expectedRevision: j.revision,
          ...s.settings,
        })
      ).import;
      return true;
    }
    if (
      [
        "import-complete",
        "import-retry",
        "import-recover",
        "import-cancel",
      ].includes(name)
    ) {
      const op = name.replace("import-", "");
      const cap = {
        complete: "canComplete",
        retry: "canRetry",
        recover: "canRecover",
        cancel: "canCancel",
      }[op];
      if (!j.actions?.[cap])
        throw new Error("Refresh this import to check available actions.");
      if (
        op === "cancel" &&
        !window.confirm(
          "Cancel this import? Contacts from this import will not be available for new campaigns.",
        )
      )
        return true;
      s.job = (await r.api(`/imports/${id(j.importId)}/${op}`, {})).import;
      return true;
    }
    if (name === "import-report" || name === "import-report-more") {
      const next = name.endsWith("-more") && s.report?.nextCursor;
      const result = await r.api(
        `/imports/${id(j.importId)}/report${next ? `?cursor=${id(next)}` : ""}`,
      );
      s.report = {
        rows: [...(next ? s.report.rows : []), ...list(result.rows)],
        nextCursor: result.nextCursor,
      };
      return true;
    }
    if (name === "transfer-refresh" || name === "transfer-start") {
      const write = name === "transfer-start";
      if (
        write &&
        (!r.can("canPrepareProviderAudience") ||
          !s.transfer?.canAdvance ||
          s.transferNeedsRead)
      )
        throw new Error("Refresh the list preparation status first.");
      if (
        write &&
        !window.confirm(
          "Prepare this reviewed list with your organization's texting vendor? This transfers contacts but sends no messages.",
        )
      )
        return true;
      s.transferNeedsRead = true;
      s.transfer = (
        await r.api(
          `/audiences/${id(j.audienceId)}/provider-sync`,
          write ? {} : undefined,
        )
      ).transfer;
      s.transferNeedsRead = false;
      return true;
    }
    return false;
  }
  function change(target) {
    const s = state(),
      name = target.dataset.workspaceChange;
    if (name === "contact-file" || name === "resume-file") {
      s.file = target.files?.[0];
      s.attempt = null;
      return true;
    }
    if (name === "mapping-reviewed") {
      s.reviewed = target.checked;
      return true;
    }
    if (target.closest('[data-workspace-form="mapping"]')) {
      s.mapping = { ...s.mapping, ...settings(target.form) };
      s.preview = null;
      s.reviewed = false;
      return true;
    }
    return false;
  }
  return { load, render, submit, action, change };
}
