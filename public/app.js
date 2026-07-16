// ---------- Elements ----------
const uploadBtn = document.getElementById("uploadBtn");
const pptxInput = document.getElementById("pptxInput");
const docxInput = document.getElementById("docxInput");
const loading = document.getElementById("loading");
const errorBox = document.getElementById("errorBox");

const reviewSection = document.getElementById("reviewSection");
const matchBanner = document.getElementById("matchBanner");
const matchList = document.getElementById("matchList");
const audioControls = document.getElementById("audioControls");
const generateBtn = document.getElementById("generateBtn");
const voiceSelect = document.getElementById("voiceSelect");
const thumbRail = document.getElementById("thumbRail");
const audioProgress = document.getElementById("audioProgress");
const progressFill = document.getElementById("progressFill");
const progressText = document.getElementById("progressText");
const startBtn = document.getElementById("startBtn");
const audioError = document.getElementById("audioError");

const uploadCard = document.getElementById("uploadCard");
const appHeader = document.getElementById("appHeader");
const playerSection = document.getElementById("playerSection");
const slideCanvas = document.getElementById("slideCanvas");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const playPauseBtn = document.getElementById("playPauseBtn");
const slideCounter = document.getElementById("slideCounter");
const rateSelect = document.getElementById("rateSelect");
const backBtn = document.getElementById("backBtn");
const endedBanner = document.getElementById("endedBanner");
const restartBtn = document.getElementById("restartBtn");

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "/vendor/pdf.worker.min.js";

// ---------- Shared state ----------
let currentId = null;
let currentPdf = null;
let slideCount = 0;
let pollTimer = null;

const GAP_MS = 2000; // 2 seconds after audio ends, per assignment

function showError(message) {
  errorBox.textContent = message;
  errorBox.classList.remove("hidden");
}

function clearError() {
  errorBox.textContent = "";
  errorBox.classList.add("hidden");
}

// ---------- Upload + review ----------
async function renderThumbnail(page, targetWidth) {
  const viewport = page.getViewport({ scale: 1 });
  const scale = targetWidth / viewport.width;
  const scaled = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = scaled.width;
  canvas.height = scaled.height;
  await page.render({ canvasContext: canvas.getContext("2d"), viewport: scaled })
    .promise;
  return canvas;
}

async function showReview(id, paragraphs) {
  currentId = id;
  currentPdf = await pdfjsLib.getDocument(`/api/presentations/${id}/slides.pdf`)
    .promise;
  slideCount = currentPdf.numPages;
  const paragraphCount = paragraphs.length;

  audioError.classList.add("hidden");
  audioProgress.classList.add("hidden");
  startBtn.classList.add("hidden");
  generateBtn.classList.remove("hidden");
  generateBtn.disabled = false;

  if (slideCount === paragraphCount) {
    matchBanner.className = "banner ok";
    matchBanner.textContent =
      `შესაბამისობა დადასტურებულია: ${slideCount} სლაიდი — ${paragraphCount} აბზაცი.`;
    audioControls.classList.remove("hidden");
  } else {
    matchBanner.className = "banner warn";
    matchBanner.textContent =
      `⚠ შეუსაბამობა: პრეზენტაციაში ${slideCount} სლაიდია, დოკუმენტში კი ${paragraphCount} აბზაცი. ` +
      `გაასწორეთ Word-ის დოკუმენტი ისე, რომ თითო სლაიდს თითო აბზაცი შეესაბამებოდეს, და ატვირთეთ თავიდან. `;
    const reBtn = document.createElement("button");
    reBtn.textContent = "თავიდან ატვირთვა";
    reBtn.className = "linklike";
    reBtn.onclick = () => {
      docxInput.value = "";
      uploadCard.scrollIntoView({ behavior: "smooth" });
    };
    matchBanner.appendChild(reBtn);
    audioControls.classList.add("hidden");
  }

  matchList.innerHTML = "";
  const rows = Math.max(slideCount, paragraphCount);
  for (let i = 0; i < rows; i++) {
    const row = document.createElement("div");
    row.className = "match-row";

    const thumbCell = document.createElement("div");
    thumbCell.className = "thumb-cell";
    if (i < slideCount) {
      const page = await currentPdf.getPage(i + 1);
      const canvas = await renderThumbnail(page, 240);
      thumbCell.appendChild(canvas);
      const label = document.createElement("div");
      label.className = "thumb-label";
      label.textContent = `სლაიდი ${i + 1}`;
      thumbCell.appendChild(label);
    } else {
      thumbCell.innerHTML = `<div class="missing">— სლაიდი არ არის —</div>`;
    }

    const textCell = document.createElement("div");
    textCell.className = "text-cell";
    textCell.textContent =
      i < paragraphs.length ? paragraphs[i] : "— წასაკითხი ტექსტი აკლია —";
    if (i >= paragraphs.length) textCell.classList.add("missing");

    row.appendChild(thumbCell);
    row.appendChild(textCell);
    matchList.appendChild(row);
  }

  reviewSection.classList.remove("hidden");
  reviewSection.scrollIntoView({ behavior: "smooth" });
}

