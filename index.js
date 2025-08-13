import express from "express";
import pdfParse from "pdf-parse";

const app = express();
app.use(express.json({ limit: "50mb" }));

const API_KEY = process.env.API_KEY;             // set on Render
const DROPBOX_TOKEN = process.env.DROPBOX_TOKEN; // set on Render

// health/ping
app.get("/", (_req, res) => {
  res.json({ ok: true, service: "Dropbox PDF Text Extractor", endpoints: ["/dropbox/pdf-text"] });
});

app.post("/dropbox/pdf-text", async (req, res) => {
  try {
    if (!API_KEY || req.header("X-Api-Key") !== API_KEY) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const { path } = req.body || {};
    if (!path) return res.status(400).json({ error: "Missing 'path' in JSON body" });

    const dl = await fetch("https://content.dropboxapi.com/2/files/download", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${DROPBOX_TOKEN}`,
        "Dropbox-API-Arg": JSON.stringify({ path })
      }
    });

    if (!dl.ok) {
      const details = await dl.text().catch(() => "");
      return res.status(dl.status).json({ error: "Dropbox download failed", details });
    }

    const buffer = Buffer.from(await dl.arrayBuffer());
    const parsed = await pdfParse(buffer); // { text, numpages, ... }

    res.json({ path, numPages: parsed.numpages, text: parsed.text });
  } catch (e) {
    res.status(500).json({ error: "Server error", details: String(e) });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("PDF text server on :" + port));
