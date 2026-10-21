# Classroom Toolkit — isolated foundation (Draft PR)

## Preserve CIA4103

Original production branch remains \`main\`. An immutable-point-in-time **backup branch** was created first:

- Branch: \`backup/cia4103-working-2026-10-22\`
- Backup head: \`aeba1cb57e3d66699973ae582def0bf75378f7a0\`
- Existing pages and functions in \`public/\`, \`public/dashboard/\`, \`public/live/\`, and \`/api/posts\` are unchanged in this PR.

This is a *Git source backup* only. Netlify environment variables, Blobs, and remote LiveKit state are outside Git, and should be separately backed up before any migration. Do not overwrite production \`main\` or redeploy until a preview is accepted.

## Current incremental implementation

Visit \`/toolkit/\` on a deploy preview.

- **Lecturer:** Creates a room with the existing lecturer PIN. Receives a 6-digit code and a limited-scope projector link. Can open Live Poll (2–8 generic options, optional prompt), Live Answers, Word Cloud, or a persistent Countdown Timer. Can close rounds and hide/reveal projector results.
- **Student:** Joins using code and nickname, optionally pair name. Reuses their identity/session across these four new activities; edits their response while a round is open. Displays success/error states.
- **Projector:** Uses a separate read-only signed link, shows only explicitly revealed poll/cloud data and approved open answers. Does not expose lecturer token.
- **Data:** Scoped to independently generated classroom code, token and role. Each submission is tied to exact activity ID, with conditional writes and revision conflict reporting.
- **Existing screen sharing:** Remains available via a separate link to the original CIA4103 screen-sharing pages. **NOT YET integrated with new per-room identity or multi-room LiveKit**. Existing standby/resume paths are untouched.

### Files added

- \`netlify/functions/toolkit.mjs\` — isolated Netlify Function API. Automatically available at \`/.netlify/functions/toolkit\`; no Netlify routing changes.
- \`public/toolkit/index.html\` — responsive generic classroom UI.
- \`public/assets/toolkit-app.mjs\` — external JS module, compliant with existing CSP.
- This document.

## Configuration

The implementation requires an existing strong \`CIA4103_TEACHER_PIN\` (minimum 12 characters) and a token signing secret of at least 24 characters:

- Prefer a **new, independent** \`TOOLKIT_SESSION_SECRET\` configured in Netlify (Functions).
- Development fallback is existing \`LIVEKIT_API_SECRET\` if \`TOOLKIT_SESSION_SECRET\` is not available.

Do not expose the PIN or signing secret in the frontend, GitHub, URLs or screenshots. Never embed teacher session token in a projector link. Production migration should rename the old \`CIA4103_*\` environment variables with a compatibility plan, not abruptly.

## Draft acceptance checklist

### Automated and source
- [x] New work only under separate routes and functions; no legacy CIA4103 files modified.
- [x] JS syntax parser check passed for \`toolkit.mjs\` and \`toolkit-app.mjs\` (V8 parser, not full runtime integration test).
- [x] External JS served under CSP rather than inline script.
- [ ] Full Node tests (validation, auth, room isolation, CAS, aggregation and moderation).
- [ ] Preview build and real Netlify Function/Blob integration tests.

### Classroom flows: to be tested in preview
- [ ] Teacher creates a room with a valid PIN; incorrect PIN fails, no secrets displayed.
- [ ] Student joins with code and nickname; join other/expired/ended room fails.
- [ ] Two simultaneous classrooms remain independent; teacher and display cannot see the other room's submissions.
- [ ] 30 students can join one classroom; results remain scoped.
- [ ] Poll Option 1–Option N updates counts, supports revised votes without double-counting, handles concurrent submissions.
- [ ] Word Cloud aggregates duplicate words, supports UTF-8/Arabic/accents; moderator can hide content.
- [ ] Open Answers are private until individually shown and lecturer explicitly reveals projector output.
- [ ] Pair mode counts one answer per team; concurrent edits fail with a helpful conflict.
- [ ] Timer retains remaining time after tab switch/reload.
- [ ] 320/390/768/1024 responsive layouts and keyboard navigation.
- [ ] Existing CIA4103 code submission, PDF viewer, and 2-real-student screen share standby/resume still pass.

## Known limitations (MUST close before replacing production)

1. **Screen sharing is legacy-mode only.** The new room doesn't map to LiveKit's hard-coded \`cia4103-lab09-screen-shares\`. Multi-room LiveKit auth, the new student roster and standby/resume need a distinct implementation with security and real-browser regression testing. Until then opening screen sharing requires the legacy page.
2. **No automatic stored-data TTL cleanup yet.** Rooms expire logically after four hours, but stored room, membership and response records remain in Netlify Blobs. Add bounded scheduled/deferred cleanup and a teacher delete/export policy before using with identifiable students.
3. **Rate limits and anti-spam protections** are needed on join, submit, and classroom creation; classroom code is not an identity credential.
4. **Word Cloud moderation:** teacher sees text live, projector defaults hidden until revealed; future unmoderated responses can appear after reveal. Add optional preapproval queue / explicit live unmoderated mode with clear warning before production use.
5. **Real-time transport:** prototype uses 5-second client polling. Evaluate hosting cost and event transport (SSE/WebSockets/LiveKit Data with scoped permissions) prior to rolling out to large cohorts.
6. **Room restore:** lecturer/student tokens live in sessionStorage, not cross-device synchronized. Reconnection and token renewal should be tested.
7. **Scale:** Data listing currently capped at 150/250 records per tool request. Add paginated/aggregated storage for large classes and repeated rounds.
8. **No production security review or acceptance pass yet.** Authentication is PIN + signed short-lived room tokens, and does not provide SSO, identity assurance or roster import.

## How to test without touching production

1. Open the GitHub PR's Netlify **Deploy Preview** (not the published URL), then visit \`/toolkit/\`.
2. Configure \`TOOLKIT_SESSION_SECRET\` (or existing fallback) and \`CIA4103_TEACHER_PIN\` in the applicable Netlify preview Functions environment. **No secret values in GitHub.**
3. Open separate normal/incognito browsers to simulate teacher, 2 students, projector.
4. Start a room, join students, submit/edit votes, confirm counts and delayed updates; test invalid code and incorrect role.
5. Repeat for open answers (verify approval flow), word cloud (repeated terms and Arabic), timer, pairs, and room termination.
6. Separately run the original screen-share authorization → select window → standby → resume → stop sequence in real browsers.
7. Check Netlify usage, function errors and blob retention; verify no main merge or production Netlify deploy occurred.

This development branch is a **foundation, not a release**. Keep PR in draft. Formal acceptance only after security gaps, multi-room media integration and end-to-end tests are resolved.

Tracked in [Issue #2](https://github.com/NTinkicht/CIA4103-LabBoard/issues/2).
