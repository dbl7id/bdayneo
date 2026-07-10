/* ===================================================================
   BDAY NEO WIKI — BUILDER SCRIPT
   Loads content.xml (+ images), renders a live preview, and can
   "compile" everything into one self-contained HTML file for download.
   =================================================================== */

const state = {
  xmlDoc: null,
  xmlText: null,
  mode: null,          // 'fetch' | 'files'
  pickedFiles: {},     // basename -> File   (only used in 'files' mode)
};

const ICONS = { installation: "\u2B07", update: "\u21BB", troubleshooting: "\u2699" };

// ---------- theme ----------

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  try { localStorage.setItem("bdayneo-theme", theme); } catch (e) {}
  const btn = document.getElementById("themeToggle");
  if (btn) btn.textContent = theme === "day" ? "\u2600" : "\u263D";
}

function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem("bdayneo-theme"); } catch (e) {}
  if (!saved) {
    saved = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "day" : "night";
  }
  applyTheme(saved);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme");
  applyTheme(current === "day" ? "night" : "day");
}

// ---------- render ----------
//
// A section's body can reference media inline, right where it belongs in
// the instructions, using a placeholder:
//     <img-slot ref="prism_login"/>
//     <video-slot ref="update-video"/>
// ...matched against an <image id="prism_login" .../> or
// <video id="update-video" .../> tag in the same section. Any media tag
// that ISN'T referenced by a slot still gets appended at the end of the
// section (handy for quick single-item cases where placement doesn't matter).
//
// renderSite (live preview) and compileSite (single-file export) both build
// through buildSectionMarkup so the two never drift out of sync.

async function buildSectionMarkup(sec, resolver) {
  const id = sec.getAttribute("id") || "";
  const nav = sec.getAttribute("nav") || "";
  const title = sec.getAttribute("title") || "";
  const heading = (sec.getAttribute("heading") || "h2").toLowerCase();
  const tag = ["h1", "h2", "h3"].includes(heading) ? heading : "h2";
  const accent = sec.getAttribute("accent") || "moss";

  const bodyEl = sec.querySelector("body");
  let bodyHTML = bodyEl ? bodyEl.textContent.trim() : "";

  const imageTags = Array.from(sec.querySelectorAll("image"));
  const videoTags = Array.from(sec.querySelectorAll("video"));
  const usedIds = new Set();

  const slotRegex = /<(img|video)-slot\s+ref="([^"]+)"\s*\/?>/g;
  const refs = [];
  let m;
  while ((m = slotRegex.exec(bodyHTML))) refs.push({ full: m[0], kind: m[1], ref: m[2] });

  for (const r of refs) {
    const catalog = r.kind === "video" ? videoTags : imageTags;
    const mediaTag = catalog.find((t) => t.getAttribute("id") === r.ref);
    if (!mediaTag) {
      bodyHTML = bodyHTML.replace(r.full, `<!-- missing ${r.kind} id: ${escapeAttr(r.ref)} -->`);
      continue;
    }
    usedIds.add(r.ref);
    const markup = r.kind === "video" ? await videoHTMLFor(mediaTag, resolver) : await figureHTMLFor(mediaTag, resolver);
    bodyHTML = bodyHTML.replace(r.full, markup);
  }

  let galleryHTML = "";
  for (const imgTag of imageTags) {
    const imgId = imgTag.getAttribute("id");
    if (imgId && usedIds.has(imgId)) continue;
    galleryHTML += await figureHTMLFor(imgTag, resolver);
  }
  for (const vidTag of videoTags) {
    const vidId = vidTag.getAttribute("id");
    if (vidId && usedIds.has(vidId)) continue;
    galleryHTML += await videoHTMLFor(vidTag, resolver);
  }

  return { id, nav, title, tag, accent, bodyHTML, galleryHTML };
}

