# Tournament UI refresh

UI-only release. Club voting, its API and migrations, sending-domain configuration and Resend integration are intentionally excluded.

## Included

- Current tournament and explicit administrator/read-only access badge.
- Join an existing tournament by its existing ID/code or complete link from any browser.
- Read-only spectator sharing with an on-device QR renderer, copy link and native sharing where supported. QR codes never contain admin credentials.
- Recently joined spectator tournaments now remain in My tournaments on that device. This is not a public directory or a cross-device account history.
- Separate Invite scorekeeper action opens the existing private-admin-link handover. This grants full access; per-person invitations/revocation remain future work.
- Radix-backed tabs and settings dialog, owned shadcn-style buttons/inputs, keyboard focus handling, mobile layouts and reduced-motion-aware transitions.
- Switching/create actions warn instead of abandoning queued or conflicting changes.

## Validation

- Production build and existing nine regression tests.
- Additional source safeguards: `node --test tests/tournament-access.test.mjs`.
- Playwright browser review with mocked score service: spectator restrictions; QR link privacy; invalid/successful joining; remembered tournaments; keyboard tab navigation; admin handover and Escape dismissal; no horizontal overflow at 320, 390, 768, 1024 and 1440px; light/dark dialog inspection.
- Browser review does not constitute a live multi-device database concurrency test, real iPhone installation test, or email-verification test.

## Deferred

Real Club member authentication and voting release, account-backed tournament membership, per-admin revocation, public deployment, and domain/email setup require a separate release.

Dependency audit currently reports vulnerabilities in the wider dependency tree. No forced or breaking dependency upgrades are bundled into this UI release.
