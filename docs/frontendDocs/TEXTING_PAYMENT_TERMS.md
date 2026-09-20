# Texting payment terms publication

The approved customer document is maintained in `frontend/src/pages/texting-payment-terms/texting-payment-terms.html` and emitted as the public `/texting-payment-terms` route. Do not use a separate draft as the checkout agreement.

- Intended HTTPS URL: `https://polisapp.io/texting-payment-terms`
- Effective date: September 19, 2026
- Version: `texting-payments-2026-09-19`
- Merchant: Lux Corp, 4700 3rd Ave S, Great Falls, MT 59405
- Payment support: `support@polisapp.io`

The user approved the merchant details, one-time packs, 5% service fee including processing, no routine refunds with legally required exceptions, and organization-owned balances with no expiration, transfer, cash-out or automatic refill. During the controlled pilot, Polis absorbs all automatic-response charges and unresolved charges. Those charges are not deducted retroactively. Verified incoming MMS remains $0.05 per message; incoming SMS requires verified carrier cost and a disclosed billing basis.

Applicable tax and the final amount are shown before payment. This text does not determine tax classification or authorize blanket zero tax. Connecticut is the initial customer state; live purchases remain disabled pending the required tax determination and configuration.

## Release checks

- Confirm the public HTTPS page matches this version before setting the backend terms URL/version.
- Confirm `support@polisapp.io` can receive customer mail.
- Configure the organization's verified tariff, charge disclosures and pilot absorption policy on the backend.
- Complete tax setup, Stripe acceptance and the separately authorized live purchase before expanding access.

Publication of this page does not enable purchasing or approve messaging. Backend eligibility and allowlist checks remain authoritative.
