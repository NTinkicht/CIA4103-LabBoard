# CIA4103 Smart Classroom Board

An educational, non-commercial classroom discussion board for ASP.NET Core, C#, Razor, and other programming labs. Built for student demonstrations and lecturer-led formative assessment.

**Student website:** https://cia4103.netlify.app/  
**Lecturer dashboard:** https://cia4103.netlify.app/dashboard/  
**Student screen sharing:** https://cia4103.netlify.app/live/

## Student workflow

1. Enter your **name** (required, 1–60 characters).
2. Enter **any lab or activity** as free text (required, 1–100 characters); it is not limited to CIA4103 or Lab 09.
3. Select **I need help with** or **I display**.
4. Paste code, attach one screenshot, or describe the problem or result.
5. Use **Check My Code** if desired; the board automatically guesses C#, ASP.NET Razor, HTML, CSS or SQL from the snippet.
6. Click **Share to board**. Code and screenshots appear on the instructor dashboard.

The code checker is a *heuristic teaching aid*, **not** Roslyn, a real compiler, or a guarantee that a project runs. Known Lab 09 task descriptions still trigger task-specific hints.

An obvious **Share my screen** button on the student home page opens the voluntary LiveKit screen-sharing page. Only the student name is required on the screen-sharing page; no lab/activity field is shown there. The browser must explicitly ask the student which tab, window, or screen to share. Clicking Stop sharing (or stopping through the browser) ends the capture. The application does not record screen video.

### Privacy notice

This classroom board currently has **no login**. Submissions, names, code and screenshot attachments are viewable by anyone with the public dashboard link. Enter a display name only if your instructor has asked you to and you accept that exposure. Do not post names beyond what is required, confidential data, passwords, API keys, personal information, faces or sensitive school information. The screen-stream viewer is separate and requires an authenticated lecturer token.

## Lecturer dashboard

- **Student submissions:** automatic refresh approximately every 5 seconds; code highlighting, screenshots, copy, filters generated dynamically from submitted activity descriptions, CSV export, presentation mode, and browser-local Dismiss / Restore.
- **Lab PDFs:** start with one empty document tab. Click **+ Add PDF** to upload any PDF up to 20 MB, creating a new tab labelled by its filename. Repeat as often as needed. Additions are stored in the instructor browser's IndexedDB and survive page reloads, unless browser data is cleared. Existing PDFs saved using the former fixed Lab 09a/09b tabs are preserved and shown as documents. PDFs are **not uploaded to Netlify**.
- **Live Screens:** lists screen sharers and shows screen video after the lecturer connects using a private PIN; a separate LiveKit account/project and server credentials are required.

**Dismissed topics** stay hidden only in the same browser, never deleted globally. There is no unauthenticated server-wide deletion endpoint.

## Deployment without installing anything locally

1. Open https://app.netlify.com/ → import this GitHub repository or open the existing connected project.
2. Keep the default branch \`main\`. Netlify uses the repository's \`netlify.toml\` (\`public\` publish directory and \`netlify/functions\`).
3. Publish. Open the main student page, teacher dashboard and \`/api/live-status\`.
4. Confirm the Netlify project visibility is Public if students cannot reach it. **A successful GitHub commit does not mean Netlify deployed it.** Netlify can pause deployments when the team's deploy credits run out.

The text board and PDF viewer do **not** require LiveKit credentials.

### Activate secure LiveKit screen sharing

In **Netlify → Project configuration → Environment variables**, add these values for **Functions** and the **Production** deploy context:

| Variable | Description |
|---|---|
| \`LIVEKIT_URL\` | WebSocket URL from LiveKit Cloud, such as \`wss://<project>.livekit.cloud\` |
| \`LIVEKIT_API_KEY\` | Private API key from the LiveKit project |
| \`LIVEKIT_API_SECRET\` | Private API secret from the same project |
| \`CIA4103_TEACHER_PIN\` | Strong private lecturer PIN, **at least 12 characters** |

Do **not** add actual secrets to GitHub, public PDFs, or screenshots. Redeploy **after** saving all four settings. \`/api/live-status\` responds with \`{"enabled":true}\` only when the deployed Netlify Functions can read all four and the PIN is 12+ characters. If it reports \`false\`, check spelling, the Functions scope, Production context, and the **Published** deployment. A wrong PIN returns an access error; "not configured" means the backend cannot see a complete valid configuration.

### Troubleshooting “invalid API key” or “Unable to initialize secure screen sharing”

These errors indicate **LiveKit credential validation or token creation failed**, not a problem with the student's browser sharing permission. The lecturer connection now checks credentials against LiveKit Cloud before issuing a room token, and reports an actionable error without revealing secrets.

1. Open LiveKit Cloud → **CIA4103-LabBoard → API Keys**. Generate a new **matching API key and API secret pair** in the same project. Do not mix credentials from different projects.
2. In Netlify → **Project configuration → Environment variables**, confirm `LIVEKIT_URL` is the exact WebSocket URL of that project, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` match the new pair, and `CIA4103_TEACHER_PIN` is a private value at least 12 characters long.
3. Check **Functions** scope and **Production** context. Avoid extra spaces, surrounding quotes, and newlines. Secrets belong only in Netlify, not GitHub or the browser.
4. **Redeploy**; old deployments retain their existing environment. If Netlify production deployments are paused because of billing credits, the fix cannot take effect until deployment resumes.
5. First open `/api/live-status` (it only confirms variable presence, not whether keys are valid). Then connect from the lecturer dashboard, which performs a real LiveKit authorization check, and finally click Share from the student browser.

