const uploadBtn = document.getElementById("uploadBtn");
const pptxInput = document.getElementById("pptxInput");
const docxInput = document.getElementById("docxInput");
const loading = document.getElementById("loading");
const errorBox = document.getElementById("errorBox");
const resultSection = document.getElementById("resultSection");
const paragraphList = document.getElementById("paragraphList");
const paragraphCount = document.getElementById("paragraphCount");

function showError(message) {
  errorBox.textContent = message;
  errorBox.classList.remove("hidden");
}

function clearError() {
  errorBox.textContent = "";
  errorBox.classList.add("hidden");
}

uploadBtn.addEventListener("click", async () => {
  clearError();
  resultSection.classList.add("hidden");

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
    const response = await fetch("/api/upload", {
      method: "POST",
      body: formData,
    });

    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error("სერვერმა გაუგებარი პასუხი დააბრუნა");
    }

    if (!response.ok) {
      throw new Error(data.error || "ატვირთვა ვერ მოხერხდა");
    }

    // Render paragraphs for verification
    paragraphCount.textContent = data.paragraphCount;
    paragraphList.innerHTML = "";
    for (const p of data.paragraphs) {
      const li = document.createElement("li");
      li.textContent = p;
      paragraphList.appendChild(li);
    }
    resultSection.classList.remove("hidden");
  } catch (err) {
    showError(err.message);
  } finally {
    loading.classList.add("hidden");
    uploadBtn.disabled = false;
  }
});