async function figureHTMLFor(imgTag, resolver) {
  const src = imgTag.getAttribute("src") || "";
  const alt = imgTag.getAttribute("alt") || "";
  const caption = imgTag.getAttribute("caption") || "";
  const width = imgTag.getAttribute("width") || "700";
  const align = imgTag.getAttribute("align") || "center";
  const resolvedSrc = await resolver(src);
  return `<figure class="wiki-figure align-${escapeAttr(align)}">
    <img src="${resolvedSrc}" alt="${escapeAttr(alt)}" style="max-width:min(${escapeAttr(width)}px, 100%); height:auto;">
    ${caption ? `<figcaption>${escapeHTML(caption)}</figcaption>` : ""}
  </figure>`;
}

async function videoHTMLFor(vidTag, resolver) {
  const src = vidTag.getAttribute("src") || "";
  const caption = vidTag.getAttribute("caption") || "";
  const width = vidTag.getAttribute("width") || "800";
  const align = vidTag.getAttribute("align") || "center";
  const posterSrc = vidTag.getAttribute("poster") || "";
  const resolvedSrc = await resolver(src);
  const resolvedPoster = posterSrc ? await resolver(posterSrc) : "";

  if (isMissingMediaPlaceholder(resolvedSrc)) {
    return `<figure class="wiki-figure align-${escapeAttr(align)}">
      <div class="media-missing" style="max-width:${escapeAttr(width)}px">video not found: ${escapeHTML(src.split("/").pop())}</div>
      ${caption ? `<figcaption>${escapeHTML(caption)}</figcaption>` : ""}
    </figure>`;
  }

  return `<figure class="wiki-figure align-${escapeAttr(align)}">
    <video controls preload="metadata" style="max-width:min(${escapeAttr(width)}px, 100%); height:auto;"${resolvedPoster ? ` poster="${resolvedPoster}"` : ""}>
      <source src="${resolvedSrc}">
      Your browser doesn't support embedded video. <a href="${resolvedSrc}" download>Download the video</a> instead.
    </video>
    ${caption ? `<figcaption>${escapeHTML(caption)}</figcaption>` : ""}
  </figure>`;
}

function isMissingMediaPlaceholder(resolvedSrc) {
  return typeof resolvedSrc === "string" && resolvedSrc.startsWith("data:image/svg+xml;utf8,");
}

async function renderSite(xmlDoc) {
  const siteTitleEl = xmlDoc.querySelector("meta > sitetitle");
  const siteTitle = siteTitleEl ? siteTitleEl.textContent.trim() : "Modpack Wiki";
  document.title = siteTitle;
  document.getElementById("siteTitle").textContent = siteTitle;

  const sections = Array.from(xmlDoc.querySelectorAll("wiki > section"));
  const hotbar = document.getElementById("hotbar");
  const main = document.getElementById("siteContent");
  hotbar.innerHTML = "";
  main.innerHTML = "";

  for (const sec of sections) {
    const built = await buildSectionMarkup(sec, resolveImageSrc);

    if (built.nav) {
      const a = document.createElement("a");
      a.href = "#" + built.id;
      a.className = "slot";
      a.style.setProperty("--slot-accent", `var(--accent-${built.accent})`);
      a.textContent = built.nav;
      hotbar.appendChild(a);
    }

    const section = document.createElement("section");
    section.className = `wiki-section accent-${built.accent}`;
    section.id = built.id;
    section.innerHTML = `<${built.tag} class="section-title">${escapeHTML(built.title)}</${built.tag}>
      <div class="section-body">${built.bodyHTML}</div>
      ${built.galleryHTML}`;
    main.appendChild(section);
  }
}

// Resolve an image path to something the <img> tag can display right now,
// depending on which loading mode we're in.
async function resolveImageSrc(src) {
  if (state.mode === "files") {
    const basename = src.split("/").pop();
    const file = state.pickedFiles[basename];
    if (file) return await fileToDataURL(file);
    return "data:image/svg+xml;utf8," + encodeURIComponent(missingImageSVG(basename));
  }
  // fetch mode: relative path works directly in the browser
  return src;
}

function missingImageSVG(name) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 220"><rect width="400" height="220" fill="#3a1f1f"/><text x="200" y="105" font-family="monospace" font-size="14" fill="#e7cccc" text-anchor="middle">image not found</text><text x="200" y="128" font-family="monospace" font-size="12" fill="#c99" text-anchor="middle">${name}</text></svg>`;
}