If LiveKit still rejects fresh credentials, check LiveKit Project Settings for the exact host and contact LiveKit support; do not send keys or secrets in screenshots.

The lecturer enters the PIN only in the dashboard. Server-minted LiveKit permissions allow students to publish a screen track but **not** subscribe to another student's video. Never expose API secrets in browser JavaScript. Live screen streaming also depends on the HCT browser/network allowing screen capture and WebRTC; test with two separate computers or browsers.

## Implementation and verification

- Static pages: \`public/\`.
- Code detection and teaching-aid diagnostics: \`public/assets/checker.mjs\`.
- Anonymous storage layer: \`netlify/functions/posts.mjs\` and Netlify Blobs.
- LiveKit auth: \`netlify/lib/live-auth.mjs\` and token/status/participant functions.
- Local instructor PDF tabs: \`public/assets/lab-pdfs.mjs\`.
- Regression checks: \`npm test\` in a development environment.

The source is MIT licensed. Please read [LICENSE](LICENSE) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) before contributing. The original authors retain ownership of their works; the license does not cover third-party content or students' personal data.

## Lecturer-controlled, single-presenter screen sharing

The Live Screens tab now gives the lecturer a large 72vh application-window viewer and a right-hand queue of connected students. Students select **Request to share** to join the queue. Their default LiveKit token has **no permission to publish or subscribe**. Names are required, and no lab/activity field is shown on the live screen-sharing page.

The lecturer connects with their PIN, sees connected students, and presses **Approve & show** next to one. The server revokes all existing student publish permissions before granting **screen-share-only** publishing permission to the chosen participant. LiveKit unpublishes previous screen tracks on permission revocation. **Stop current share** revokes publishing from everyone. The server uses a short-lived Netlify Blobs distributed lease to serialize lecturer approvals; if it cannot establish an exclusive permission state, it fails closed. Only one student should be authorized at once. The backend action is `POST /api/live-control` and requires the lecturer PIN; never publish that PIN.

After approval, **the student must click Share application window**. Browsers require direct user activation for screen capture. The application requests a Window capture with `monitorTypeSurfaces: 'exclude'`, then checks the actual `MediaStreamTrack.getSettings().displaySurface`. Only **window** is accepted; monitor, browser-tab and unknown surface results are stopped without being published. Note that the browser may still show additional choices in its native picker; the application rejects them afterward. Some browsers do not expose the surface value and will therefore be unable to share under this strict policy.

Multiple students remain connected in the waiting list. Switching to another student automatically revokes the previous presenter, stops their stream, and authorizes the selected student. The new student must click their button to select an application window. Switching between the lecturer app's **Student submissions**, **Lab PDFs**, and **Live Screens** tabs does not disconnect the room. Student screen-sharing stays active when switching browser tabs or working in the shared application **while the sharing page remains open**. Closing the shared app window, closing the sharing tab, browser security prompts or HCT policies can still end a stream; background tab operation depends on browser policies.

The green CBE 5Es badges were removed from the student and lecturer dashboard pages. The local PDF viewer now accepts PDF files **up to 50 MB**, subject to browser IndexedDB quota. Files remain local.

### Quick smoke test

1. Confirm Netlify published the latest GitHub commit. Keep student, lecturer and application windows open.
2. In a student browser, enter a name, click **Request to share**. The student stays waiting and **Share application window** remains disabled.
3. On the lecturer dashboard, connect with PIN. The student appears in the waiting queue. Press **Approve & show**.
4. Student sees authorization, clicks **Share application window**, selects the Visual Studio window in the browser picker. Verify video in the large lecturer panel.
5. Try to select Entire Screen or a browser tab — this must be rejected (share immediately stopped).
6. Connect a second student. The first remains visible while the second waits. The lecturer clicks **Approve & show** for the second student; the first stops publishing. Second student selects their own window and becomes the sole active presenter.
7. Switch the lecturer dashboard to PDFs and back, and switch the student to the shared application. The live stream should remain connected while the page stays open.
8. Click **Stop current share**. Both students remain connected but none can publish until authorized again.
9. Upload a PDF close to 50 MB from the lecturer viewer. This is a browser-local upload; it may fail if the school's browser quota is smaller.

Real LiveKit and Netlify integration is not exercised by source-code tests; verify with two student browser sessions and the actual teaching environment before relying on it in a class observation.

## Low-bandwidth standby screen switching (proposed release)

The lecturer selects exactly one student screen to display. When A is switched to standby and B is selected, **A's LiveKit video publication calls `pauseUpstream()`**. A's browser capture track remains alive in A's browser, but **video frames stop being uploaded to LiveKit** once the pause completes. The lecturer unsubscribes from A before subscribing to B. Switching back to A triggers `resumeUpstream()` on A's existing publication, with **no new browser `getDisplayMedia()` prompt**, provided the student hasn't stopped the capture, closed the sharing page/window, or revoked permission.

The lecturer list shows **ON SCREEN**, **Selected · Resuming video**, **STANDBY · Upload paused**, **STANDBY · No window yet**, and **Waiting for approval**. `Put on standby` hides the selected presenter and causes them to pause upstream. The application still limits viewing to one screen at a time, and students cannot subscribe to each other.

**Important privacy boundary:** The student's chosen application remains captured **locally**, and the browser screen-sharing indicator remains visible during standby. The selected application is **not uploaded to LiveKit while pauseUpstream is in effect**. This is not equivalent to closing/stopping screen capture. The student can stop sharing at any time; if they stop it entirely, a new window selection and permission prompt are required (browsers do not permit invisible reauthorization). If the LiveKit pause operation fails, the app stops the capture rather than continuing an unapproved standby transmission. The selected application and sharing tab must stay open. Some browsers suspend inactive tabs, so test on the HCT PCs.

The LiveKit room and student publish permission remain active through selection changes; server metadata selects the presenter, then each student client serializes its own pause/resume operations. The lecturer joins with `autoSubscribe:false` and subscribes only to the selected stream. **Metadata propagation is asynchronous:** the student pause and resumed stream may have a short transition delay. A strict frame-level guarantee that no two upstream connections ever overlap would need an explicit pause acknowledgement protocol, not just metadata state changes. Only **one stream is displayed** in the lecturer UI.

### Manual acceptance checks before merging

1. A requests approval, selects a Visual Studio application window and shares.
2. B requests approval; the lecturer selects B. A shows **STANDBY · Upload paused**. Verify A's browser capture indicator stays active, but LiveKit video upload pauses. B chooses an application window.
3. Return to A: A's existing stream resumes without another browser source picker.
4. Use *Put on standby*: no stream is shown; all previously selected captures remain locally alive but paused upstream.
5. Stop A's capture in its own browser, then select A again: a **new** window-selection prompt is required.
6. Switch tabs and apps while keeping the shared window and student sharing page open. Test the browser's background-tab behaviour.
7. Verify the lecturer subscribes to at most one video track and students cannot subscribe to others.
8. Simulate pauseUpstream failure; the student client should stop capture rather than silently continue uploading in standby.

Do not merge the draft PR or incur a production deploy until a two-student real LiveKit test and the user's approval.
