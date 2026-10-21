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
