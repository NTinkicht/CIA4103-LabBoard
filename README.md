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
