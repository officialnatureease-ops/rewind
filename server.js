require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');

const app = express();
app.use(cors());

const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI,
  GOOGLE_REFRESH_TOKEN,
  PORT = 3000
} = process.env;

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
  console.warn('[warning] Missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI env vars.');
}

const oauth2Client = new google.auth.OAuth2(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI
);

if (GOOGLE_REFRESH_TOKEN) {
  oauth2Client.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
}

const drive = google.drive({ version: 'v3', auth: oauth2Client });
const SCOPES = ['https://www.googleapis.com/auth/drive.readonly'];

function requireAuth(req, res, next) {
  if (!GOOGLE_REFRESH_TOKEN) {
    return res.status(401).json({ error: 'Backend not authorized yet. Visit /auth once, then set GOOGLE_REFRESH_TOKEN.' });
  }
  next();
}

// ---- Step 1: owner visits this ONCE to grant Drive access ----
app.get('/auth', (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES
  });
  res.redirect(url);
});

// ---- Step 2: Google redirects back here with the refresh token ----
app.get('/auth/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.status(400).send('Google returned an error: ' + error);
  if (!code) return res.status(400).send('Missing code.');
  try {
    const { tokens } = await oauth2Client.getToken(code);
    if (!tokens.refresh_token) {
      return res.send(
        '<h2>No refresh token returned</h2>' +
        '<p>You likely already authorized this app before. Go to ' +
        '<a href="https://myaccount.google.com/permissions" target="_blank">Google Account &rarr; Third-party access</a>, ' +
        'remove access for this app, then visit <code>/auth</code> again.</p>'
      );
    }
    res.send(
      '<h2>Success — copy this refresh token</h2>' +
      '<p>Add it to your Render service as an environment variable named <b>GOOGLE_REFRESH_TOKEN</b>, then redeploy. ' +
      'Keep it secret — anyone with it can read your Drive.</p>' +
      '<textarea style="width:100%;height:90px;font-family:monospace;">' + tokens.refresh_token + '</textarea>'
    );
  } catch (err) {
    console.error(err);
    res.status(500).send('Auth failed: ' + err.message);
  }
});

// resolve a set of folder IDs -> folder names
async function getFolderNames(folderIds) {
  const names = {};
  await Promise.all(Array.from(folderIds).map(async (id) => {
    try {
      const r = await drive.files.get({ fileId: id, fields: 'id,name' });
      names[id] = r.data.name;
    } catch (e) {
      names[id] = null;
    }
  }));
  return names;
}

// ---- List every audio file in the owner's Drive, grouped by folder ----
app.get('/api/tracks', requireAuth, async (req, res) => {
  try {
    let files = [];
    let pageToken = null;
    do {
      const r = await drive.files.list({
        q: "mimeType contains 'audio/' and trashed = false",
        fields: 'nextPageToken, files(id, name, mimeType, parents)',
        pageSize: 200,
        pageToken
      });
      files = files.concat(r.data.files || []);
      pageToken = r.data.nextPageToken || null;
    } while (pageToken);

    const folderIds = new Set();
    files.forEach((f) => { if (f.parents && f.parents[0]) folderIds.add(f.parents[0]); });
    const folderNames = await getFolderNames(folderIds);

    const tracks = files.map((f) => ({
      id: f.id,
      title: f.name.replace(/\.[^/.]+$/, ''),
      folder: f.parents && f.parents[0] ? (folderNames[f.parents[0]] || null) : null
    }));

    res.json({ tracks });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ---- Stream a file's audio bytes, with Range support so seeking works ----
app.get('/api/stream/:fileId', requireAuth, async (req, res) => {
  const { fileId } = req.params;
  try {
    const meta = await drive.files.get({ fileId, fields: 'mimeType, name' });
    res.setHeader('Content-Type', meta.data.mimeType || 'audio/mpeg');
    res.setHeader('Accept-Ranges', 'bytes');

    const driveRes = await drive.files.get(
      { fileId, alt: 'media' },
      {
        responseType: 'stream',
        headers: req.headers.range ? { Range: req.headers.range } : {}
      }
    );

    if (req.headers.range && driveRes.headers['content-range']) {
      res.status(206);
      res.setHeader('Content-Range', driveRes.headers['content-range']);
      if (driveRes.headers['content-length']) {
        res.setHeader('Content-Length', driveRes.headers['content-length']);
      }
    }

    driveRes.data.pipe(res);
    driveRes.data.on('error', (e) => {
      console.error('stream error', e);
      res.end();
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Stream error: ' + err.message);
  }
});

app.use(express.static('public'));

app.listen(PORT, () => console.log('Rewind backend listening on port ' + PORT));
