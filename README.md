# Maple Mail Center
A working local intake-to-pickup application for a fictional bilingual service center. Synthetic data only. TypeScript on Node 24 with built-in SQLite and a small responsive browser UI. No package installation, paid API, or external identity provider required. Staff sign-in uses local, temporary demo credentials.

## Run
Install Node.js 24 or later, open this directory, then:
```
npm start
```
The terminal prints three randomly generated demo passwords at startup (Alex Rivera: clerk, Morgan Lee: manager, Casey Chen: auditor). Open http://localhost:4317, choose an account, and enter its terminal-displayed password. Credentials and sessions expire when the server restarts unless credentials are supplied using local environment variables. `PORT=4318 npm start` changes the port. SQLite creates `data/maple.sqlite` on first start. For isolated test instances, `MAPLE_DATA_DIR=/tmp/maple-demo npm start` places the database and uploaded images in a separate directory; do not point it at important files. `npm test` runs focused domain tests. Server binds loopback only. The `.env.example` documents configuration; this minimal server reads process environment, not .env files automatically.

## Demo staff access and authorization
The server requires a named staff session for customer and custody data, label-image reads, exports, and all API mutations. A short-lived, HttpOnly, SameSite=Strict session cookie and per-session CSRF token protect write requests. Sessions last eight hours or until server restart; logout revokes the current session. Public source includes no usable real-world credentials. The authentication demonstration is **not** a complete production identity system (no MFA, SSO, password reset, durable account management, audit retention policy, or TLS).

Roles: **Clerk** can read records, create intake and uploads, record pickup, and simulate notifications; cannot edit customers, correct custody, authorize third-party pickups, export bulk logs, or reset the demo. **Manager** can perform all clerk actions plus corrections, authorizations, customer changes, exports, and retention/reset. **Auditor** can read records, history, and exported logs but cannot mutate records. Source fixtures remain public synthetic assets, while uploaded images require a session. Changes are enforced by the server, not merely hidden in the UI.

For repeatable local demo accounts without creating paid credentials, optionally provide `MAPLE_CLERK_PASSWORD`, `MAPLE_MANAGER_PASSWORD`, and `MAPLE_AUDITOR_PASSWORD` in the process environment. Never commit configured passwords; no `.env` file is parsed automatically. For ordinary launches, passwords are generated randomly and shown only in the terminal. Do not forward ports or bind publicly; run on loopback with synthetic data only.

## Operator guide
1. Open New intake. Type or scan tracking; Enter never submits. Enter label name/mailbox. Upload an outside label or use a synthetic fixture. Live OCR is unavailable; fixture suggestions require an explicit copy and verification.
2. Find matches. Maria Garcia has two records. Use mailbox, contact and verified records to resolve the person. Select recipient, document verification evidence, check confirmation, then store. Unreadable/inactive cases can be saved for review without a notification.
3. Duplicate tracking shows existing inventory context. Open the existing record, or record a legitimate reuse reason before creating another.
4. Open an item to move storage, correct recipient with reason, or mark returned/exception. Recipient correction preserves events and supersedes unsent drafts. Inspect notifications independently.
5. Notification simulation either reports simulated or a deterministic failure. Replay returns the same attempt and key; it does not pretend to retry live delivery. c7 triggers the failure fixture. No SMS or email is sent.
6. For pickup check photo ID according to the configured demo staff check, then confirm collection. For third parties, first create a separate authorization in Customers, then select it at collection. The app records the staff's assertion; it does not verify identity itself.
7. Inventory searches names, mailbox and tracking. Filter status, inspect age and export CSV. Export includes current intake/pickup rows; item detail shows the full immutable event history.
8. Customers supports names shared by multiple people, aliases, language, contact and active status. Demo & retention configures image expiry and resets synthetic records.

## Data and retention
The initial schema migration is idempotent SQL in db.ts. Typed entity envelopes are persisted under organization/kind/id; immutable append-only event rows are enforced with SQLite triggers. Domain rules run inside immediate transactions. Model and acceptance specification: MODEL.md. Entity kinds: customer (mailbox/aliases embedded), location, item, label, ocr, match, confirmation, authorization, draft, attempt, settings. This is a compact demo schema rather than normalized production migrations.

