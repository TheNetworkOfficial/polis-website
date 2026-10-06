# Campaign recipient preparation

The campaign page keeps the approved recipient selection while preparation runs. A saved preparation hides the initial Prepare action. Staff should continue the saved work only when the server permits it.

- `needs_attention` with `recoveryAction: operator_review` directs staff to Polis support. An uncertain transfer needs review; creating another preparation does not resolve it.
- `recoveryAction: original_approver` asks the person who approved the selection to continue. Other staff can check saved progress.
- Resume requires both `canResume: true` and campaign management permission. It rereads the campaign before sending the saved preparation ID and current revision.
- Normal `ready_to_finalize` behavior is retained: the approving manager's page can complete the same approved preparation once automatically when the server permits it. Opening a campaign or checking its status can trigger that completion. Neither action sends texts.

The page shows a plain-language saved step and `selectedContactCount`. Optional `progress` contains `totalContactCount`, `submittedContactCount` and `verifiedContactCount`; all must be valid nonnegative integers. Submitted contacts are shown separately from contacts confirmed ready. Older preparations without counters show the selected count only. `updatedAtMs` is displayed when provided. Raw error codes and service vendor names are not displayed in the preparation notice.

Automatic checks stop for a held preparation, repeated read failures, hidden pages, revoked access, or the bounded polling limit. The Check preparation now action reads the latest shared campaign state. A response with an older campaign revision cannot overwrite a newer state or trigger completion of an old preparation.
