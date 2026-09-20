# Organization texting balance

The authenticated route `/organizations/:organizationId/texting-balance` uses the existing Polis sign-in and organization shell. Organization administrators have an entry on their coalition overview. The API rechecks permissions; route visibility grants no billing authority.

The page reads `/api/text-banking/prompt/scopes/{encoded coalition scope}/billing/summary`. Members can see their permitted balance, but only administrators request purchase history, inspect purchases, or create Checkout. The server supplies packs, verified rates, payment terms, environment, and eligibility. No browser-provided amount, fee, customer ID, or approval is sent.

Purchases show the full texting principal, the separate 5% service fee, and total before applicable tax. Stripe Checkout determines the final applicable tax before payment. Only HTTPS `checkout.stripe.com` destinations are accepted. The browser retains an idempotency key for uncertain retries and does not add funds locally.

Checkout returns to this route with `purchase` and `checkout=returned|canceled`. These values only initiate server status reads. The page waits for `funded`, refreshes the authoritative balance, and shows the server-provided receipt. Pending status is polled at most ten times per page load; users can refresh afterward. Revoked access clears displayed billing data. The view fences asynchronous results by signed-in user and organization.

Live purchases remain subject to backend configuration and the organization allowlist. This page does not activate texting, clear holds, restart campaigns, or change provider approval. There are no subscriptions, automatic refills, transfers, or customer refunds.

The published payment terms route is `/texting-payment-terms`, version `texting-payments-2026-09-19`. Configure its full HTTPS URL on the backend so purchase review links to the approved terms. The merchant is Lux Corp, 4700 3rd Ave S, Great Falls, MT 59405; payment support is `support@polisapp.io`. During the controlled pilot, Polis absorbs all automatic-response charges and unresolved charges; they are not retroactively deducted from customers. Verified received MMS costs $0.05; received SMS is charged only at verified, disclosed carrier cost. Tax wording does not establish a tax exemption or collection determination. Live purchasing stays disabled until the backend tax and payment readiness gates are satisfied.

Focused browser coverage: `tests/files/texting-balance.pw.spec.cjs`. It checks the five packs, terms acknowledgment, retry identity, checkout destination validation, untrusted return parameters, pending/funded/failed behavior, receipts, history pagination, member restrictions, revocation, and mobile overflow. These are mocked API/browser tests; they do not charge a Stripe account or replace backend Stripe test-mode acceptance.
