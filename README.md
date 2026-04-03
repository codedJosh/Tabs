# JADE Debate Tab

A premium static website app for managing debate tournaments with support for:

- Opening and closing tournaments
- Public or hidden standings
- System administrators, tab managers, judges, and debaters
- Judge feedback submission
- Email-based tab manager permissions
- Private debater URLs for draw and standings access
- Team standings that can follow BP team points or AP/World Schools win-loss point models
- Separate speaker-score rankings for both team and individual tournaments
- Round-by-round structure planning so different rounds can use different team counts and team sizes
- British Parliamentary, American Parliamentary, JADE Parliamentary, Iron Person British Parliamentary, and World Schools formats
- No Standard Format tournaments with custom rules and structure
- Team-based, individual, and hybrid participation models
- Optional cross-examination scoring with questions out of 20 and responses out of 40
- Optional rebuttal scoring out of 50
- Password-based sign-in for every account
- A forgot-password request flow that sends recovery requests to the manager dashboard
- Self sign-up so users can create their own passwords
- A manager-controlled settings area for branding, security, portal behaviour, feedback defaults, and tournament defaults
- A redesigned sign-in experience with built-in forgot-password requests
- A compact private debater portal designed to feel clear, premium, and calm for competitors
- A dedicated competitor-only signed-in dashboard that hides manager controls and keeps navigation compact
- A focused per-tournament tab room with team creation, speaker registration, draw generation, round release, and standings review
- Draw methods for random pairing, power pairing, and folded rounds
- A live round control board with release status, ballot progress, judge check-ins, room readiness, and debate priority
- Debate-priority-aware judge allocation so stronger rooms can receive stronger panels first
- Optional public team aliases or code names for published boards and public-facing views
- Tournament appointee dashboards with role changes and removals directly inside the People area
- Manager tools for account creation, password resets, tournament duplication, invitation handling, and deletion of tournaments or users
- A built-in About page shaped around JADE’s public mission and tournament-development focus

## Run it locally

The app runs from these local files:

- [index.html](/Users/jo/Documents/New%20project/index.html)
- [jade-logo.jpg](/Users/jo/Documents/New%20project/jade-logo.jpg)

Open [index.html](/Users/jo/Documents/New%20project/index.html) directly in your browser. The app keeps its CSS and JavaScript in that file and uses the included JADE logo image for branding.

## Publish it as a website

This project is now packaged for static hosting.

Included website files:

- [index.html](/Users/jo/Documents/New%20project/index.html)
- [site.webmanifest](/Users/jo/Documents/New%20project/site.webmanifest)
- [robots.txt](/Users/jo/Documents/New%20project/robots.txt)
- [netlify.toml](/Users/jo/Documents/New%20project/netlify.toml)
- [_redirects](/Users/jo/Documents/New%20project/_redirects)
- [_headers](/Users/jo/Documents/New%20project/_headers)
- [vercel.json](/Users/jo/Documents/New%20project/vercel.json)

## Vercel publish path

This is the recommended hosting path for the current project.

1. Import the GitHub repository into Vercel.
2. Leave the root directory as the project root.
3. No framework preset is required.
4. If Vercel asks for build settings, keep them minimal:
   - Root directory: repository root
   - Framework preset: `Other`
   - Build command: leave blank
   - Output directory: leave blank
5. Deploy the project.

Vercel files already included:

- [vercel.json](/Users/jo/Documents/New%20project/vercel.json)
- [package.json](/Users/jo/Documents/New%20project/package.json)
- `api/jade-cloud.mjs` for shared cloud auth, private-link login, and workspace sync
- `api/ping.mjs` as a lightweight deployment check

Private access links and account access links use the live site URL automatically once the website is opened from its real hosted domain.

## Supabase cloud setup

Use Supabase as the shared database behind the Vercel site.

1. Create a Supabase project.
2. In Supabase SQL Editor, run [supabase/jade-workspace.sql](/Users/jo/Documents/New%20project/supabase/jade-workspace.sql).
3. In Vercel, open your project settings and add these environment variables:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `JADE_SESSION_SECRET`
   - optional: `JADE_WORKSPACE_ID`
   - optional: `JADE_SUPABASE_TABLE`
4. Redeploy the site on Vercel.
5. Open the website from the original manager device that already has your current local JADE data.
6. Sign in as a `System Manager`.
7. JADE will initialize the shared cloud workspace from that existing local manager device the first time you sign in.
8. After that, manager-created accounts, password sign-in, and one-tap private access links will work across devices against the same shared workspace.

If your old JADE data lives under a different origin, such as a local file or an older local-only version, that old browser storage will not automatically carry over to the live domain. In that case:

1. Open the original JADE instance that still has your real data.
2. Go to `Settings`.
3. Use `Download Full Backup`.
4. Open the live Vercel website.
5. On the sign-in page, use `Initialize Cloud From Backup`.
6. Upload the backup JSON and sign in with your system-manager credentials to publish that workspace into Supabase.

Recommended `JADE_SESSION_SECRET`:

- use a long random string
- 32+ characters minimum
- keep it only in Vercel environment variables

## Demo accounts

- Manager: `joshuaatkins374@gmail.com`
- Manager password: `manager@debate.com`
- Sample tab manager: `tab@debate.org` / `tab@debate.com`
- Sample judge: `judge@debate.org` / `judge@debate.com`
- Sample debater: `debater@debate.org` / `debater@debate.com`

## Notes

- Without Vercel Functions and Supabase configured, JADE still falls back to browser `localStorage`.
- With Vercel Functions and Supabase configured, JADE can use a shared cloud workspace so accounts, tournaments, private links, and manager-created users work across devices.
- Each signed-in account now has its own private access URL, and managers can also copy or rotate access URLs for other users.
- Hidden standings stay off the public dashboard but remain visible inside the debater's private link.
- The global manager account is fixed to `joshuaatkins374@gmail.com`.
- New users can sign up with their own email and create a password.
- The manager can create staff accounts, review forgot-password requests, reset passwords, duplicate tournaments as templates, remove users, and copy invitation messages from the app.
- Team tournaments can keep team standings and speaker rankings separate, so speakers still receive speaker scores while teams are ranked on the correct team-point model.
- Tournament structures can vary by round, so admins are not locked into one room or team format for the whole event.
- Draw rooms can now track priority, room check-ins, judge check-ins, and ballot return status without leaving the tournament workspace.
- The private portal now prioritizes each competitor's own round, standing snapshot, and feedback before exposing any full published boards.
- The current cloud mode is designed to make JADE multi-device and deployable quickly; deeper server-side permission hardening per action can still be added later if you want a stricter production security layer.