// Converts a File or Blob to a data: URL via arrayBuffer + manual base64
// encoding. Deliberately avoids FileReader.readAsDataURL, which chokes in
// some environments when handed a Blob that didn't originate from the same
// realm (e.g. one produced by fetch()).
async function fileToDataURL(file) {
  return blobToDataURL(file);
}

async function blobToDataURL(blob) {
  const buffer = await blob.arrayBuffer();
  const base64 = arrayBufferToBase64(buffer);
  const type = blob.type || "application/octet-stream";
  return `data:${type};base64,${base64}`;
}

function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// ---------- loading ----------

function setStatus(msg, ok) {
  const el = document.getElementById("loadStatus");
  el.textContent = msg;
  el.className = "status " + (ok ? "ok" : "err");
}

async function tryAutoLoad() {
  try {
    const res = await fetch("content.xml", { cache: "no-store" });
    if (!res.ok) throw new Error("not ok");
    const text = await res.text();
    loadXmlText(text, "fetch");
    setStatus("Loaded content.xml automatically.", true);
  } catch (e) {
    setStatus("Couldn't auto-load content.xml (this is normal if you opened this file directly, without a local server). Use the buttons below instead.", false);
  }
}

function loadXmlText(text, mode) {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(text, "application/xml");
  const err = xmlDoc.querySelector("parsererror");
  if (err) {
    setStatus("content.xml has an XML error — check for unescaped < > & characters or unclosed tags.", false);
    return;
  }
  state.xmlDoc = xmlDoc;
  state.xmlText = text;
  state.mode = mode;
  renderSite(xmlDoc).catch((e) => {
    console.error(e);
    setStatus("Rendering error — check the browser console for details.", false);
  });
}

function initLoaders() {
  document.getElementById("xmlFilePicker").addEventListener("change", async (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    const text = await file.text();
    loadXmlText(text, "files");
    setStatus(`Loaded ${file.name} manually.`, true);
  });

  document.getElementById("imagesFolderPicker").addEventListener("change", (ev) => {
    const files = Array.from(ev.target.files);
    state.pickedFiles = {};
    files.forEach((f) => { state.pickedFiles[f.name] = f; });
    setStatus(`Loaded ${files.length} image file(s). Re-select content.xml above to refresh image previews.`, true);
    if (state.xmlDoc) renderSite(state.xmlDoc).catch((e) => console.error(e));
  });
}

// ---------- compile to single file ----------

