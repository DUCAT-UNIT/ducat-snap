# External Submission Gates

This file separates real external blockers from accidental placeholders. The audit candidate source and local verification are ready; the fields below still require third-party or project-owner input before MetaMask submission.

## Required Before MetaMask Submission

| Field | Where | Blocked on |
| --- | --- | --- |
| `PENDING_APPROVED_AUDITOR` | `ALLOWLIST_SUBMISSION.md` | Selecting the MetaMask-approved third-party auditor. |
| `PENDING_AUDIT_COMMIT` | `ALLOWLIST_SUBMISSION.md`, `metamask-directory.json` | Final audit report identifying the audited tag or commit. |
| `PENDING_AUDIT_FIX_COMMIT` | `ALLOWLIST_SUBMISSION.md`, `metamask-directory.json` | Audit fixes, if any, merged and tagged. |
| `PENDING_AUDIT_REPORT_URL` | `ALLOWLIST_SUBMISSION.md`, `metamask-directory.json` | Public or attachable third-party audit report. |
| `PENDING_ESCALATION_CONTACT` | `ALLOWLIST_SUBMISSION.md` | Private MetaMask escalation contact chosen by DUCAT-UNIT. |
| `PENDING_RESPONSE_TIME` | `ALLOWLIST_SUBMISSION.md` | Project-owned support SLA for directory review. |
| `PENDING_FINAL_SCREENSHOTS` | `ALLOWLIST_SUBMISSION.md` | Final screenshots captured from the audited Snap build. |
| `PENDING_DEMO_VIDEO_URL` | `ALLOWLIST_SUBMISSION.md`, `metamask-directory.json` | Demo video recorded from the audited Snap build. |

## Required Artifact Gates

| Artifact | Where | Blocked on |
| --- | --- | --- |
| Real PSBT fixtures | `submission/fixtures/*.json` | Final audited frontend/client-sdk/validator flows for create, deposit, borrow, repay, withdraw, swap, liquidation, and repossess. |
| Final E2E evidence | `submission/e2e/evidence.json` | Recorded signet/mutinynet install, update, connect, reload reconnect, action signing, rejection, and disabled/re-enabled flows. |
| Final screenshots | `submission/screenshots/*.png` | Reviewable PNG captures from the audited Snap build and final frontend Snap configuration. |

## Already Filled

- Builder URL: https://github.com/DUCAT-UNIT
- Public support URL: https://github.com/DUCAT-UNIT/ducat-snap/issues
- Security process URL: https://github.com/DUCAT-UNIT/ducat-snap/blob/audit-candidate-0.1.0-20260614-screenshot-gate/SECURITY.md
- Privacy policy URL: https://github.com/DUCAT-UNIT/ducat-snap/blob/audit-candidate-0.1.0-20260614-screenshot-gate/PRIVACY.md
