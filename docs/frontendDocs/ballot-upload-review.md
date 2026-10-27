# Resume a county-file upload

Ballot Chaser checks saved, unfinished uploads before opening another county
preparation, reading another source, uploading a prepared file, or creating a
voter-ID export. These are metadata reads; they do not consume another import
or export allowance. Held and expired work follows the existing server limits.

If the dashboard says **Your uploaded file is waiting for column review**,
choose **Resume review**. The website opens the existing upload. Do not prepare
or upload the county file again.

The column-review form appears before the dashboard. Confirm the official
voter ID column and choose **Review this report**. The website scrolls to that
step when a newly uploaded file finishes inspection.

The status separates the following steps:

- **Waiting for your review:** column review or unresolved records need a person.
- **Processing:** the website is reading, comparing, or publishing the update.
- **Ready to apply:** review the staged results, then explicitly choose
  **Apply reviewed county update**. The website never applies it automatically.
- **Complete:** the update has finished and the published results are available.

Sent files still add only eligible new voters; returned files still match the
existing voter list and retain voided-ballot handling. Existing publication,
source-use, permission and cost controls remain in effect. This change is for
the website and does not require a mobile-store update.
