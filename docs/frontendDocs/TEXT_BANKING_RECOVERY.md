# Text Banking website recovery and refresh

Text Banking remains a manually reviewed organization feature. The setup screen names Polis support and gives the next required step. Organization billing administrators see upcoming and expired activation, rate, purchasing-review and tax-review deadlines supplied by the server. Volunteers do not see billing renewal details.

## Working through a session

Each send confirms one reviewed recipient. If its outcome cannot be confirmed, **Keep for review and continue** retains that recipient's hold while opening the next recipient. It never sends or skips the held recipient. **Check saved recipient outcomes** reads exact item evidence. Missing or uncertain records retain their holds.

Image readiness follows the selected recipient, including after continuing past an uncertain image message. Late image events from the previous recipient cannot change the current preview's readiness. Authentication or navigation failures proven to occur before dispatch do not leave a false hold. Failures after dispatch keep the original hold. For an existing saved hold on an untouched recipient, **Check unsent preview** asks the server to fence the old confirmation and return a new preview; the recovery request survives reloads, and sending still requires a separate confirmation.

Where enabled, a verified unaccepted optional message offers **Prepare another attempt**. This creates a new recipient preview. Sending still requires a separate confirmation of that new preview. Unknown outcomes never offer this action.

A lost reply response stores its exact action identity and reply generation. The website reads that action and independently rereads current reply access and generation before enabling the composer. A missing record or an inaccessible old action never authorizes a resend. **Check recovery** can explicitly resolve an older saved hold or a saved action the server never received. It resumes the server-owned clearance request after reloads, and an authorized manager can deliberately take over another person's interrupted recovery. A verified clearance advances the reply generation; each new reply consumes its generation and remains a deliberate user action.

Managers can open **Recovery** to inspect saved cases, check server evidence, or request an evidence review. Submitted claims do not release a held message, charge or sending permission. Recovery displays recognizable team-member names.

## Reading messages

The active conversation checks for changes every 15 seconds, briefly every 10 seconds after a reply. The inbox checks every 30 seconds. When a verified recent-activity index is available, each interval reads the recent head plus one independent page in stable canonical order; completing that sweep removes rows whose access was revoked. Errors back off to at most two minutes. Hidden tabs pause reads; returning to the tab resumes them. Reads have a 20-second deadline, including authentication waits. Polling has no production session lifetime cutoff.

The latest standard messages appear first, with older history available on demand. Loaded pages, drafts and scroll position survive refresh. Verified chronological indexes and the message change feed are used only when the server advertises their availability. If index health changes, clients restart bounded canonical reads while retaining loaded content. Without indexed changes, nonterminal outbound statuses refresh in batches of at most 90 exact message IDs. Optional provider-ID history rotates one page per refresh; absent verified chronological coverage, discovery latency grows with the number of pages.

Unread status is acknowledged only for messages intersecting the visible thread and browser viewport. Proofs are bound to the returned message IDs. Expired conversation proofs renew for exact visible IDs. Campaign-history proofs renew for exact visible entry IDs where supported; older servers reread the original bounded page and acknowledge only matching visible entries, preserving loaded older rows. If a page has shifted completely, the interface asks the user to refresh history rather than falsely marking unseen rows read.

Existing notification cards open the scoped texting conversation. This change does not install a new browser push or service-worker subscription system.

## Validation and release boundary

Unit regressions cover normal multi-recipient uncertain outcomes, exact status recovery, storage deletion failure, old-action access changes, hidden queued reads, deadlines, old delivery status changes, index fallback, pagination, short-name picking, and visible read subsets. Built-browser checks use the actual isolated website Express server and a localhost upstream simulator, with an ephemeral session secret and artifact-only SQLite database. They do not contact a production provider or certify production deployment, infrastructure installation, or native-device behavior.