async function compileSite() {
  const btn = document.getElementById("compileBtn");
  if (!state.xmlDoc) {
    alert("Load content.xml first (see the panel above).");
    return;
  }
  btn.disabled = true;
  btn.textContent = "Compiling\u2026";
  skippedLargeFiles.length = 0;

  try {
    const xmlDoc = state.xmlDoc;
    const siteTitleEl = xmlDoc.querySelector("meta > sitetitle");
    const siteTitle = siteTitleEl ? siteTitleEl.textContent.trim() : "Modpack Wiki";

    const cssText = await (await fetch("style.css", { cache: "no-store" })).text();

    const sections = Array.from(xmlDoc.querySelectorAll("wiki > section"));
    let hotbarHTML = "";
    let sectionsHTML = "";

    for (const sec of sections) {
      const built = await buildSectionMarkup(sec, inlineImage);

      if (built.nav) {
        hotbarHTML += `<a href="#${escapeAttr(built.id)}" class="slot" style="--slot-accent:var(--accent-${escapeAttr(built.accent)})">${escapeHTML(built.nav)}</a>\n`;
      }

      sectionsHTML += `<section id="${escapeAttr(built.id)}" class="wiki-section accent-${escapeAttr(built.accent)}">
        <${built.tag} class="section-title">${escapeHTML(built.title)}</${built.tag}>
        <div class="section-body">${built.bodyHTML}</div>
        ${built.galleryHTML}
      </section>\n`;
    }

    const finalHTML = buildFinalHTML(siteTitle, hotbarHTML, sectionsHTML, cssText);
    downloadFile(slugify(siteTitle) + ".html", finalHTML);

    if (skippedLargeFiles.length) {
      alert(
        "Downloaded. Note: these files were kept separate instead of embedded " +
        "(you chose not to embed them) — make sure to include them alongside the HTML file " +
        "when you share it:\n\n" + skippedLargeFiles.join("\n")
      );
    }
  } catch (e) {
    console.error(e);
    alert("Compile failed: " + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Compile & Download Single HTML";
  }
}

// Bytes above this threshold trigger a confirmation before being embedded
// as base64 into the compiled file — mainly relevant for video. Declining
// leaves the src as a plain relative/absolute path instead of inlining it,
// which means that file has to be kept alongside the compiled HTML.
const LARGE_FILE_WARN_BYTES = 15 * 1024 * 1024; // 15 MB
const skippedLargeFiles = [];

function formatBytes(bytes) {
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

// Returns true if the file should be embedded, false if the user opted to
// leave it external. Always true for files under the threshold.
function confirmLargeEmbed(name, bytes) {
  if (bytes < LARGE_FILE_WARN_BYTES) return true;
  const estimate = formatBytes(bytes * 1.37); // base64 overhead
  const proceed = confirm(
    `${name} is ${formatBytes(bytes)}. Embedding it will add about ${estimate} to the ` +
    `downloaded HTML file, and may take a while to generate and open.\n\n` +
    `Click OK to embed it anyway, or Cancel to keep it as a separate file that ` +
    `must be kept alongside the HTML when you share it.`
  );
  if (!proceed) skippedLargeFiles.push(name);
  return proceed;
}

async function inlineImage(src) {
  const basename = src.split("/").pop();

  if (state.mode === "files") {
    const file = state.pickedFiles[basename];
    if (!file) return "data:image/svg+xml;utf8," + encodeURIComponent(missingImageSVG(basename));
    if (!confirmLargeEmbed(basename, file.size)) return src;
    return await fileToDataURL(file);
  }

  try {
    const res = await fetch(src, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const blob = await res.blob();
    if (!confirmLargeEmbed(basename, blob.size)) return src;
    return await blobToDataURL(blob);
  } catch (e) {
    return "data:image/svg+xml;utf8," + encodeURIComponent(missingImageSVG(src));
  }
}

function buildFinalHTML(siteTitle, hotbarHTML, sectionsHTML, cssText) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHTML(siteTitle)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">
<style>
${cssText}
</style>
</head>
<body>
<header class="site-header">
  <h1 class="site-title" id="siteTitle">${escapeHTML(siteTitle)}</h1>
  <p class="site-subtitle">jump to a section</p>
  <nav class="hotbar" id="hotbar">
    ${hotbarHTML}
    <button class="slot theme-slot" id="themeToggle" onclick="bdayToggleTheme()" aria-label="Toggle day/night mode" type="button">\u263D</button>
  </nav>
</header>
<main id="siteContent">
${sectionsHTML}
</main>
<footer class="site-footer">BDAY Neo &middot; generated wiki</footer>
<script>
function bdayApplyTheme(t){document.documentElement.setAttribute('data-theme',t);try{localStorage.setItem('bdayneo-theme',t);}catch(e){}var b=document.getElementById('themeToggle');if(b)b.textContent=t==='day'?'\\u2600':'\\u263D';}
function bdayToggleTheme(){var c=document.documentElement.getAttribute('data-theme');bdayApplyTheme(c==='day'?'night':'day');}
(function(){var saved=null;try{saved=localStorage.getItem('bdayneo-theme');}catch(e){}if(!saved){saved=(window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches)?'day':'night';}bdayApplyTheme(saved);})();
<\/script>
</body>
</html>`;
}

// ---------- utils ----------

function escapeHTML(str) {
  return String(str).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}
function escapeAttr(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function slugify(str) {
  return String(str).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "wiki";
}
function downloadFile(filename, content) {
  const blob = new Blob([content], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---------- boot ----------

document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  document.getElementById("themeToggle").addEventListener("click", toggleTheme);
  initLoaders();
  document.getElementById("compileBtn").addEventListener("click", compileSite);
  tryAutoLoad();
});
