import { escapeText as e, field, list } from "./textingWorkspaceUi";
import {
  contactDisplayName,
  isHouseholdContact,
} from "./organizationContactsModel";

/** Residence links do not combine people or move property observations. */
export function renderHouseholdContacts({
  contact,
  relationships,
  candidates = [],
  canEdit,
  button,
  formName,
  search = "",
}) {
  if (!relationships?.enabled || !contact?.contactId) return "";
  const household = isHouseholdContact(contact);
  const rows = household
    ? list(relationships.people)
    : list(relationships.households);
  const related = rows
    .map(
      (
        row,
      ) => `<article class="pt-card"><strong>${e(contactDisplayName(row))}</strong>
    ${household && (row.fields?.phone || row.fields?.email) ? `<p>${e(row.fields.phone || row.fields.email)}</p>` : ""}
    <div class="pt-actions">${button("detail", "Open contact", { secondary: true, value: row.contactId })}
    ${!household ? button("household-journal", "View household history", { secondary: true, value: row.contactId }) : ""}</div></article>`,
    )
    .join("");
  return `<section class="pt-card"><h2>${household ? "People at this address" : "Household and property history"}</h2>
    <p class="pt-muted">People at the same address remain separate contacts. Property observations stay with the household.</p>
    ${relationships.complete === false ? '<p role="status">Additional address matches may need review. Verified links remain available.</p>' : ""}
    ${related || `<p class="pt-muted">${household ? "No named contacts linked yet." : "No household linked yet."}</p>`}
    ${
      household && canEdit
        ? `<details class="pt-workspace-details"${!rows.length ? " open" : ""}><summary>Add a person's details</summary>
      <p class="pt-muted">Enter a name, phone number, or email address.</p>
      <form data-workspace-form="${formName("household-complete")}" class="pt-fields">
        ${field("displayName", "Person's name (optional)", "", { max: 200 })}
        ${field("phone", "Phone (optional)", "", { type: "tel", max: 60 })}
        ${field("email", "Email (optional)", "", { type: "email", max: 254 })}
        <button class="pt-btn" type="submit">Save contact details</button>
      </form></details>
      <details class="pt-workspace-details"><summary>Link an existing person</summary>
        <p class="pt-muted">Choose a contact with this exact address and unit.</p>
        <form data-workspace-form="${formName("household-search")}" class="pt-contact-save">
          ${field("search", "Find an existing contact by name", search, { required: true, max: 200 })}
          <button type="submit" class="pt-btn pt-btn--secondary">Find contact</button>
        </form>${list(candidates)
          .filter((row) => !isHouseholdContact(row))
          .map(
            (row) =>
              `<article class="pt-card"><strong>${e(contactDisplayName(row))}</strong>
            <p>${e([row.fields?.addressLine1, row.fields?.addressLine2, row.fields?.city, row.fields?.state, row.fields?.postalCode].filter(Boolean).join(", "))}</p>
            ${button("household-link-person", "Link this person", { secondary: true, value: row.contactId })}</article>`,
          )
          .join("")}
      </details>`
        : ""
    }</section>`;
}

/** Repeated submissions after a lost response reuse the exact operation. */
export function householdOperation(state, request, makeId) {
  const key = JSON.stringify(request);
  if (state.householdOperation?.key !== key)
    state.householdOperation = { key, operationId: makeId() };
  return state.householdOperation.operationId;
}

export function householdPersonFields(data) {
  const fields = {};
  for (const name of ["displayName", "phone", "email"]) {
    const value = String(data.get(name) || "").trim();
    if (value) fields[name] = value;
  }
  if (!Object.keys(fields).length)
    throw new Error("Enter a name, phone number, or email address.");
  return fields;
}
