import { cp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { allPages, developerPages, userPages } from "../src/data/pages.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = root;
const obsoleteDist = join(root, "dist");
const staleGeneratedPages = [
  "aliases.html",
  "autocomplete.html",
  "developer-api.html",
  "developer-environment-variables.html",
  "developer-extension-development.html",
  "engines.html",
  "env.html",
  "plugins.html",
  "shortcuts.html",
  "store.html",
  "styling.html",
  "themes.html",
  "translations.html",
  "transports.html"
];
const generatedOutputs = [
  ...allPages.map((page) => page.file),
  ...staleGeneratedPages,
  "style.css",
  "docs.js",
  "docs-ui.js",
  "search-index.json",
  "search-index.js",
  "images",
  "fontawesome",
  "placeholders"
];

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const HTML_ENTITIES = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " "
};

const plainText = (html) =>
  html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, (entity) => HTML_ENTITIES[entity.toLowerCase()] || " ")
    .replace(/\s+/g, " ")
    .trim();

function navItem(page) {
  return `<a href="${page.file}" class="degoog-docs-nav-item" data-page="${page.file}">
              <i class="fa-solid ${page.icon} fa-lg"></i>
              <span class="degoog-docs-nav-item-name">${escapeHtml(page.navTitle)}</span>
            </a>`;
}

function navSection(title, pages) {
  return `<div class="doc-nav-section">
            <div class="doc-nav-section-title">${escapeHtml(title)}</div>
            ${pages.map(navItem).join("\n")}
          </div>`;
}

function renderPage(page, content) {
  const mode = developerPages.some((entry) => entry.file === page.file) ? "developer" : "user";
  const activeNav = mode === "developer" ? navSection("Developer docs", developerPages) : navSection("User docs", userPages);
  const userActive = mode === "user" ? "doc-mode-active" : "";
  const developerActive = mode === "developer" ? "doc-mode-active" : "";

  return `<!doctype html>
<html lang="en" data-theme="light">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(page.title)}</title>
    <script>
      (function () {
        try {
          var t = localStorage.getItem("ade:theme");
          if (t !== "light" && t !== "dark") {
            t = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
          }
          document.documentElement.setAttribute("data-theme", t);
        } catch (e) {}
      })();
    </script>
    <link rel="icon" href="images/degoog-logo.png" />
    <link rel="stylesheet" href="fontawesome/css/all.min.css" />
    <link rel="stylesheet" href="style.css" />
  </head>
  <body>
    <div class="degoog-docs-layout" data-doc-mode="${mode}">
      <header class="degoog-docs-mobile-header">
        <button id="degoog-docs-burger" type="button" class="degoog-docs-btn degoog-docs-btn-burger" aria-label="Open navigation">
          <i class="fa-solid fa-bars"></i>
        </button>
        <span class="degoog-docs-mobile-title">Degoog Docs</span>
      </header>
      <div class="degoog-docs-content">
        <aside class="degoog-docs-sidebar">
          <div class="degoog-docs-sidebar-brand">
            <img src="images/degoog-logo.png" alt="degoog logo" class="degoog-docs-brand-img" onerror="this.style.display = 'none'" />
            <a href="index.html" class="degoog-docs-brand-name">Degoog Docs</a>
          </div>
          <div class="doc-mode-switch" aria-label="Documentation mode">
            <a href="index.html" data-doc-mode="user" class="doc-mode-option ${userActive}">User docs</a>
            <a href="developer.html" data-doc-mode="developer" class="doc-mode-option ${developerActive}">Developer docs</a>
          </div>
          <div class="degoog-docs-sidebar-search">
            <div class="doc-search-wrap">
              <input type="search" id="doc-search-input" class="degoog-docs-input doc-search" placeholder="Search docs..." autocomplete="off" />
              <button type="button" class="doc-search-clear degoog-docs-btn" aria-label="Clear search" style="display: none">Clear</button>
              <span class="doc-search-count"></span>
            </div>
          </div>
          <nav class="degoog-docs-nav" aria-label="Documentation">
            ${activeNav}
          </nav>
          <div class="degoog-docs-sidebar-actions">
            <button id="doc-theme-toggle" type="button" class="degoog-docs-btn" aria-label="Toggle theme">
              <i class="fa-solid fa-circle-half-stroke"></i>
            </button>
          </div>
        </aside>
        <main class="degoog-docs-main">
${content}
        </main>
      </div>
      <div id="degoog-docs-backdrop" class="degoog-docs-backdrop"></div>
    </div>
    <script src="search-index.js"></script>
    <script src="docs.js"></script>
    <script src="docs-ui.js"></script>
  </body>
</html>
`;
}

await rm(obsoleteDist, { recursive: true, force: true });

for (const output of generatedOutputs) {
  await rm(join(outDir, output), { recursive: true, force: true });
}

await cp(join(root, "assets", "style.css"), join(outDir, "style.css"));
await cp(join(root, "assets", "docs.js"), join(outDir, "docs.js"));
await cp(join(root, "assets", "docs-ui.js"), join(outDir, "docs-ui.js"));
await cp(join(root, "assets", "images"), join(outDir, "images"), { recursive: true });
await cp(join(root, "assets", "placeholders"), join(outDir, "placeholders"), { recursive: true });
await cp(join(root, "assets", "fontawesome"), join(outDir, "fontawesome"), { recursive: true });

const searchEntries = [];

for (const page of allPages) {
  const contentPath = join(root, page.source);
  const content = await readFile(contentPath, "utf8");
  await writeFile(join(outDir, page.file), renderPage(page, content), "utf8");
  searchEntries.push({
    file: page.file,
    title: page.navTitle,
    description: page.description,
    text: plainText(content)
  });
}

await writeFile(
  join(outDir, "search-index.js"),
  `window.DEGOOG_SEARCH_INDEX = ${JSON.stringify(searchEntries)};\n`,
  "utf8"
);

await writeFile(
  join(outDir, "search-index.json"),
  `${JSON.stringify(
    allPages.map(({ file, navTitle, title, description }) => ({ file, navTitle, title, description })),
    null,
    2
  )}\n`,
  "utf8"
);

console.log(`Built ${allPages.length} pages into ${outDir}`);