uploadBtn.addEventListener("click", async () => {
  clearError();
  reviewSection.classList.add("hidden");
  if (pollTimer) clearInterval(pollTimer);

  const pptxFile = pptxInput.files[0];
  const docxFile = docxInput.files[0];

  if (!pptxFile || !docxFile) {
    showError("გთხოვთ, აირჩიოთ ორივე ფაილი: .pptx და .docx");
    return;
  }

  const formData = new FormData();
  formData.append("pptx", pptxFile);
  formData.append("docx", docxFile);

  loading.classList.remove("hidden");
  loading.textContent =
    "მიმდინარეობს დამუშავება… სლაიდების კონვერტაციას შესაძლოა რამდენიმე წამი დასჭირდეს.";
  const slowTimer = setTimeout(() => {
    loading.textContent =
      "კონვერტაცია ჯერ კიდევ მიმდინარეობს — დიდი პრეზენტაცია მეტ დროს მოითხოვს, გთხოვთ დაელოდოთ.";
  }, 10000);
  uploadBtn.disabled = true;

  try {
    const response = await fetch("/api/upload", { method: "POST", body: formData });
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error("სერვერმა გაუგებარი პასუხი დააბრუნა");
    }
    if (!response.ok) throw new Error(data.error || "ატვირთვა ვერ მოხერხდა");

    await showReview(data.id, data.paragraphs);
  } catch (err) {
    showError(err.message);
  } finally {
    clearTimeout(slowTimer);
    loading.classList.add("hidden");
    uploadBtn.disabled = false;
  }
});

// ---------- Audio generation + polling ----------
generateBtn.addEventListener("click", async () => {
  audioError.classList.add("hidden");
  generateBtn.disabled = true;
  try {
    const r = await fetch(`/api/presentations/${currentId}/generate-audio`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voice: voiceSelect.value }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "გენერაცია ვერ დაიწყო");
    audioProgress.classList.remove("hidden");
    progressText.textContent = "აუდიო გენერირდება…";
    pollTimer = setInterval(pollStatus, 1500);
  } catch (err) {
    generateBtn.disabled = false;
    audioError.textContent = err.message;
    audioError.classList.remove("hidden");
  }
});

async function pollStatus() {
  try {
    const r = await fetch(`/api/presentations/${currentId}`);
    const m = await r.json();
    if (!r.ok) throw new Error(m.error || "სტატუსი ვერ წავიკითხე");
    const a = m.audio || {};
    if (a.status === "generating" || a.status === "pending") {
      const pct = a.total ? Math.round((a.done / a.total) * 100) : 0;
      progressFill.style.width = pct + "%";
      progressText.textContent = `აუდიო გენერირდება: ${a.done}/${a.total} სლაიდი`;
    } else if (a.status === "done") {
      clearInterval(pollTimer);
      progressFill.style.width = "100%";
      progressText.textContent = `აუდიო მზადაა: ${a.total}/${a.total} სლაიდი.`;
      generateBtn.classList.add("hidden");
      startBtn.classList.remove("hidden");
    } else if (a.status === "error") {
      clearInterval(pollTimer);
      audioProgress.classList.add("hidden");
      generateBtn.disabled = false;
      audioError.textContent = "აუდიოს გენერაცია ჩავარდა: " + (a.error || "");
      audioError.classList.remove("hidden");
    }
  } catch (err) {
    clearInterval(pollTimer);
    audioError.textContent = err.message;
    audioError.classList.remove("hidden");
  }
}

// ---------- Player ----------
const audio = new Audio();
let playToken = 0; // guards against overlapping playSlide() runs
let currentIndex = 0; // 0-based
// phase: 'playing' | 'gap' | 'paused' | 'ended'
let phase = "playing";
let pausedFrom = null; // what phase we paused from
let gapTimer = null;
let gapStartedAt = 0;
let gapRemaining = 0;

function setPlayPauseLabel() {
  playPauseBtn.textContent = phase === "paused" ? "გაგრძელება" : "პაუზა";
}

async function renderSlide(i) {
  const page = await currentPdf.getPage(i + 1);
  const container = document.querySelector(".player-frame");
  const viewport = page.getViewport({ scale: 1 });
  const scale = container.clientWidth / viewport.width;
  const scaled = page.getViewport({ scale });
  slideCanvas.width = scaled.width;
  slideCanvas.height = scaled.height;
  await page.render({
    canvasContext: slideCanvas.getContext("2d"),
    viewport: scaled,
  }).promise;
  slideCounter.textContent = `${i + 1} / ${slideCount}`;
  highlightThumb(i);
}

