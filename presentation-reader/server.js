const express = require("express");
const multer = require("multer");
const mammoth = require("mammoth");
const { v4: uuidv4 } = require("uuid");
const { execFile } = require("child_process");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = 3000;

// --- Folders -----------------------------------------------------------
const STORAGE_DIR = path.join(__dirname, "storage");
const UPLOADS_DIR = path.join(STORAGE_DIR, "uploads");
const PRESENTATIONS_DIR = path.join(STORAGE_DIR, "presentations");

for (const dir of [STORAGE_DIR, UPLOADS_DIR, PRESENTATIONS_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

// --- LibreOffice detection ------------------------------------------------
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
  return "soffice"; // hope it's on PATH
}

const SOFFICE = findSoffice();

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

// --- Multer setup -----------------------------------------------------------
const upload = multer({
  dest: UPLOADS_DIR,
  limits: { fileSize: 100 * 1024 * 1024 },
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

// --- Static frontend ---------------------------------------------------------
app.use(express.static(path.join(__dirname, "public")));

// --- POST /api/upload ---------------------------------------------------------
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
    try {
      const pptxFile = req.files && req.files.pptx && req.files.pptx[0];
      const docxFile = req.files && req.files.docx && req.files.docx[0];

      if (!pptxFile || !docxFile) {
        return res
          .status(400)
          .json({ error: "საჭიროა ორივე ფაილის ატვირთვა: .pptx და .docx" });
      }

      const id = uuidv4();
      const presDir = path.join(PRESENTATIONS_DIR, id);
      fs.mkdirSync(presDir, { recursive: true });

      const pptxPath = path.join(presDir, "slides.pptx");
      const docxPath = path.join(presDir, "script.docx");
      fs.renameSync(pptxFile.path, pptxPath);
      fs.renameSync(docxFile.path, docxPath);

      // 1) Parse the docx into paragraphs
      const result = await mammoth.extractRawText({ path: docxPath });
      const paragraphs = result.value
        .split(/\r?\n/)
        .map((p) => p.trim())
        .filter((p) => p.length > 0);

      if (paragraphs.length === 0) {
        return res
          .status(400)
          .json({ error: "Word-ის დოკუმენტში ტექსტი ვერ მოიძებნა" });
      }

      // 2) Convert pptx -> pdf (slides.pdf)
      await convertPptxToPdf(pptxPath, presDir);

      // 3) Save manifest
      const manifest = { id, paragraphs, slideCount: null };
      fs.writeFileSync(
        path.join(presDir, "manifest.json"),
        JSON.stringify(manifest, null, 2),
        "utf8"
      );

      res.json({ id, paragraphCount: paragraphs.length, paragraphs });
    } catch (err) {
      console.error("Upload error:", err);
      res
        .status(500)
        .json({ error: "ფაილების დამუშავებისას მოხდა შეცდომა: " + err.message });
    }
  }
);

// --- GET /api/presentations/:id ------------------------------------------------
app.get("/api/presentations/:id", (req, res) => {
  try {
    const id = path.basename(req.params.id);
    const manifestPath = path.join(PRESENTATIONS_DIR, id, "manifest.json");
    if (!fs.existsSync(manifestPath)) {
      return res.status(404).json({ error: "პრეზენტაცია ვერ მოიძებნა" });
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    res.json(manifest);
  } catch (err) {
    console.error("Manifest read error:", err);
    res.status(500).json({ error: "მონაცემების წაკითხვისას მოხდა შეცდომა" });
  }
});

// --- GET /api/presentations/:id/slides.pdf ---------------------------------------
app.get("/api/presentations/:id/slides.pdf", (req, res) => {
  const id = path.basename(req.params.id);
  const pdfPath = path.join(PRESENTATIONS_DIR, id, "slides.pdf");
  if (!fs.existsSync(pdfPath)) {
    return res.status(404).json({ error: "სლაიდები ვერ მოიძებნა" });
  }
  res.sendFile(pdfPath);
});

// --- Start ------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`Server running: http://localhost:${PORT}`);
  console.log(`LibreOffice: ${SOFFICE}`);
});
