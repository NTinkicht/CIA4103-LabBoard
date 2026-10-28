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


## Saved Polls — lecturer lesson preparation

The lecturer can prepare a poll with a title, optional prompt, 2–8 choices and individual/pair mode, and press **Save for later**. The poll is stored in the site's Netlify Blobs store as a versioned saved poll, **not** merely in browser localStorage or in the temporary classroom room. On future visits, the lecturer creates a new classroom with the same PIN and sees their **My saved polls** library, and can Load → Edit/Update → Start when ready. The library is intended for one lecturer administering this site, not multi-user access control. Currently 100 stored poll slots maximum, including archived entries.

Teacher-only library API: \`action: "library"\` with \`operation: "list"|"save"|"delete"\`; classroom tokens authorize the request. Question library remains usable across successive room sessions, but each room code is temporary (four-hour expiry). Do not put student-identifying information into saved poll titles or questions.

**Safe first deployment:** This release can be published as an **early-access lesson-preparation tool** under \`/toolkit/\` following the owner's direct deployment instruction and passing CI. It does not replace or modify the old CIA4103 routes, and the source backup remains fixed. The live classroom features must still receive a real-world connection/security/scale test before a full class depends on them. In particular, screen sharing still uses the independent legacy room.

**Live configuration:** \`CIA4103_TEACHER_PIN\` and either \`TOOLKIT_SESSION_SECRET\` (preferred) or \`LIVEKIT_API_SECRET\` must be present in **Netlify Functions** for the selected deployment context. A successful static deployment does not imply those secrets have been verified or that room creation works.


## Classroom preparation: questions for three tools

The lecturer's three active response tools now each support a persistent, independent question library:

- **Polls:** Optional prompt, 2–8 choices, title, response unit; Save for later / Load / Update / Delete
- **Word Cloud:** Saved title and required prompt, response unit; reuse across new rooms
- **Live Answers:** Saved title and required question, response unit; reuse across new rooms

Library API accepts \`action=library\`, \`operation=list|save|delete\`, \`kind=poll|cloud|answers\`. Existing saved polls remain under \`saved-poll/\` and are backward compatible. Each question kind has its own namespace (100-entry cap). Permission: teacher room token, created by existing lecturer PIN. A room lasts four hours but saved questions remain in site storage after the room expires. Each future room can load them.

## Files & Slides — local PDF and PowerPoint presenter

The new **Files & Slides** tool displays a same-origin \`/toolkit/presenter/\` viewer in the lecturer workspace and opens the standalone viewer in a new tab if desired.

- Supported: \`.pptx\`, \`.ppt\`, \`.pdf\` up to 50 MB per file.
- Lecturer selects local file; saved to browser IndexedDB (no upload of file bytes); file selector can reopen files across classroom sessions in **the same browser/device and site origin**.
- PowerPoint uses pinned \`@web-ppt/core@0.4.5\` through the existing allowlisted jsDelivr module CDN to parse a Blob locally; the rendered slide is a sandboxed SVG image URL. Canvas-free; arrow keys, PageUp/PageDown, Home/End, slide count, and fullscreen using the native Fullscreen API.
- PDFs appear in a native iframe backed by an in-memory blob URL and also support fullscreen.
- If institutional network blocks CDN scripts or the deck contains unsupported fonts/effects/animations, request a PDF export or open the file in PowerPoint; rendering may differ from Office.
- Document viewer permits same-origin iframe embedding with scoped \`X-Frame-Options: SAMEORIGIN\` and \`frame-ancestors 'self'\`. The rest of CIA4103 still retains \`DENY\` and \`frame-ancestors 'none'\`.

**Security/privacy:** The selected file never goes to Netlify Functions; there is no upload endpoint. It does remain stored *unencrypted in the current browser's local IndexedDB*, so do not use private files on shared computers. The parser source is fetched from jsDelivr but not the presentation bytes. The engine's browser compatibility and rendering fidelity must be smoke-tested with a representative lecture PPTX; do not promise pixel-perfect slides, embedded fonts or animation equivalence. Original PDF lab viewer is untouched.

### Release acceptance

- [ ] Verify live preview with two browser profiles and teacher credentials.
- [ ] Verify saved questions after ending classroom and starting a new room.
- [ ] Verify imported PowerPoint slides (text, images, charts, layouts) and PDF under fullscreen; check browser privacy and network policies.
- [ ] Confirm classroom does not disconnect when switching Files & Slides.
- [ ] Verify CI for new library and presenter, Netlify-specific header rules and production staging before merging.


## Unified student classroom (three persistent tabs)

Immediately after joining a room, students see a single \`/toolkit/\` page with exactly three top-level navigation tabs:

1. **Activities:** Polls, Live Answers, Word Cloud and timed activities; auto-refresh without leaving the room.
2. **Screen Share:** A same-origin embedded instance of the existing approved student LiveKit queue. The student name is prefilled. The iframe remains mounted across tab switches, maintaining captured application/window and standby state (until the student stops sharing or the browser closes the media track). It is the original legacy shared LiveKit queue, not yet a distinct video room per Toolkit code.
3. **Share Work / Problem:** A native, course-independent form to share a problem or solution, optional topic, explanation, code/calculation text, and a screenshot. Screenshots are converted to bounded WebP in the student browser and stored with the submission in room-scoped Netlify Blobs. No separate navigation or compulsory "Lab" field.

Lecturer dashboard gains **Work & Problems**. The list is accessible only with a lecturer room token; screenshot bytes are fetched separately and only on demand. Nothing is published to the projector or other students. Room expiry denies further reads, but existing blob records still require the previously identified storage-retention cleanup.

Navigation requirements:
- Switching tabs never changes the URL, never opens a new tab, and must not reset an unfinished answer/form.
- Screen Share iframe loads lazily the first time its tab is opened; it is hidden, not destroyed, during subsequent tab changes.
- Keyboard and mobile layouts remain accessible with large fixed tab targets.
- Legacy \`/live/\`, \`/\` student boards, \`/dashboard/\` and backup branch remain available.
- The specific \`/live/*\` page is allowed only inside a **same-origin** iframe using its scoped CSP/X-Frame-Options; the global deny rule remains unchanged for other pages.

Testing: \`tests/toolkit-browser-smoke.mjs\` exercises the three student tabs, embedded share name prefill and frame persistence, private work submission and active poll return. \`tests/toolkit-api.test.mjs\` verifies work-type validation, lecturer-only access, screenshot private retrieval and independent rooms.

**Known limitation:** Existing LiveKit media queue is not yet isolated by Toolkit room; do not run separate simultaneous classes using screen sharing until room-scoped LiveKit integration is delivered.


## Collaborative whiteboard (teacher-controlled student drawing)

The lecturer now has a **Whiteboard** tool. Select **Open whiteboard for students** to make the board the active classroom activity. Existing polls, Word Cloud and Live Answers continue working as separate activities. When the whiteboard is active, it appears inside students' existing **Activities** tab; the student interface retains exactly **three tabs**, without adding another navigation destination.

**Teaching workflow**
1. Open Whiteboard; the board and student roster appear side by side on the lecturer's screen.
2. The teacher can draw at any time with pen colors, sizes and a white eraser.
3. Students automatically see the board. Unselected students are view-only.
4. Select a student from the side roster to grant them drawing access. Selecting another automatically revokes the previous student; selecting the active student again revokes everyone.
5. The selected student draws directly on the same board in Activities, using mouse, touch or stylus, while the lecturer may keep writing.
6. The teacher can undo, clear, export a PNG or fullscreen the canvas. Students can export the current view but cannot undo/clear the shared board.
7. The projector view can also display the board without drawing rights.

**Permissions**
- The server verifies lecturer vs student role on every whiteboard request; a student's drawing permission is rechecked against the latest granted student ID during each atomic CAS update.
- Student selection is restricted to student IDs belonging to the same classroom; projector/other rooms cannot draw or change permissions.
- Strokes are normalized to a fixed 1000×600 canvas, with accepted color/width and bounded coordinate/point inputs.
- Both lecturer and selected student may draw concurrently; updates use compare-and-set and retry rather than overwriting existing strokes.

**Operating limits**
- Poll-based sharing refreshes in approximately 1.7 seconds, not continuous streamed pointer positions. A stroke is distributed when the writer finishes it (pointer release).
- Up to 350 strokes per classroom whiteboard; Clear resets it. Old strokes are removed from the current board but physical retention of the backing room data still requires the broader cleanup work.
- The side list represents **joined classroom members**, not verified real-time presence. It may include a student who disconnected.
- Grant applies to only one student at a time, in addition to the teacher; broader concurrent group collaboration is a future optional enhancement.
- Anonymous classroom identifiers and older legacy screen-sharing features remain separate. Avoid using sensitive real patient/student details on classroom boards.

**Verification**
- Backend tests check teacher-only activation, reader roles, private room isolation, selected writer/revocation, fresh permission rechecks, two-writer concurrency, undo, clear, exact bounds and invalid input.
- Chromium browser tests check teacher/student drawing, switching selected writer, view-only state, teacher drawing/clear, and the preserved 3-tab student interface.
- Original CIA4103 backup: \`backup/cia4103-working-2026-10-22\`.


## Lecturer layout: wide workspace and embedded original viewers

- Lecturer-only viewport removes the old centered 1512 px maximum and reduces the side rail to 216 px. The sidebar is positioned next to the left viewport gutter; the selected tool gets remaining width.
- **Screen Sharing** now embeds the **existing Live classroom code board** at \`/dashboard/?embed=1&section=screens\`, opening on Live Screens. The board includes the original student submissions and Lab PDFs sections for quick access; original standalone \`/dashboard/\` remains unchanged in appearance.
- **Files & Slides** now embeds the full PowerPoint/PDF viewer directly in the teaching workspace, at full available width and with native fullscreen. No separate click is required to reach the file viewer.
- Both lecturer iframe elements remain mounted and retain their browsing context when another tool is selected; switching away does not intentionally disconnect the LiveKit room or reset the document viewer.
- The lower **Live classroom** results surface is shown only when Poll, Live Answers, Word Cloud or Timer is the selected tool **and** the active activity is of that same type. The former duplicate whiteboard placeholder therefore no longer appears beneath Screen Sharing, Files, Work or Whiteboard itself.
- Embedding uses a new scoped same-origin CSP/X-Frame-Options exception for \`/dashboard/*\`; external websites cannot frame the dashboard. The existing global framing deny remains in place.
- The embedded Live Screens tool still requires the existing lecturer PIN once in the legacy LiveKit controls and still uses the legacy global LiveKit room. It does not yet map to the Toolkit's 6-digit multi-room identity.

Verification: Chromium tests check sidebar geometry, viewer width, code board availability and selected Live Screens tab, persistent iframe on tab switches, no duplicate lower panel, and original student three-tab navigation.


## Simplified Screen Sharing lecturer tool

The lecturer's left-rail **Screen Sharing** selection now embeds only the LiveKit screen-sharing interface. It shows the lecturer PIN connection, active shared screen, student approval/standby queue and control buttons directly; it does **not** load the previous CIA4103 dashboard header, lab PDF tabs, submitted code board, or unrelated classroom panels.

The focused view is served at \`/toolkit/screen-sharing/\` and reuses the tested \`live-teacher.mjs\` controller; both the legacy \`/dashboard/\` standalone page and student \`/live/\` continue unchanged. The Toolkit keeps the same iframe mounted across tool switches so ongoing LiveKit screen viewing is not disconnected. The standalone legacy dashboard is again protected by the global DENY iframe policy; only the dedicated screen view allows same-origin embedding.

The lecturer still enters their existing lecturer PIN inside the screen-sharing panel because media authorization is separate from the Toolkit room token. The original shared LiveKit room remains a limitation for simultaneous independent classes.


## Single lecturer sign-in and video-first Screen Sharing

When a lecturer is **already authenticated in Classroom Toolkit**, the focused embedded Screen Sharing panel uses the **existing signed room session**. It does not ask for the PIN again. The lecturer's session is transferred via a **same-origin parent/iframe postMessage**, never through a URL or query string.

On the server, each LiveKit lecturer operation (\`live-token\`, \`live-participants\`, \`live-control\`) accepts the Toolkit session only after verifying signature, teacher role, 6-digit room identity, expiry, room presence, and that the room has not been ended. Wrong-role, forged, expired, foreign and ended-room tokens are denied. The original standalone CIA4103 lecturer dashboard still supports the old private PIN.

Screen Sharing now focuses on the video:
- Duplicated PIN form is hidden in authenticated embedded mode, while standalone mode retains it.
- Repeated large headings/subtitles are suppressed. A compact connection status and a short presenter/standby control strip remain.
- The video takes the majority of the content width and vertical viewport. Teacher can hide/show the student queue for an even larger viewing area.
- Embedded screen-sharing iframe remains mounted while the lecturer changes tools; standby/resume and existing student 3 tabs remain intact.
- Student selection still uses the legacy shared LiveKit room; genuine per-Toolkit-room LiveKit isolation remains a future engineering task.

Acceptance: source tests for role/expiry/tamper checks and real Chrome test confirming no second PIN, same-origin session handoff and compact screen viewport. Production remains unchanged until branch checks are green.


## Compact Files & Slides and collapsible lecturer navigation

To maximize the teaching display:
- **Files & Slides** uses a compact outer tool label and hides redundant descriptive text and badges. Inside the local PowerPoint/PDF viewer, the separate header and file library row are combined into **one small toolbar** (select presentation, Remove, Add file, Fullscreen). The slide takes the remaining viewport height; the existing PPTX parser, IndexedDB documents, keyboard navigation and native fullscreen are unchanged.
- The lecturer rail has an always-accessible **Collapse/Expand sidebar** button. The expanded rail is 216 px; collapsed desktop rail is about **64 px** and shows only recognizable tool icons with accessible names and tooltips. The working space takes the reclaimed width. On smaller screens, collapsed navigation leaves an Expand control to bring back the full tool list.
- Collapse preference is saved in localStorage and restored when the lecturer returns or refreshes. It never affects student navigation.
- Switching tools or collapsing the rail does not unmount the PDF/PPTX iframe or the persistent LiveKit screen-sharing iframe, so an opened presentation and standby/live screen remain undisturbed.
- If a lecturer chooses browser native fullscreen, only the presentation canvas is fullscreen; toolbars remain available outside fullscreen for changing files. Slides remain centered and are never distorted to fill an incompatible aspect ratio.

Acceptance tests verify toolbar height, real PPTX loaded in embedded viewer, slide display height, collapsible rail width/expanded iframe gain, accessibility labels, preference persistence and loaded file continuity.


## Low-latency animated Word Cloud

The lecturer and projector Word Cloud use a lightweight, room/round-scoped \`cloud-live\` feed instead of reloading every classroom member and answer on every animation frame. A fast word projection is stored separately in Netlify Blobs and updated with compare-and-set when students submit/revise a word or the lecturer hides/restores one. Existing saved question libraries are unaffected.

The active lecturer/projector Word Cloud checks for updates approximately every **640 ms** while visible (slower when the tab is hidden or the connection fails). This is **near-live adaptive polling**, not a continuous WebSocket stream. Network and cloud-function delays may add latency. The standard classroom status loop remains unchanged.

A new browser-side renderer:
- Retains the DOM element for each existing word instead of rebuilding the cloud on every general classroom refresh.
- Animates new words dropping from above, including extra falling arrivals when an already-present word is submitted again.
- Enlarges and pulses repeated words while retaining correct vote/response counts.
- Preserves case-insensitive word aggregation, individual/pair revision behavior, lecturer hide/restore controls, projector reveal, keyboard/mobile layouts and reduced-motion accessibility.
- Caps the display at 75 distinct words and the event animation history at 48 entries. Moderation and current counts are always derived from the current per-student word contribution.

Tests include 55 backend/unit regressions, privacy/permission and concurrent-submission cases, and real Chrome interaction with two students. In the synthetic browser check, the first submitted word appeared after **675 ms**; this is a test observation rather than a guaranteed production latency.


## Whiteboard structured content tools (shapes, text and tables)

The existing lecturer-selected collaborative canvas also supports:

- **Select & Move:** Select an object on the canvas, drag it to a new location, or delete it. Selection does not modify the server until released.
- **Pen, Rectangle, Ellipse, Line and Arrow:** Draw by dragging with the mouse, stylus or touchscreen. Pen color and thickness also style the shapes; a white pen can act as an eraser.
- **Text Box:** Drag to place a bounded text rectangle, type in the dialog, and Save. To edit, choose Select and double-click the box (or select and click Edit selection).
- **Table:** Choose 1–8 rows and 1–8 columns in the toolbar, drag to place the grid, then double-click any cell to enter text. Table cells remain editable later; the selected table can also be moved.
- **Undo / Clear / PNG / Fullscreen:** Original lecturer controls remain available; Undo removes the latest stored item, Clear removes all canvas content, and PNG exports the whiteboard.

All item types are stored in the existing room-scoped Netlify Blobs whiteboard history. Existing freehand strokes remain readable and are rendered alongside structured elements; no conversion of old room data is required. Each create/edit/move/delete operation is bounded, atomically serialized via compare-and-set and rechecks the currently authorized student writer. No extra student tab, account, or PIN is required.

Current limitations: canvas objects are not an infinite-vector design editor; resizing or rotating an existing object is not yet supported, and table dimensions (row/column count) are fixed after insertion. The classroom student roster still allows only one selected student to edit alongside the lecturer. The underlying board refresh still uses near-live polling at approximately 1.7 seconds.


## Focused activity flow: Questions → Live Results → Close activity

**Poll, Live Answers and Word Cloud** have two compact tabs within the same selected lecturer tool:
- **Questions** shows the question form, answer choices (for polls), Save and the saved-question library, all unchanged.
- **Live Results** shows only the active question and its live response chart/list/animated cloud, with result visibility controls and a prominent **Close activity** button. It does not show the preparation form or saved library, so no scrolling past saved questions is necessary.
- Starting a response activity automatically switches the lecturer to Live Results and scrolls the workspace to the top. Selecting Questions temporarily returns to question preparation without stopping the active activity.
- Only the matching tool's active round enables Live Results. Switch tools and return to the live one to resume its focused results screen.
- The existing Timer countdown remains visible while active; other lecturer tools and student screen sharing are unchanged.

**Close activity** is distinct from End room. The lecturer requests \`action=control, control=finish\` against the current active round. The server checks lecturer role and exact active round ID, marks the round closed, and atomically clears the classroom's active round ID. This retains responses for that historical round but rejects new submissions to it. A stale close request cannot remove a newer activity.

The lecturer returns immediately to the selected tool's Questions tab (or initial Timer setup) and can launch another round in the same classroom. On the next student classroom refresh, each student returns to the **Activities home** view and switches to the Activities tab, with the original three fixed student tabs — Activities, Screen Share, Share Work / Problem — still available. Screen-sharing connections are not explicitly torn down.

Automated API tests cover each response tool, ongoing room validity, student submission denial after closure, no stale-round closure and unrelated work submissions. Chromium browser tests cover the complete Questions → Live Results → Close activity journey for all three tools, with the lecturer/learner views and no hidden scrolling dependency.