function clearGap() {
  if (gapTimer) {
    clearTimeout(gapTimer);
    gapTimer = null;
  }
}

function startGap(ms) {
  phase = "gap";
  gapStartedAt = Date.now();
  gapRemaining = ms;
  gapTimer = setTimeout(() => {
    gapTimer = null;
    advance();
  }, ms);
}

async function playSlide(i) {
  const token = ++playToken;
  clearGap();
  audio.pause();
  audio.currentTime = 0;
  endedBanner.classList.add("hidden");
  currentIndex = i;
  await renderSlide(i);
  if (token !== playToken) return; // a newer navigation superseded this one
  audio.src = `/api/presentations/${currentId}/audio/${i + 1}`;
  audio.playbackRate = parseFloat(rateSelect.value);
  phase = "playing";
  setPlayPauseLabel();
  try {
    await audio.play();
    if (token !== playToken) return;
  } catch (err) {
    if (token !== playToken) return;
    phase = "paused";
    pausedFrom = "playing";
    setPlayPauseLabel();
  }
}

function advance() {
  if (currentIndex + 1 < slideCount) {
    playSlide(currentIndex + 1);
  } else {
    phase = "ended";
    setPlayPauseLabel();
    endedBanner.classList.remove("hidden");
  }
}

audio.addEventListener("ended", () => {
  if (phase === "playing") startGap(GAP_MS);
});

audio.addEventListener("error", () => {
  if (phase === "playing") {
    slideCounter.textContent = `${currentIndex + 1} / ${slideCount} — აუდიო ვერ ჩაიტვირთა`;
    startGap(GAP_MS); // don't freeze the demo: advance after the gap
  }
});

playPauseBtn.addEventListener("click", () => {
  if (phase === "playing") {
    pausedFrom = "playing";
    phase = "paused";
    audio.pause();
  } else if (phase === "gap") {
    pausedFrom = "gap";
    gapRemaining = Math.max(0, gapRemaining - (Date.now() - gapStartedAt));
    clearGap();
    phase = "paused";
  } else if (phase === "paused") {
    if (pausedFrom === "gap") {
      startGap(gapRemaining);
    } else {
      phase = "playing";
      audio.play().catch(() => {
        phase = "paused";
        pausedFrom = "playing";
        setPlayPauseLabel();
      });
    }
  } else if (phase === "ended") {
    playSlide(0);
  }
  setPlayPauseLabel();
});

prevBtn.addEventListener("click", () => {
  if (currentIndex > 0) playSlide(currentIndex - 1);
});

nextBtn.addEventListener("click", () => {
  if (currentIndex + 1 < slideCount) playSlide(currentIndex + 1);
});

restartBtn.addEventListener("click", () => playSlide(0));

rateSelect.addEventListener("change", () => {
  audio.playbackRate = parseFloat(rateSelect.value);
});

voiceSelect.addEventListener("change", () => {
  // Changing the voice requires regeneration with the new voice
  if (!startBtn.classList.contains("hidden")) {
    startBtn.classList.add("hidden");
    generateBtn.classList.remove("hidden");
    generateBtn.disabled = false;
    generateBtn.textContent = "ხმის გენერაცია არჩეული ხმით";
    audioProgress.classList.add("hidden");
  }
});

async function buildThumbRail() {
  thumbRail.innerHTML = "";
  for (let i = 0; i < slideCount; i++) {
    const item = document.createElement("div");
    item.className = "thumb-item";
    item.dataset.index = i;
    const page = await currentPdf.getPage(i + 1);
    const canvas = await renderThumbnail(page, 110);
    item.appendChild(canvas);
    const num = document.createElement("div");
    num.className = "thumb-num";
    num.textContent = i + 1;
    item.appendChild(num);
    item.addEventListener("click", () => playSlide(i));
    thumbRail.appendChild(item);
  }
}

function highlightThumb(i) {
  thumbRail.querySelectorAll(".thumb-item").forEach((el) => {
    el.classList.toggle("active", Number(el.dataset.index) === i);
  });
  const active = thumbRail.querySelector(".thumb-item.active");
  if (active) active.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

startBtn.addEventListener("click", async () => {
  appHeader.classList.add("hidden");
  uploadCard.classList.add("hidden");
  reviewSection.classList.add("hidden");
  playerSection.classList.remove("hidden");
  await buildThumbRail();
  playSlide(0);
});

backBtn.addEventListener("click", () => {
  audio.pause();
  clearGap();
  phase = "paused";
  playerSection.classList.add("hidden");
  appHeader.classList.remove("hidden");
  uploadCard.classList.remove("hidden");
  reviewSection.classList.remove("hidden");
});

window.addEventListener("resize", () => {
  if (!playerSection.classList.contains("hidden") && currentPdf) {
    renderSlide(currentIndex);
  }
});
