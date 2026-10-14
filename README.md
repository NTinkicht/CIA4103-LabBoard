# CIA4103 – Anonymous Lab Board

An anonymous, live discussion board for Chapter 07 (.NET 8 / EF Core lab). Students choose a lab part and post either **I need help with** (error/problem) or **I display** (a code example). Lecturer projects `/dashboard/` to see the two columns update automatically.

## Browser-only Netlify deployment

1. Open https://app.netlify.com/ and choose **Add new project → Import an existing project → GitHub**.
2. Select the **NTinkicht/CIA4103-LabBoard** repository. Authorize Netlify for this private repository if prompted.
3. Netlify reads `netlify.toml`: publish folder **public**, functions folder **netlify/functions**. Leave the build command blank.
4. Click **Deploy**. No local tools, installers, environment variables or passwords are needed.
5. Students visit `/`; project `/dashboard/` on your screen.

### Privacy note

Posts contain no required name, account or group identifier. The board is **public, unmoderated, and password-free**; anyone who finds the site could view or submit text. Students must never post personal data, credentials, secrets or private source code. Standard Netlify platform request logs may still contain network metadata.

## Verify before the observation

Submit a sample error on the student page, open `/dashboard/`, and confirm it appears on the left within five seconds. Submit a small C# snippet and confirm it appears on the right. Select each of the four mini-labs to filter. Keep the student URL ready for a QR code later.
