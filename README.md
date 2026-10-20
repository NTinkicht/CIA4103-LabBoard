# CIA4103 — Smart Lab 09 Board

Browser-only Netlify deployment for Lab 09a and Lab 09b. Eight exact task checkpoints; C#/ASP.NET Razor code highlighting with line numbers; screenshot paste/file/drop; formative code checks; anonymous submissions; two-column live lecturer dashboard with safe preview mode, screenshot zoom, copy code and CSV export.

## Deploy

If Netlify is already linked to this repository, pushes to main trigger deployment. Otherwise, open https://app.netlify.com/ and select Add new project → Import existing project → GitHub → NTinkicht/CIA4103-LabBoard. Choose main; keep build command empty; publish folder is **public**, functions folder **netlify/functions** (both configured by netlify.toml). Netlify installs dependencies automatically; no computer installation, tokens, logins for students or passwords required.

Students: https://YOUR-SITE.netlify.app/
Instructor: https://YOUR-SITE.netlify.app/dashboard/

## Safety and limits

The board is deliberately public and unmoderated, as requested. Do not upload personal information, faces, secrets, credentials, connection strings, or confidential material. Default dashboard previews are hidden until revealed. A password-free endpoint cannot reliably prevent malicious or spam submissions. Screenshots are re-encoded to WebP by Sharp on the server to remove metadata, with 2 MB upload, 12 MP pixel and 1600x1200 output limits.

**Code analysis is a teaching aid, not a Roslyn compiler or actual project build.** It flags likely syntax/form-binding errors but cannot establish whether C# or Razor code compiles, EF Core connects, or an MVC page works. Students must compile/run in Visual Studio to verify functionality.

Before observation, submit one sample from the student page, including a screenshot and C# snippet with a missing semicolon; check dashboard and filter functionality. Runtime integration with live Netlify Blobs still requires deployment testing.

## Live refresh troubleshooting (2026-10-19)

The dashboard checks for new submissions every five seconds, including while a code or screenshot is enlarged. It now shows LIVE after a successful request or OFFLINE with a clear error when polling fails. Background browser tabs may throttle timers; the board catches up automatically when visible again.

Test without installing anything: keep the teacher dashboard visible, submit a test snippet from another browser tab, and check the LIVE time and new card within about 5–10 seconds. If it displays OFFLINE, inspect the Netlify project's **Logs & metrics → Functions → posts**. Visit `/api/posts?part=all&range=4h` to check that the API returns a `posts` array. Make sure the site has published the latest GitHub commit.

## Lecturer dashboard: dismiss an answered topic

Each classroom submission has a **Dismiss — answered** button. Dismiss it after discussion to remove it from the active **I need help with** or **I display** column; it remains hidden during 5-second auto-refresh and after a page reload. Click **Show dismissed** to review dismissed posts and **Restore to active** to bring one back. Both actions are also available when a post is enlarged. The counter labelled **Dismissed in this filter** changes with the task/time filters.

Dismissal is intentionally **browser-local** (localStorage), because the board has no authentication. It is not a remote delete or classroom-wide status: another computer/browser will still see all posts until dismissed there. Private browsing, cleared browser storage, or blocked localStorage can lose the dismissed view. Original posts and screenshots remain in Netlify Blobs and CSV export, and are not deleted.

Test: submit a screenshot or snippet, open the dashboard, click **Dismiss — answered**, wait for at least two auto-refresh intervals, reload, then click **Show dismissed → Restore to active**. Verify the card reappears in the active view and can still be exported.

## Optional names · lab PDFs · live screen sharing (October 2026)

### Students: optional name

Posts under **I need help with** or **I display** have an optional Name field (up to 60 characters). Leaving it blank remains anonymous. Names appear to anyone visiting the public dashboard and in CSV export; students should enter a name only if they want it displayed. Screenshot rules and public privacy warnings remain in effect.

On **/live/** students can voluntarily share their current screen or Visual Studio window. They may optionally enter a name and choose the relevant Lab 09a/09b task. The operating-system picker requires their explicit click and permission every time; the stream stops if they click Stop, stop sharing from the browser or close the page. Other students are granted publish-only connections and cannot subscribe to classmates' video.

### Lecturer: PDFs inside dashboard

Open **/dashboard/** and choose **Lab PDFs**. Choose `Lab09a.pdf` and `Lab09b.pdf` using the two file selectors, **once per browser**. Both PDFs are stored locally in IndexedDB under that browser/site origin (not uploaded or published). Switch between the Lab 09a, Lab 09b, Student submissions and Live Screens tabs without leaving the dashboard. Browser PDF viewer supports built-in zoom, print and page navigation. Browser storage clearing/private mode may erase local copies. This PDF workflow needs **no keys, accounts or software installations**. To make these PDFs available automatically on other computers, static PDF assets must be uploaded to GitHub separately.

### Lecturer: optional protected Live Screens (requires setup)

Live video is **NOT activated until configured**. Create a LiveKit Cloud project or authorized LiveKit deployment, then add the following four variables in **Netlify → Project configuration → Environment variables** and include Functions scope:

| Variable | Value |
|---|---|
| `LIVEKIT_URL` | LiveKit WSS URL, such as `wss://<your-project>.livekit.cloud` |
| `LIVEKIT_API_KEY` | LiveKit API key (server-side secret) |
| `LIVEKIT_API_SECRET` | LiveKit API secret (server-side secret) |
| `CIA4103_TEACHER_PIN` | Private, unpredictable lecturer code of **12+ characters** (do not share with students) |

Redeploy after adding variables. Open the **Live Screens** dashboard tab, enter the lecturer PIN and connect. Students open **/live/**, choose their optional display name and task, and click **Share my screen**. Your dashboard receives their streams and lists participant names. All sessions are in one classroom room, and video is not recorded by this application. No LiveKit API secret or lecturer PIN is shipped to the student.

**Security constraints:** The student website and textual board remain public and unmoderated, so avoid identifiable, sensitive or confidential content. Screen viewing is protected by a private lecturer PIN and server-minted short-lived subscribe-only LiveKit tokens. Keep the PIN long and unpredictable. Do not project the PIN or LiveKit credentials. The browser/IT policies of your institution may still block capture or WebRTC. LiveKit cloud usage may incur charges under your chosen plan. Test on the actual HCT network before class. Only screen sharing—not screenshots, code snippets or PDFs—needs the optional LiveKit setup.

**Important:** Remote LiveKit streaming has not been integration-tested against your personal LiveKit deployment; it requires the four environment values and a real student/teacher browser test.

### Checklist

1. Student posts with no name → dashboard displays Anonymous; with a name → name shown and exported.
2. Lecturer uploads the Lab 09a and Lab 09b PDFs; switches tabs, reloads page and sees both PDFs in the viewer.
3. Optional LiveKit: student starts a stream only after a real browser picker; lecturer connects with PIN and receives only the selected screen.
4. Student ends sharing; lecturer video disappears. A wrong PIN must not receive a subscribe token.
5. HCT security/firewall policies and browser permissions must be tested before class.
