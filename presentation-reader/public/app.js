const uploadBtn = document.getElementById("uploadBtn");
const pptxInput = document.getElementById("pptxInput");
const docxInput = document.getElementById("docxInput");
const loading = document.getElementById("loading");
const errorBox = document.getElementById("errorBox");
const reviewSection = document.getElementById("reviewSection");
const matchBanner = document.getElementById("matchBanner");
const matchList = document.getElementById("matchList");

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

function showError(message) {
  errorBox.textContent = message;
  errorBox.classList.remove("hidden");
}

function clearError() {
  errorBox.textContent = "";
  errorBox.classList.add("hidden");
}

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
  const pdf = await pdfjsLib.getDocument(`/api/presentations/${id}/slides.pdf`)
    .promise;
  const slideCount = pdf.numPages;
  const paragraphCount = paragraphs.length;

  // Count check banner
  if (slideCount === paragraphCount) {
    matchBanner.className = "banner ok";
    matchBanner.textContent =
      `შესაბამისობა დადასტურებულია: ${slideCount} სლაიდი — ${paragraphCount} აბზაცი.`;
  } else {
    matchBanner.className = "banner warn";
    matchBanner.textContent =
      `⚠ შეუსაბამობა: პრეზენტაციაში ${slideCount} სლაიდია, დოკუმენტში კი ${paragraphCount} აბზაცი. ` +
      `გაასწორეთ Word-ის დოკუმენტი ისე, რომ თითო სლაიდს თითო აბზაცი შეესაბამებოდეს, და ატვირთეთ თავიდან.`;
  }

  // Side-by-side rows
  matchList.innerHTML = "";
  const rows = Math.max(slideCount, paragraphCount);
  for (let i = 0; i < rows; i++) {
    const row = document.createElement("div");
    row.className = "match-row";

    const thumbCell = document.createElement("div");
    thumbCell.className = "thumb-cell";
    if (i < slideCount) {
      const page = await pdf.getPage(i + 1);
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
      i < paragraphCount ? paragraphs[i] : "— წასაკითხი ტექსტი აკლია —";
    if (i >= paragraphCount) textCell.classList.add("missing");

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
  uploadBtn.disabled = true;

  try {
    const response = await fetch("/api/upload", { method: "POST", body: formData });

    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error("სერვერმა გაუგებარი პასუხი დააბრუნა");
    }

    if (!response.ok) {
      throw new Error(data.error || "ატვირთვა ვერ მოხერხდა");
    }

    await showReview(data.id, data.paragraphs);
  } catch (err) {
    showError(err.message);
  } finally {
    loading.classList.add("hidden");
    uploadBtn.disabled = false;
  }
});