Upload acceptance checks exact data-URL encoding, declared type against PNG/JPEG/WebP header signatures, basic file structure, dimensions (maximum 12,000 pixels per side, 36 million pixels total), and a 2 MB byte limit. Accepted uploads record image dimensions and an audit event. These are **metadata checks, not full image decoding, malware scanning, EXIF removal, or production-safe file sanitization**. A malicious file could still pass header checks. Use synthetic or sanitized label images only. Production use requires a maintained image decoder/re-encoder, metadata stripping, malware controls, and independent verification.\n\nLabel expiry defaults to 30 days, configurable 1–90 for new uploads. Reads block expired uploaded images. Delete expired images removes files and writes a deletion audit record. Custody history stays. Before reset, uploaded files are now removed and logged. Synthetic SVG label fixtures are public demo assets, contain no private data, and remain in source. Backups require a separate retention/deletion policy; none are created by the app. Stop the server before deleting a whole disposable demo data directory. Do not claim postal certification or compliance.

## Security and integration limits
This is a single trusted workstation demo, with a fixed organization, session-based demo staff sign-in, and request-scoped custody attribution. No production staff identity provider, MFA, secure password lifecycle or tenant provisioning is provided. Keep loopback binding and use only synthetic/sanitized data. Business-scoped repository methods and cross-origin write checks are implemented, but this is not a multi-tenant production service. Real deployment still requires hardened identity administration, TLS, session and password security review, audit retention policy, normalized constraints, upload decoding/virus checks and backups. Browser rendering escapes source text, bounds uploads and uses a restrictive content policy. Source/model text cannot invoke actions.

Core services in domain.ts form the adapter boundary. Replace fixture OCR with a structured proposal interface and deterministic notification adapter with an authenticated provider only after review. Provider states must include sent-by-adapter, failed and unknown, distinct from queued and simulated; delivery receipt must be modeled separately. Currently only queued/simulated/failed/superseded are emitted.

## Implementation status
- [x] Persistent manual intake, barcode field, photo/upload and separate fixture suggestions
- [x] Explicit confirmation, evidence, ambiguity/inactive review, duplicate reason
- [x] Customer maintenance, bilingual drafts and idempotent simulated attempts
- [x] Search, aging, storage corrections, pickup and third-party authorization
- [x] Append-only custody events, export, scoped demo reset and image retention
- [x] Named demo staff login, role checks, CSRF-protected writes and session-attributed custody events
- [x] 30 customers, 50 items, 6 locations, 10 labels, 5 review labels, damage, duplicate event, failure
- [ ] Live OCR, SMS/email, production-grade identity/MFA and deployment
- [ ] Formal accessibility audit and actual device/scanner testing

## Sample scenarios
Fixture label1 says Maria Garcia without a mailbox; two candidates must remain unselected. Labels2–5 have unreadable recipient fields. Tracking `9400 1000 0000 1005` already exists and has damage recorded. See tests/domain.test.ts for executable expected outcomes.

## Pilot plan
Discovery: (1) Who can confirm recipients and change records? (2) Which mailbox/alias evidence is reliable? (3) What documents authorize delegate pickup? (4) Which contact languages, templates and consent policies are approved? (5) What retention and exception escalation policy is required?
Baseline: time 20 sanitized manual intakes and 20 searches with current practice; record median/p90, corrections, duplicates and interruptions. Shadow trial: use 100 representative sanitized outside labels beside the existing process, with all drafts unsent and staff comparing every recipient. Record time from label capture to stored intake, corrected matches, duplicate detection recall and search-to-item time. Proposed success gates (hypotheses): zero wrong-recipient drafts, all seeded duplicates caught, every pickup attributable, median intake and search time improved by 20% without increased correction rate. Stop and investigate any wrong-recipient notification, double collection, lost history or sensitive leakage. Do not automate delivery until staff sign off the shadow results. Decide next scope from observed bottlenecks: OCR if typing dominates; messaging adapter if outreach dominates. Buyer, price, demand and savings remain hypotheses.

