# Rewind — Drive Radio (Backend)

A small Node.js/Express server that authorizes once with **your** Google Drive
and then serves your music library (titles, folders-as-playlists, and audio
streams) to the Rewind frontend in `public/index.html`. No links to paste,
no ads — visitors just get a working player.

## 1. Create Google OAuth credentials (you do this, not Claude)

1. Go to https://console.cloud.google.com and create a new project.
2. **APIs & Services → Library** → search "Google Drive API" → **Enable**.
3. **APIs & Services → OAuth consent screen**:
   - User type: External (fine for personal use).
   - Fill in the required app name/email fields.
   - Under "Test users", add your own Google account email.
   - Leave publishing status as "Testing" — that's fine for personal use.
     (Note: in Testing mode Google may expire the refresh token after
     ~7 days if the app sits untouched; if that happens, just revisit
     `/auth` once to get a fresh one. To avoid this entirely, you can set
     the consent screen to "In production" — no verification is required
     for this low-risk read-only scope with a small number of users.)
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Web application**
   - Authorized redirect URI: `https://YOUR-RENDER-URL.onrender.com/auth/callback`
     (you'll get the exact Render URL in step 3 below — come back and add
     it here once you have it)
   - Save. You'll get a **Client ID** and **Client Secret**.

Keep the Client ID/Secret private. Don't paste them into chat with anyone,
including Claude — they go straight into Render's environment variables.

## 2. Push this folder to GitHub

Create a new repo and push these files (`server.js`, `package.json`,
`public/index.html`, etc.) to it. `.env` is git-ignored on purpose — never
commit real secrets.

## 3. Deploy to Render

1. https://render.com → **New → Web Service** → connect your GitHub repo.
2. Build command: `npm install`
3. Start command: `npm start`
4. Under **Environment**, add:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_REDIRECT_URI` = `https://YOUR-RENDER-URL.onrender.com/auth/callback`
   - (leave `GOOGLE_REFRESH_TOKEN` empty for now)
5. Deploy. Render gives you a live URL like `https://rewind-xxxx.onrender.com`.
6. Go back to Google Cloud Console → your OAuth client → make sure the
   redirect URI exactly matches step 4's `GOOGLE_REDIRECT_URI`.

## 4. Authorize your Drive (one-time)

1. Visit `https://YOUR-RENDER-URL.onrender.com/auth` in your browser.
2. Sign in with the Google account whose Drive has your music, and approve
   the read-only Drive permission.
3. You'll land on a page showing a refresh token. Copy it.
4. In Render → your service → Environment, set `GOOGLE_REFRESH_TOKEN` to
   that value, save, and let it redeploy.

That's it — from now on the backend uses this token to read your Drive
without asking you (or any visitor) to log in again.

## 5. Use it

Open `https://YOUR-RENDER-URL.onrender.com/` — your Drive's audio files
show up under "All Tracks", and any Drive folder containing audio becomes
a playlist automatically. Click **Refresh** any time you add new music to
Drive to pull the latest list (no redeploy needed).

## How playback works

`GET /api/tracks` lists every audio file in your Drive (via the Drive API)
and groups them by parent folder name. `GET /api/stream/:fileId` proxies
the actual audio bytes through your server (with Range-header support, so
seeking works), so the browser never needs direct access to your Drive —
only your server does, using the refresh token.

## Local testing (optional)

```
cp .env.example .env
# fill in .env with your real values
npm install
npm start
```
Then open http://localhost:3000
