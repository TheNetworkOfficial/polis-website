/** The shared book never uses the provider API or performs external geocoding. */
export function createOrganizationContactsApi({
  request,
  scopeKey,
  guard = () => {},
}) {
  const base = `/api/contact-book/scopes/${encodeURIComponent(scopeKey)}`;
  return async (suffix, body, method) => {
    guard();
    let result;
    try {
      result = await request(`${base}${suffix}`, {
        auth: true,
        beforeRequest: guard,
        ...(body === undefined ? {} : { method: method || "POST", body }),
      });
    } catch (error) {
      const code = error?.payload?.error || error?.code || error?.message;
      const messages = {
        contact_import_row_changed:
          "A previously saved record differs in this file. Reselect the original unchanged file to resume; the existing import remains saved.",
        contact_selection_duplicate_endpoints:
          "Selected contacts share a phone number. Keep one person per shared number or choose separate eligible numbers, then review again.",
        contact_book_changed:
          "Contacts changed while this view was open. Refresh the results and review your selection again.",
        contact_index_updating:
          "Contact updates are still being indexed. Refresh in a moment to see the complete result.",
        contact_revision_conflict:
          "This contact was updated elsewhere. Reopen it to review the latest information before saving.",
        contact_selection_changed:
          "The selected contacts changed. Clear and review the selection again.",
      };
      if (messages[code]) error.message = messages[code];
      throw error;
    }
    guard();
    if (result?.ok !== true)
      throw new Error("The contact book response could not be verified.");
    return result;
  };
}
