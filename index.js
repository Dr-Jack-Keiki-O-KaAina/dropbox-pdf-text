import express from "express";
import fetch from "node-fetch";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");   // Use CJS require for pdf-parse

const app = express();
app.use(express.json({ limit: "50mb" }));

const API_KEY = process.env.API_KEY;
const DROPBOX_APP_KEY = process.env.DROPBOX_APP_KEY;
const DROPBOX_APP_SECRET = process.env.DROPBOX_APP_SECRET;
const DROPBOX_REFRESH_TOKEN = process.env.DROPBOX_REFRESH_TOKEN;

// Function to get a new short-lived Dropbox token
async function getDropboxAccessToken() {
  const creds = Buffer.from(`${DROPBOX_APP_KEY}:${DROPBOX_APP_SECRET}`).toString("base64");

  const resp = await fetch("https://api.dropboxapi.com/oauth2/token", {
    method: "POST",
    headers: {
      "Authorization": `Basic ${creds}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: DROPBOX_REFRESH_TOKEN
    })
  });

  if (!resp.ok) {
    throw new Error(`Failed to refresh Dropbox token: ${resp.status} ${await resp.text()}`);
  }

  const data = await resp.json();
  return data.access_token;
}

// Health check route
app.get("/", (_req, res) => {
  res.json({ ok: true, service: "Dropbox PDF Text Extractor with Auto Token Refresh" });
});

// PDF text extraction route
app.post("/dropbox/pdf-text", async (req, res) => {
  try {
    if (!API_KEY || req.header("X-Api-Key") !== API_KEY) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { path } = req.body || {};
    if (!path) {
      return res.status(400).json({ error: "Missing 'path' in JSON body" });
    }

    // Get a fresh token every request
    const accessToken = await getDropboxAccessToken();

    const dl = await fetch("https://content.dropboxapi.com/2/files/download", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Dropbox-API-Arg": JSON.stringify({ path })
      }
    });

    if (!dl.ok) {
      const details = await dl.text().catch(() => "");
      return res.status(dl.status).json({ error: "Dropbox download failed", details });
    }

const buffer = Buffer.from(await dl.arrayBuffer());
const parsed = await pdfParse(buffer);

// Full text and "blank PDF" check
const fullText = parsed.text || "";
if (!fullText.trim()) {
  return res.status(400).json({ error: "PDF appears to be empty" });
}

// Optional chunking controls
const { maxChars, charOffset } = req.body || {};
const start = Number.isInteger(charOffset)
  ? Math.max(0, charOffset)
  : (charOffset ? Math.max(0, parseInt(charOffset, 10) || 0) : 0);

const limit = Number.isInteger(maxChars)
  ? maxChars
  : (maxChars ? parseInt(maxChars, 10) || null : null);

// Slice the requested chunk
let out = fullText.slice(start, limit ? start + limit : undefined);

// If the requested chunk is empty (e.g., offset too large), return a clear error
if (!out.trim()) {
  return res.status(400).json({ error: "No text at this offset (try a smaller charOffset)" });
}

const nextCharOffset = start + out.length < fullText.length ? start + out.length : null;
const hasMore = nextCharOffset !== null;

return res.json({
  path,
  numPages: parsed.numpages,
  text: out,
  chars: out.length,
  hasMore,
  nextCharOffset
});

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error", details: String(e) });
  }
});

// List a Dropbox folder (uses auto-refresh token)
app.post("/dropbox/list-folder", async (req, res) => {
  try {
    if (!API_KEY || req.header("X-Api-Key") !== API_KEY) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const { path = "", recursive = false, include_non_downloadable_files = true } = req.body || {};

    const accessToken = await getDropboxAccessToken();

    const resp = await fetch("https://api.dropboxapi.com/2/files/list_folder", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ path, recursive, include_non_downloadable_files })
    });

    if (!resp.ok) {
      return res.status(resp.status).json({ error: "Dropbox list failed", details: await resp.text() });
    }
    res.json(await resp.json());
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error", details: String(e) });
  }
});
 
const port = process.env.PORT || 3000; // Bind to Render's PORT
app.listen(port, () => console.log("PDF text server on :" + port));
