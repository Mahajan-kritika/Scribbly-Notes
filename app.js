(() => {
  "use strict";

  const WIDTH = 900;
  const HEIGHT = 1273;
  const STORAGE_KEY = "scribbly-notes-state-v1";
  const LIBRARY_KEY = "scribbly-notes-library-v1";
  const FONT_FAMILIES = { neat: "Patrick Hand", cursive: "Caveat", casual: "Kalam" };
  const INK_NAMES = {
    "#315f91": "Denim blue",
    "#343434": "Soft black",
    "#c2504d": "Brick red",
    "#43846a": "Leaf green"
  };
  const SAMPLE = `# Ohm's Law

Ohm's law states that the current flowing through a conductor is directly proportional to the voltage across it, provided temperature remains constant.

Formula: V = IR

Where:
- V = Voltage
- I = Current
- R = Resistance

Remember: keep your units consistent!`;

  const $ = (id) => document.getElementById(id);
  const input = $("noteInput");
  const canvas = $("previewCanvas");
  const ctx = canvas.getContext("2d");
  const state = {
    text: "",
    font: "neat",
    paper: "ruled",
    ink: "#315f91",
    fontSize: 22,
    lineSpacing: 1.45,
    alignment: "left",
    zoom: 100,
    page: 0,
    pages: [[]]
  };
  const history = [""];
  let historyIndex = 0;
  let saveTimer;
  let toastTimer;

  function showToast(message) {
    const toast = $("toast");
    toast.textContent = message;
    toast.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("visible"), 2300);
  }

  function hashSeed(value) {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function randomFrom(seed) {
    let value = seed || 1;
    return () => {
      value += 0x6D2B79F5;
      let n = value;
      n = Math.imul(n ^ (n >>> 15), n | 1);
      n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
      return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
    };
  }

  function textTokens(text) {
    const parts = text.match(/\*\*[^*]+\*\*|\*[^*]+\*|__[^_]+__|_[^_]+_|[^\s]+/g) || [];
    return parts.filter((part) => part.trim()).map((part) => {
      let value = part;
      let bold = false;
      let italic = false;
      if (value.startsWith("**") && value.endsWith("**")) {
        bold = true;
        value = value.slice(2, -2);
      } else if (value.startsWith("__") && value.endsWith("__")) {
        bold = true;
        value = value.slice(2, -2);
      } else if (value.startsWith("*") && value.endsWith("*")) {
        italic = true;
        value = value.slice(1, -1);
      } else if (value.startsWith("_") && value.endsWith("_")) {
        italic = true;
        value = value.slice(1, -1);
      }
      return { text: value, bold, italic };
    });
  }

  function currentFont(size, token, heading = false) {
    const family = FONT_FAMILIES[state.font];
    const px = heading ? size * 1.2 : size;
    return `${token && token.italic ? "italic " : ""}${token && token.bold ? "700 " : ""}${px}px "${family}"`;
  }

  function parseBlocks(text) {
    const lines = text.replace(/\r\n?/g, "\n").split("\n");
    const blocks = [];
    let firstContentSeen = false;
    for (const rawLine of lines) {
      const trimmed = rawLine.trim();
      if (!trimmed) {
        if (blocks.length && blocks[blocks.length - 1].type !== "space") blocks.push({ type: "space", text: "" });
        continue;
      }
      let type = "body";
      let value = trimmed;
      if (/^#{1,2}\s+/.test(value)) {
        type = "heading";
        value = value.replace(/^#{1,2}\s+/, "");
      } else if (/^[-*•]\s+/.test(value)) {
        type = "bullet";
        value = value.replace(/^[-*•]\s+/, "");
      } else if (/^\d+[.)]\s+/.test(value)) {
        type = "number";
        const marker = value.match(/^\d+[.)]/)[0];
        type = "number";
        value = `${marker} ${value.replace(/^\d+[.)]\s+/, "")}`;
      } else if (!firstContentSeen && value.length < 48 && !/[.!?]$/.test(value)) {
        type = "heading";
      }
      firstContentSeen = true;
      blocks.push({ type, text: value });
    }
    while (blocks.length && blocks[blocks.length - 1].type === "space") blocks.pop();
    return blocks;
  }

  function wrapBlock(block, measureContext, maxWidth) {
    if (block.type === "space") return { type: "space", rows: [], gap: state.fontSize * 0.72 };
    const heading = block.type === "heading";
    const sourceTokens = textTokens(block.text);
    const rows = [];
    let row = [];
    let usedWidth = 0;
    const rowMaxWidth = maxWidth - (block.type === "bullet" ? 22 : 0);

    const tokens = [];
    for (const token of sourceTokens) {
      measureContext.font = currentFont(state.fontSize, token, heading);
      const tokenWidth = measureContext.measureText(token.text).width;
      if (tokenWidth <= rowMaxWidth) {
        tokens.push(token);
        continue;
      }
      let fragment = "";
      let firstFragment = true;
      for (const character of Array.from(token.text)) {
        const candidate = fragment + character;
        if (fragment && measureContext.measureText(candidate).width > rowMaxWidth) {
          tokens.push({ ...token, text: fragment, joinedFromPrevious: !firstFragment });
          firstFragment = false;
          fragment = character;
        } else {
          fragment = candidate;
        }
      }
      if (fragment) tokens.push({ ...token, text: fragment, joinedFromPrevious: !firstFragment });
    }

    for (const token of tokens) {
      measureContext.font = currentFont(state.fontSize, token, heading);
      const tokenWidth = measureContext.measureText(token.text).width;
      const gap = row.length ? Math.max(5, state.fontSize * 0.3) : 0;
      if (row.length && usedWidth + gap + tokenWidth > rowMaxWidth) {
        rows.push(row);
        row = [];
        usedWidth = 0;
      }
      const actualGap = row.length && !token.joinedFromPrevious
        ? Math.max(5, state.fontSize * 0.3)
        : 0;
      row.push({ ...token, width: tokenWidth, gap: actualGap });
      usedWidth += actualGap + tokenWidth;
    }
    if (row.length) rows.push(row);
    const lineHeight = state.fontSize * state.lineSpacing * (heading ? 1.06 : 1);
    return {
      type: block.type,
      rows,
      lineHeight,
      gap: block.type === "heading" ? 9 : 7
    };
  }

  function paginate(text, measureContext) {
    const marginLeft = 125;
    const marginRight = 75;
    const contentWidth = WIDTH - marginLeft - marginRight;
    const top = 143;
    const bottom = HEIGHT - 100;
    const usableHeight = bottom - top;
    const blocks = parseBlocks(text).map((block) => wrapBlock(block, measureContext, contentWidth));
    const pages = [];
    let page = [];
    let used = 0;
    const finishPage = () => {
      if (page.length) pages.push(page);
      page = [];
      used = 0;
    };
    for (let index = 0; index < blocks.length; index += 1) {
      const block = blocks[index];
      if (block.type === "space") {
        if (page.length) {
          page.push({ type: "space", height: block.gap });
          used += block.gap;
        }
        continue;
      }
      const blockHeight = block.rows.length * block.lineHeight + block.gap;
      let nextIndex = index + 1;
      let spacerHeight = 0;
      while (blocks[nextIndex] && blocks[nextIndex].type === "space") {
        spacerHeight += blocks[nextIndex].gap;
        nextIndex += 1;
      }
      const next = blocks[nextIndex];
      const headingPairHeight = block.type === "heading" && next
        ? blockHeight + spacerHeight + next.rows.length * next.lineHeight + next.gap
        : blockHeight;
      if (page.length && block.type === "heading" && headingPairHeight <= usableHeight && used + headingPairHeight > usableHeight) finishPage();
      if (blockHeight <= usableHeight) {
        if (page.length && used + blockHeight > usableHeight) finishPage();
        for (let rowIndex = 0; rowIndex < block.rows.length; rowIndex += 1) {
          page.push({ type: block.type, tokens: block.rows[rowIndex], line: rowIndex, lineCount: block.rows.length });
          used += block.lineHeight;
        }
        used += block.gap;
        if (block.gap) page.push({ type: "gap", height: block.gap });
      } else {
        for (let rowIndex = 0; rowIndex < block.rows.length; rowIndex += 1) {
          if (used + block.lineHeight > usableHeight && page.length) finishPage();
          page.push({ type: block.type, tokens: block.rows[rowIndex], line: rowIndex, lineCount: block.rows.length });
          used += block.lineHeight;
        }
        if (used + block.gap <= usableHeight) {
          page.push({ type: "gap", height: block.gap });
          used += block.gap;
        }
      }
    }
    finishPage();
    return pages.length ? pages : [[]];
  }

  function paperColor() {
    return "#fffefa";
  }

  function drawPaper(context, pageNumber) {
    context.fillStyle = paperColor();
    context.fillRect(0, 0, WIDTH, HEIGHT);
    context.save();
    if (state.paper === "ruled") {
      context.strokeStyle = "#b9d5e5";
      context.lineWidth = 1.1;
      for (let y = 124; y < HEIGHT - 54; y += 38) {
        context.beginPath();
        context.moveTo(56, y);
        context.lineTo(WIDTH - 48, y);
        context.stroke();
      }
      context.strokeStyle = "#df9994";
      context.lineWidth = 1.5;
      context.beginPath();
      context.moveTo(108, 48);
      context.lineTo(108, HEIGHT - 45);
      context.stroke();
    } else if (state.paper === "grid") {
      context.strokeStyle = "#e0e6e4";
      context.lineWidth = .7;
      for (let x = 56; x < WIDTH - 40; x += 31) {
        context.beginPath(); context.moveTo(x, 45); context.lineTo(x, HEIGHT - 45); context.stroke();
      }
      for (let y = 45; y < HEIGHT - 40; y += 31) {
        context.beginPath(); context.moveTo(45, y); context.lineTo(WIDTH - 45, y); context.stroke();
      }
    } else if (state.paper === "dotted") {
      context.fillStyle = "#d8deda";
      for (let x = 58; x < WIDTH - 45; x += 24) {
        for (let y = 50; y < HEIGHT - 45; y += 24) {
          context.beginPath(); context.arc(x, y, 1.05, 0, Math.PI * 2); context.fill();
        }
      }
    }
    context.strokeStyle = "rgba(144, 137, 117, .17)";
    context.lineWidth = 1;
    context.strokeRect(.5, .5, WIDTH - 1, HEIGHT - 1);
    context.restore();

    context.save();
    context.fillStyle = "#a9a092";
    context.font = `12px "${FONT_FAMILIES[state.font]}"`;
    context.textAlign = "right";
    context.fillText(String(pageNumber), WIDTH - 68, 80);
    context.restore();
  }

  function drawPage(targetCanvas, pageIndex, scale = 1) {
    targetCanvas.width = Math.round(WIDTH * scale);
    targetCanvas.height = Math.round(HEIGHT * scale);
    const context = targetCanvas.getContext("2d");
    context.setTransform(scale, 0, 0, scale, 0, 0);
    drawPaper(context, pageIndex + 1);

    const marginLeft = 125;
    const marginRight = 75;
    const top = 143;
    const bottom = HEIGHT - 100;
    const contentWidth = WIDTH - marginLeft - marginRight;
    const lineHeight = state.fontSize * state.lineSpacing;
    const seed = hashSeed(`${state.text}|${state.font}|${state.ink}|${pageIndex}`);
    const random = randomFrom(seed);
    let y = top + state.fontSize;
    context.save();
    context.beginPath();
    context.rect(marginLeft - 8, top - 8, contentWidth + 16, bottom - top + 8);
    context.clip();
    for (const item of state.pages[pageIndex] || []) {
      if (item.type === "gap" || item.type === "space") {
        y += item.height;
        continue;
      }
      const heading = item.type === "heading";
      const baseSize = state.fontSize * (heading ? 1.2 : 1);
      const rowWidth = item.tokens.reduce((total, token) => total + token.width + token.gap, 0);
      const leftOffset = item.type === "bullet" ? 22 : 0;
      let x = marginLeft + leftOffset;
      const align = state.alignment;
      if (align === "center") x = marginLeft + leftOffset + Math.max(0, (contentWidth - leftOffset - rowWidth) / 2);
      if (align === "right") x = marginLeft + leftOffset + Math.max(0, contentWidth - leftOffset - rowWidth);
      if (item.type === "bullet" && item.line === 0) {
        context.fillStyle = state.ink;
        context.font = `${Math.max(14, state.fontSize - 2)}px "${FONT_FAMILIES[state.font]}"`;
        context.textAlign = "left";
        context.fillText("•", marginLeft + 3, y + 1);
      }
      for (const token of item.tokens) {
        const variation = random();
        const offsetX = (variation - .5) * 1.1;
        const offsetY = (random() - .5) * 1.5;
        const rotation = (random() - .5) * .012;
        const sizeVariation = (random() - .5) * .45;
        context.save();
        context.translate(x + offsetX, y + offsetY);
        context.rotate(rotation);
        context.fillStyle = state.ink;
        context.font = currentFont(baseSize + sizeVariation, token, false);
        context.textBaseline = "alphabetic";
        context.textAlign = "left";
        context.fillText(token.text, 0, 0);
        context.restore();
        x += token.width + token.gap;
      }
      y += heading ? lineHeight * 1.06 : lineHeight;
      if (y > bottom) break;
    }
    context.restore();
  }

  function updateCounts() {
    const text = input.value.trim();
    $("wordCount").textContent = text ? String(text.split(/\s+/).length) : "0";
    $("charCount").textContent = String(input.value.length);
  }

  function updateHistoryButtons() {
    $("undoButton").disabled = historyIndex <= 0;
    $("redoButton").disabled = historyIndex >= history.length - 1;
  }

  function updatePageView() {
    $("pageNumber").textContent = String(state.page + 1);
    $("pageTotal").textContent = String(state.pages.length);
    $("previousPage").disabled = state.page <= 0;
    $("nextPage").disabled = state.page >= state.pages.length - 1;
    $("emptyHint").hidden = Boolean(state.text.trim());
    drawPage(canvas, state.page);
  }

  function updateInkUI() {
    document.querySelectorAll(".ink-swatch").forEach((swatch) => {
      swatch.classList.toggle("selected", swatch.dataset.color.toLowerCase() === state.ink.toLowerCase());
    });
    $("customColor").value = state.ink;
    $("inkCurrent").textContent = INK_NAMES[state.ink.toLowerCase()] || "Custom ink";
  }

  function persistState() {
    const saveState = {
      version: 1,
      text: input.value,
      font: state.font,
      paper: state.paper,
      ink: state.ink,
      fontSize: state.fontSize,
      lineSpacing: state.lineSpacing,
      alignment: state.alignment,
      zoom: state.zoom
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saveState));
      $("autosaveState").classList.remove("saving");
      $("autosaveState").innerHTML = '<span class="save-dot"></span> Saved on this device';
    } catch (error) {
      $("autosaveState").classList.add("saving");
      $("autosaveState").innerHTML = '<span class="save-dot"></span> Could not save locally';
      console.error("Unable to save Scribbly Notes preferences.", error);
    }
  }

  function schedulePersist() {
    $("autosaveState").classList.add("saving");
    $("autosaveState").innerHTML = '<span class="save-dot"></span> Saving…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persistState, 250);
  }

  function render() {
    state.text = input.value;
    state.pages = paginate(state.text, ctx);
    if (state.page >= state.pages.length) state.page = state.pages.length - 1;
    updateCounts();
    updatePageView();
    $("pageWrap").style.width = `min(${357 * state.zoom / 100}px, 100%)`;
    $("zoomLabel").textContent = `${state.zoom}%`;
    updateHistoryButtons();
    schedulePersist();
  }

  function setText(text, addHistory = true) {
    input.value = text;
    state.text = text;
    if (addHistory) {
      history.splice(historyIndex + 1);
      history.push(text);
      if (history.length > 80) history.shift();
      historyIndex = history.length - 1;
    }
    render();
  }

  function loadState(saved) {
    if (!saved || typeof saved !== "object" || typeof saved.text !== "string") return false;
    input.value = saved.text;
    state.font = ["neat", "cursive", "casual"].includes(saved.font) ? saved.font : "neat";
    state.paper = ["ruled", "blank", "grid", "dotted"].includes(saved.paper) ? saved.paper : "ruled";
    state.ink = /^#[0-9a-f]{6}$/i.test(saved.ink) ? saved.ink : "#315f91";
    state.fontSize = [18, 20, 22, 24, 26, 28].includes(Number(saved.fontSize)) ? Number(saved.fontSize) : 22;
    state.lineSpacing = [1.25, 1.45, 1.7].includes(Number(saved.lineSpacing)) ? Number(saved.lineSpacing) : 1.45;
    state.alignment = ["left", "center", "right"].includes(saved.alignment) ? saved.alignment : "left";
    state.zoom = [80, 90, 100, 110, 120].includes(Number(saved.zoom)) ? Number(saved.zoom) : 100;
    $("fontStyle").value = state.font;
    $("paperStyle").value = state.paper;
    $("fontSize").value = String(state.fontSize);
    $("lineSpacing").value = String(state.lineSpacing);
    $("textAlignment").value = state.alignment;
    updateInkUI();
    history.splice(0, history.length, input.value);
    historyIndex = 0;
    render();
    return true;
  }

  function formatSelection(kind) {
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const selected = input.value.slice(start, end);
    if (kind === "heading") {
      const lineStart = input.value.lastIndexOf("\n", start - 1) + 1;
      const lineEndIndex = input.value.indexOf("\n", end);
      const lineEnd = lineEndIndex === -1 ? input.value.length : lineEndIndex;
      const lines = input.value.slice(lineStart, lineEnd).split("\n");
      const alreadyHeading = lines.every((line) => /^#{1,2}\s/.test(line));
      const replacement = lines.map((line) => alreadyHeading ? line.replace(/^#{1,2}\s/, "") : `## ${line}`).join("\n");
      input.setRangeText(replacement, lineStart, lineEnd, "select");
      setText(input.value);
      return;
    }
    const markers = kind === "bold" ? ["**", "**"] : ["*", "*"];
    const inside = input.value.slice(Math.max(0, start - markers[0].length), end + markers[1].length);
    if (inside.startsWith(markers[0]) && inside.endsWith(markers[1])) {
      input.setRangeText(selected, start - markers[0].length, end + markers[1].length, "select");
    } else {
      input.setRangeText(`${markers[0]}${selected || "your text"}${markers[1]}`, start, end, "select");
      if (!selected) input.setSelectionRange(start + markers[0].length, start + markers[0].length + 9);
    }
    setText(input.value);
    input.focus();
  }

  function savedStateObject() {
    return {
      version: 1,
      text: input.value,
      font: state.font,
      paper: state.paper,
      ink: state.ink,
      fontSize: state.fontSize,
      lineSpacing: state.lineSpacing,
      alignment: state.alignment,
      zoom: state.zoom
    };
  }

  function safeFileName(value) {
    const cleaned = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
    return cleaned || "scribbly-notes";
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1200);
  }

  function firstTitle() {
    const firstLine = input.value.split("\n").find((line) => line.trim());
    return safeFileName(firstLine ? firstLine.replace(/^#+\s*/, "") : "scribbly-notes");
  }

  function renderExportCanvas(pageIndex) {
    const exportCanvas = document.createElement("canvas");
    drawPage(exportCanvas, pageIndex, 2);
    return exportCanvas;
  }

  function savePageImage(pageIndex) {
    const exportCanvas = renderExportCanvas(pageIndex);
    exportCanvas.toBlob((blob) => {
      if (!blob) {
        showToast("This page could not be exported as an image.");
        return;
      }
      downloadBlob(blob, `${firstTitle()}-page-${pageIndex + 1}.png`);
    }, "image/png");
  }

  function exportAllImages() {
    state.pages.forEach((_, index) => {
      setTimeout(() => savePageImage(index), index * 350);
    });
    showToast(`Preparing ${state.pages.length} page${state.pages.length === 1 ? "" : "s"} as PNG images…`);
  }

  function concatBytes(chunks) {
    const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const result = new Uint8Array(length);
    let offset = 0;
    chunks.forEach((chunk) => { result.set(chunk, offset); offset += chunk.length; });
    return result;
  }

  function ascii(value) {
    return new TextEncoder().encode(value);
  }

  async function createPdf() {
    const objectChunks = [];
    const offsets = [0];
    let cursor = ascii("%PDF-1.4\n% Scribbly Notes\n").length;
    const addObject = (number, parts) => {
      offsets[number] = cursor;
      const full = concatBytes([ascii(`${number} 0 obj\n`), ...parts, ascii("\nendobj\n")]);
      objectChunks.push(full);
      cursor += full.length;
    };
    const pageCount = state.pages.length;
    const pageIds = [];
    for (let i = 0; i < pageCount; i += 1) pageIds.push(3 + i * 3);
    addObject(1, [ascii("<< /Type /Catalog /Pages 2 0 R >>")]);
    addObject(2, [ascii(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageCount} >>`)]);
    for (let i = 0; i < pageCount; i += 1) {
      const pageId = pageIds[i];
      const contentId = pageId + 1;
      const imageId = pageId + 2;
      const exportCanvas = renderExportCanvas(i);
      const jpeg = await new Promise((resolve) => exportCanvas.toBlob(resolve, "image/jpeg", .95));
      if (!jpeg) throw new Error("The browser could not render a page for PDF export.");
      const imageBytes = new Uint8Array(await jpeg.arrayBuffer());
      const content = ascii("q\n595.28 0 0 841.89 0 0 cm\n/Im0 Do\nQ");
      addObject(pageId, [ascii(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`)]);
      addObject(contentId, [ascii(`<< /Length ${content.length} >>\nstream\n`), content, ascii("\nendstream")]);
      addObject(imageId, [ascii(`<< /Type /XObject /Subtype /Image /Width ${exportCanvas.width} /Height ${exportCanvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imageBytes.length} >>\nstream\n`), imageBytes, ascii("\nendstream")]);
    }
    const xrefOffset = cursor;
    let xref = `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
    for (let i = 1; i < offsets.length; i += 1) xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
    const trailer = `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
    const header = ascii("%PDF-1.4\n% Scribbly Notes\n");
    return new Blob([header, ...objectChunks, ascii(xref + trailer)], { type: "application/pdf" });
  }

  async function exportPdf() {
    $("exportPdfButton").disabled = true;
    try {
      const blob = await createPdf();
      downloadBlob(blob, `${firstTitle()}.pdf`);
      showToast(`Your ${state.pages.length}-page PDF is ready.`);
    } catch (error) {
      console.error("Unable to export Scribbly Notes PDF.", error);
      showToast("PDF export failed. Please try again in this browser.");
    } finally {
      $("exportPdfButton").disabled = false;
    }
  }

  function readLibrary() {
    try {
      const parsed = JSON.parse(localStorage.getItem(LIBRARY_KEY) || "[]");
      return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.text === "string" && typeof item.id === "string") : [];
    } catch (error) {
      console.error("Unable to read saved Scribbly Notes library.", error);
      return [];
    }
  }

  function saveToLibrary() {
    if (!input.value.trim()) {
      showToast("Add a few notes before saving them.");
      return;
    }
    const library = readLibrary();
    const title = input.value.split("\n").find((line) => line.trim())?.replace(/^#+\s*/, "").slice(0, 60) || "Untitled notes";
    library.unshift({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, title, savedAt: new Date().toISOString(), data: savedStateObject(), text: input.value });
    try {
      localStorage.setItem(LIBRARY_KEY, JSON.stringify(library.slice(0, 30)));
      showToast("Notes saved to your little library.");
    } catch (error) {
      console.error("Unable to save notes to the local library.", error);
      showToast("Could not save your notes. Your browser storage may be full.");
    }
  }

  function renderLibrary() {
    const list = $("savedNotesList");
    const library = readLibrary();
    list.replaceChildren();
    if (!library.length) {
      list.innerHTML = '<div class="empty-library">Nothing tucked away just yet.<br />Save a note to find it here ✦</div>';
      return;
    }
    library.forEach((entry) => {
      const row = document.createElement("div");
      row.className = "saved-note";
      const main = document.createElement("button");
      main.type = "button";
      main.className = "saved-note-main";
      const title = document.createElement("b");
      title.textContent = entry.title || "Untitled notes";
      const date = document.createElement("small");
      const parsedDate = new Date(entry.savedAt);
      date.textContent = Number.isNaN(parsedDate.getTime()) ? "Saved on this device" : `Saved ${parsedDate.toLocaleDateString()}`;
      main.append(title, date);
      main.addEventListener("click", () => {
        loadState(entry.data || { text: entry.text });
        $("notesDialog").close();
        showToast("Your saved notes are back.");
      });
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Remove";
      remove.setAttribute("aria-label", `Remove ${entry.title || "saved notes"}`);
      remove.addEventListener("click", () => {
        const latest = readLibrary().filter((saved) => saved.id !== entry.id);
        localStorage.setItem(LIBRARY_KEY, JSON.stringify(latest));
        renderLibrary();
      });
      row.append(main, remove);
      list.append(row);
    });
  }

  function downloadBackup() {
    const data = { format: "scribbly-notes", version: 1, current: savedStateObject(), library: readLibrary() };
    downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }), "scribbly-notes-backup.json");
  }

  async function loadBackup(file) {
    $("importError").textContent = "";
    if (!file) return;
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error("That backup is larger than 5 MB.");
      const parsed = JSON.parse(await file.text());
      const candidate = parsed && parsed.format === "scribbly-notes" ? parsed.current : parsed;
      if (!candidate || typeof candidate !== "object" || typeof candidate.text !== "string" || candidate.text.length > 500000) {
        throw new Error("This file does not look like a valid Scribbly Notes backup.");
      }
      loadState(candidate);
      if (parsed.format === "scribbly-notes" && Array.isArray(parsed.library)) {
        const validLibrary = parsed.library.filter((entry) => entry && typeof entry.id === "string" && typeof entry.text === "string" && entry.data && typeof entry.data.text === "string").slice(0, 30);
        localStorage.setItem(LIBRARY_KEY, JSON.stringify(validLibrary));
      }
      $("settingsDialog").close();
      showToast("Backup loaded successfully.");
    } catch (error) {
      $("importError").textContent = error instanceof SyntaxError ? "That file isn't valid JSON. Please choose a Scribbly Notes backup." : error.message;
    } finally {
      $("loadBackupInput").value = "";
    }
  }

  function openPrintDialog() {
    const old = document.querySelector(".print-document");
    if (old) old.remove();
    const documentPages = document.createElement("div");
    documentPages.className = "print-document";
    state.pages.forEach((_, index) => {
      const page = document.createElement("div");
      page.className = "print-page";
      const image = renderExportCanvas(index);
      const img = document.createElement("img");
      img.src = image.toDataURL("image/png");
      page.append(img);
      documentPages.append(page);
    });
    document.body.append(documentPages);
    document.body.classList.add("printing");
    const cleanup = () => {
      document.body.classList.remove("printing");
      documentPages.remove();
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup, { once: true });
    window.print();
  }

  function changeSetting(key, value) {
    state[key] = value;
    state.page = 0;
    render();
  }

  input.addEventListener("input", () => {
    history.splice(historyIndex + 1);
    if (history[history.length - 1] !== input.value) {
      history.push(input.value);
      if (history.length > 80) history.shift();
      historyIndex = history.length - 1;
    }
    render();
  });
  $("fontStyle").addEventListener("change", (event) => changeSetting("font", event.target.value));
  $("paperStyle").addEventListener("change", (event) => changeSetting("paper", event.target.value));
  $("fontSize").addEventListener("change", (event) => changeSetting("fontSize", Number(event.target.value)));
  $("lineSpacing").addEventListener("change", (event) => changeSetting("lineSpacing", Number(event.target.value)));
  $("textAlignment").addEventListener("change", (event) => changeSetting("alignment", event.target.value));
  document.querySelectorAll(".ink-swatch").forEach((swatch) => swatch.addEventListener("click", () => {
    state.ink = swatch.dataset.color;
    updateInkUI();
    render();
  }));
  $("customColor").addEventListener("input", (event) => {
    state.ink = event.target.value;
    updateInkUI();
    render();
  });
  $("boldButton").addEventListener("click", () => formatSelection("bold"));
  $("italicButton").addEventListener("click", () => formatSelection("italic"));
  $("headingButton").addEventListener("click", () => formatSelection("heading"));
  $("undoButton").addEventListener("click", () => {
    if (historyIndex > 0) {
      historyIndex -= 1;
      input.value = history[historyIndex];
      render();
      input.focus();
    }
  });
  $("redoButton").addEventListener("click", () => {
    if (historyIndex < history.length - 1) {
      historyIndex += 1;
      input.value = history[historyIndex];
      render();
      input.focus();
    }
  });
  $("clearButton").addEventListener("click", () => {
    if (input.value && window.confirm("Clear all of these notes?")) setText("");
  });
  $("previousPage").addEventListener("click", () => {
    if (state.page > 0) { state.page -= 1; updatePageView(); }
  });
  $("nextPage").addEventListener("click", () => {
    if (state.page < state.pages.length - 1) { state.page += 1; updatePageView(); }
  });
  $("zoomOutButton").addEventListener("click", () => {
    if (state.zoom > 80) changeSetting("zoom", state.zoom - 10);
  });
  $("zoomInButton").addEventListener("click", () => {
    if (state.zoom < 120) changeSetting("zoom", state.zoom + 10);
  });
  $("saveImageButton").addEventListener("click", () => {
    if (state.pages.length > 1 && window.confirm("Export every page as a separate PNG? Choose Cancel to save only the page you are viewing.")) exportAllImages();
    else savePageImage(state.page);
  });
  $("exportPdfButton").addEventListener("click", exportPdf);
  $("printButton").addEventListener("click", openPrintDialog);
  $("saveNotesButton").addEventListener("click", saveToLibrary);
  $("myNotesButton").addEventListener("click", () => { renderLibrary(); $("notesDialog").showModal(); });
  $("settingsButton").addEventListener("click", () => $("settingsDialog").showModal());
  document.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
  $("backupButton").addEventListener("click", downloadBackup);
  $("loadBackupInput").addEventListener("change", (event) => loadBackup(event.target.files[0]));
  $("noteInput").addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "b") { event.preventDefault(); formatSelection("bold"); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "i") { event.preventDefault(); formatSelection("italic"); }
  });

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && !loadState(JSON.parse(saved))) throw new Error("Saved note data had an unexpected format.");
  } catch (error) {
    console.error("Unable to restore Scribbly Notes state.", error);
    showToast("We couldn't restore your last notes. You can start fresh.");
  }
  if (!input.value) {
    input.value = SAMPLE;
    state.text = SAMPLE;
    history[0] = SAMPLE;
  }
  state.text = input.value;
  Promise.all(Object.values(FONT_FAMILIES).map((family) => document.fonts.load(`22px "${family}"`))).then(() => {
    state.pages = paginate(state.text, ctx);
    updatePageView();
  }).catch((error) => {
    console.error("One or more local handwriting fonts could not be loaded.", error);
    showToast("A handwriting font could not load; try refreshing the page.");
  });
  render();
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
    navigator.serviceWorker.register("./sw.js").catch((error) => console.error("Offline support could not be enabled.", error));
  }
})();
