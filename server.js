require("dotenv").config();
const express = require("express");
const multer = require("multer");
const mammoth = require("mammoth");
const { v4: uuidv4 } = require("uuid");
const { execFile } = require("child_process");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

// --- Folders -------------------------------------------------------------
const STORAGE_DIR = path.join(__dirname, "storage");
const UPLOADS_DIR = path.join(STORAGE_DIR, "uploads");
const PRESENTATIONS_DIR = path.join(STORAGE_DIR, "presentations");

for (const dir of [STORAGE_DIR, UPLOADS_DIR, PRESENTATIONS_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

// --- LibreOffice ---------------------------------------------------------
function findSoffice() {
  if (process.env.SOFFICE_PATH && fs.existsSync(process.env.SOFFICE_PATH)) {
    return process.env.SOFFICE_PATH;
  }
  const candidates = [
    "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
    "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
    "/usr/bin/soffice",
    "/usr/local/bin/soffice",
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return "soffice";
}

const SOFFICE = findSoffice();
let conversionBusy = false; // one LibreOffice conversion at a time

let convertingLock = false; // one LibreOffice conversion at a time

function convertPptxToPdf(pptxPath, outDir) {
  return new Promise((resolve, reject) => {
    execFile(
      SOFFICE,
      ["--headless", "--convert-to", "pdf", "--outdir", outDir, pptxPath],
      { timeout: 180000 },
      (error, stdout, stderr) => {
        const pdfPath = path.join(
          outDir,
          path.basename(pptxPath, path.extname(pptxPath)) + ".pdf"
        );
        if (fs.existsSync(pdfPath)) {
          resolve(pdfPath);
        } else if (error && error.killed) {
          reject(
            new Error("კონვერტაცია შეწყდა დროის ამოწურვით (3 წთ). სცადეთ უფრო მცირე ფაილი.")
          );
        } else {
          reject(
            new Error(
              "LibreOffice-მ კონვერტაცია ვერ შეასრულა. " +
                "შეამოწმეთ, რომ LibreOffice დაინსტალირებულია. " +
                (stderr || error ? "დეტალები: " + (stderr || error.message) : "")
            )
          );
        }
      }
    );
  });
}

// --- Manifest helpers ------------------------------------------------------
function manifestPath(presDir) {
  return path.join(presDir, "manifest.json");
}

function readManifest(presDir) {
  return JSON.parse(fs.readFileSync(manifestPath(presDir), "utf8"));
}

function writeManifest(presDir, manifest) {
  fs.writeFileSync(manifestPath(presDir), JSON.stringify(manifest, null, 2), "utf8");
}

function patchManifest(presDir, patch) {
  const m = readManifest(presDir);
  Object.assign(m, patch);
  writeManifest(presDir, m);
  return m;
}

// --- TTS providers ------------------------------------------------------------
// Selected via .env: TTS_PROVIDER=azure | openai   (default: azure)
const TTS_PROVIDER = (process.env.TTS_PROVIDER || "azure").toLowerCase();

// OpenAI settings
const OPENAI_TTS_MODEL = process.env.TTS_MODEL || "gpt-4o-mini-tts";
const OPENAI_TTS_VOICE = process.env.TTS_VOICE || "alloy";
const OPENAI_TTS_INSTRUCTIONS =
  process.env.TTS_INSTRUCTIONS ||
  "Speak in fluent, natural, native Georgian with correct pronunciation of Georgian numbers. Calm presentation pace.";

// Azure settings (native Georgian voices: ka-GE-EkaNeural, ka-GE-GiorgiNeural)
const AZURE_KEY = process.env.AZURE_SPEECH_KEY;
const AZURE_REGION = process.env.AZURE_SPEECH_REGION;
const AZURE_VOICE = process.env.AZURE_VOICE || "ka-GE-EkaNeural";
const ALLOWED_VOICES = ["ka-GE-EkaNeural", "ka-GE-GiorgiNeural"];

function escapeXml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function synthesizeOpenAI(text) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY არ არის მითითებული .env ფაილში");
  }
  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    signal: AbortSignal.timeout(60000),
    signal: AbortSignal.timeout(60000),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_TTS_MODEL,
      voice: OPENAI_TTS_VOICE,
      input: text,
      instructions: OPENAI_TTS_INSTRUCTIONS,
      response_format: "mp3",
    }),
  });
  if (!response.ok) {
    let detail = "";
    try {
      const err = await response.json();
      detail = err.error && err.error.message ? err.error.message : "";
    } catch {}
    throw new Error(`OpenAI TTS-მ დააბრუნა შეცდომა (${response.status}). ${detail}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function synthesizeAzure(text, voice) {
  if (!AZURE_KEY || !AZURE_REGION) {
    throw new Error(
      "AZURE_SPEECH_KEY ან AZURE_SPEECH_REGION არ არის მითითებული .env ფაილში"
    );
  }
  const ssml =
    `<speak version='1.0' xml:lang='ka-GE'>` +
    `<voice name='${voice || AZURE_VOICE}'>${escapeXml(text)}</voice></speak>`;
  const response = await fetch(
    `https://${AZURE_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`,
    {
      method: "POST",
      signal: AbortSignal.timeout(60000),
      headers: {
        "Ocp-Apim-Subscription-Key": AZURE_KEY,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-24khz-96kbitrate-mono-mp3",
        "User-Agent": "presentation-reader",
      },
      body: ssml,
    }
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Azure TTS-მ დააბრუნა შეცდომა (${response.status}). ` +
        (response.status === 401
          ? "შეამოწმეთ AZURE_SPEECH_KEY და AZURE_SPEECH_REGION."
          : detail.slice(0, 200))
    );
  }
  return Buffer.from(await response.arrayBuffer());
}

async function synthesize(text, voice) {
  if (TTS_PROVIDER === "openai") return synthesizeOpenAI(text);
  if (TTS_PROVIDER === "azure") return synthesizeAzure(text, voice);
  throw new Error(`უცნობი TTS_PROVIDER: ${TTS_PROVIDER} (დასაშვებია: azure, openai)`);
}

async function synthesizeWithRetry(text, voice, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await synthesize(text, voice);
    } catch (err) {
      lastErr = err;
      // backoff: 2s, 4s (helps with 429/timeouts)
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw lastErr;
}

const generatingIds = new Set(); // guards double-start per presentation

// Background audio generation, one presentation at a time
async function generateAudio(presDir, paragraphs, voice) {
  const audioDir = path.join(presDir, "audio");
  fs.mkdirSync(audioDir, { recursive: true });
  let lastDone = 0;
  try {
    for (let i = 0; i < paragraphs.length; i++) {
      const mp3 = await synthesizeWithRetry(paragraphs[i], voice);
      fs.writeFileSync(path.join(audioDir, `slide-${i + 1}.mp3`), mp3);
      lastDone = i + 1;
      patchManifest(presDir, {
        audio: {
          status: "generating",
          done: lastDone,
          total: paragraphs.length,
          error: null,
        },
      });
    }
    patchManifest(presDir, {
      audio: { status: "done", done: paragraphs.length, total: paragraphs.length, error: null },
    });
    console.log(`Audio done: ${paragraphs.length} slides`);
  } catch (err) {
    console.error("Audio generation error:", err);
    const m = readManifest(presDir);
    const lastDone = m.audio && m.audio.done ? m.audio.done : 0;
    patchManifest(presDir, {
      audio: {
        status: "error",
        done: lastDone,
        total: paragraphs.length,
        error:
          (lastDone > 0 ? `${lastDone}/${paragraphs.length} სლაიდი მზადაა. ` : "") +
          err.message,
      },
    });
  }
}

// --- Multer -------------------------------------------------------------------
const upload = multer({
  dest: UPLOADS_DIR,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB per file
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (file.fieldname === "pptx" && ext !== ".pptx") {
      return cb(new Error("პრეზენტაციის ფაილი უნდა იყოს .pptx ფორმატის"));
    }
    if (file.fieldname === "docx" && ext !== ".docx") {
      return cb(new Error("ტექსტის ფაილი უნდა იყოს .docx ფორმატის"));
    }
    cb(null, true);
  },
});

// --- Static frontend --------------------------------------------------------------
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// --- POST /api/upload --------------------------------------------------------------
app.post(
  "/api/upload",
  (req, res, next) => {
    upload.fields([
      { name: "pptx", maxCount: 1 },
      { name: "docx", maxCount: 1 },
    ])(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message });
      next();
    });
  },
  async (req, res) => {
    let presDir = null;
    try {
      const pptxFile = req.files && req.files.pptx && req.files.pptx[0];
      const docxFile = req.files && req.files.docx && req.files.docx[0];

      if (!pptxFile || !docxFile) {
        return res
          .status(400)
          .json({ error: "საჭიროა ორივე ფაილის ატვირთვა: .pptx და .docx" });
      }

      if (convertingLock) {
        return res.status(503).json({
          error: "სხვა პრეზენტაცია მუშავდება ამ მომენტში — სცადეთ რამდენიმე წამში.",
        });
      }

      const id = uuidv4();
      presDir = path.join(PRESENTATIONS_DIR, id);
      fs.mkdirSync(presDir, { recursive: true });

      const pptxPath = path.join(presDir, "slides.pptx");
      const docxPath = path.join(presDir, "script.docx");
      fs.renameSync(pptxFile.path, pptxPath);
      fs.renameSync(docxFile.path, docxPath);

      const result = await mammoth.extractRawText({ path: docxPath });
      // mammoth separates Word paragraphs with blank lines; a single \n inside
      // a block is a soft line break (Shift+Enter) and must NOT create a new slide.
      const paragraphs = result.value
        .replace(/\r/g, "")
        .split(/\n{2,}/)
        .map((p) => p.replace(/\n+/g, " ").trim())
        .filter((p) => p.length > 0);

      if (paragraphs.length === 0) {
        fs.rmSync(presDir, { recursive: true, force: true });
        return res
          .status(400)
          .json({ error: "Word-ის დოკუმენტში ტექსტი ვერ მოიძებნა" });
      }

      convertingLock = true;
      try {
        if (conversionBusy) {
        fs.rmSync(presDir, { recursive: true, force: true });
        return res.status(503).json({
          error: "სხვა კონვერტაცია მიმდინარეობს — სცადეთ რამდენიმე წამში",
        });
      }
      conversionBusy = true;
      try {
        await convertPptxToPdf(pptxPath, presDir);
      } finally {
        conversionBusy = false;
      }
      } finally {
        convertingLock = false;
      }

      const manifest = {
        id,
        paragraphs,
        audio: { status: "pending", done: 0, total: paragraphs.length, error: null },
      };
      writeManifest(presDir, manifest);

      res.json({ id, paragraphCount: paragraphs.length, paragraphs });
    } catch (err) {
      console.error("Upload error:", err);
      if (presDir) fs.rmSync(presDir, { recursive: true, force: true });
      res
        .status(500)
        .json({ error: "ფაილების დამუშავებისას მოხდა შეცდომა: " + err.message });
    }
  }
);

// --- POST /api/presentations/:id/generate-audio -------------------------------------
// Called by the client after the matching screen confirms counts match.
app.post("/api/presentations/:id/generate-audio", (req, res) => {
  try {
    const id = path.basename(req.params.id);
    const presDir = path.join(PRESENTATIONS_DIR, id);
    if (!fs.existsSync(manifestPath(presDir))) {
      return res.status(404).json({ error: "პრეზენტაცია ვერ მოიძებნა" });
    }
    const manifest = readManifest(presDir);
    if (generatingIds.has(id) || (manifest.audio && manifest.audio.status === "generating")) {
      return res.json({ ok: true, already: true });
    }
    const requestedVoice = (req.body && req.body.voice) || AZURE_VOICE;
    if (TTS_PROVIDER === "azure" && !ALLOWED_VOICES.includes(requestedVoice)) {
      return res.status(400).json({ error: "უცნობი ხმა: " + requestedVoice });
    }
    generatingIds.add(id);
    // Synchronous flip closes the double-click race window before async work starts
    patchManifest(presDir, {
      voice: requestedVoice,
      audio: { status: "generating", done: 0, total: manifest.paragraphs.length, error: null },
    });
    // Fire and forget; client polls status
    generateAudio(presDir, manifest.paragraphs, requestedVoice).finally(() =>
      generatingIds.delete(id)
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("generate-audio error:", err);
    res.status(500).json({ error: "აუდიოს გენერაცია ვერ დაიწყო: " + err.message });
  }
});

// --- GET /api/presentations/:id (manifest incl. audio status) -------------------------
app.get("/api/presentations/:id", (req, res) => {
  try {
    const id = path.basename(req.params.id);
    const presDir = path.join(PRESENTATIONS_DIR, id);
    if (!fs.existsSync(manifestPath(presDir))) {
      return res.status(404).json({ error: "პრეზენტაცია ვერ მოიძებნა" });
    }
    res.json(readManifest(presDir));
  } catch (err) {
    console.error("Manifest read error:", err);
    res.status(500).json({ error: "მონაცემების წაკითხვისას მოხდა შეცდომა" });
  }
});

// --- GET /api/presentations/:id/slides.pdf ---------------------------------------------
app.get("/api/presentations/:id/slides.pdf", (req, res) => {
  const id = path.basename(req.params.id);
  const pdfPath = path.join(PRESENTATIONS_DIR, id, "slides.pdf");
  if (!fs.existsSync(pdfPath)) {
    return res.status(404).json({ error: "სლაიდები ვერ მოიძებნა" });
  }
  res.sendFile(pdfPath);
});

// --- GET /api/presentations/:id/audio/:n -------------------------------------------------
app.get("/api/presentations/:id/audio/:n", (req, res) => {
  const id = path.basename(req.params.id);
  const n = parseInt(req.params.n, 10);
  if (!Number.isInteger(n) || n < 1) {
    return res.status(400).json({ error: "არასწორი აუდიო ნომერი" });
  }
  const audioPath = path.join(PRESENTATIONS_DIR, id, "audio", `slide-${n}.mp3`);
  if (!fs.existsSync(audioPath)) {
    return res.status(404).json({ error: "აუდიო ვერ მოიძებნა" });
  }
  res.sendFile(audioPath);
});

// --- Start ------------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`Server running: http://localhost:${PORT}`);
  console.log(`LibreOffice: ${SOFFICE}`);
  if (TTS_PROVIDER === "azure") {
    console.log(
      `TTS: azure / ${AZURE_VOICE} / key ${AZURE_KEY && AZURE_REGION ? "OK (" + AZURE_REGION + ")" : "MISSING (.env!)"}`
    );
  } else {
    console.log(
      `TTS: openai / ${OPENAI_TTS_MODEL} / ${OPENAI_TTS_VOICE} / key ${process.env.OPENAI_API_KEY ? "OK" : "MISSING (.env!)"}`
    );
  }
});
