/*
 * build.js — assembles the Outlook add-in pages from the EXISTING Power Pages
 * builder source, so there is a single source of truth for the builder logic.
 *
 * For each builder it produces a standalone HTML document in dist/:
 *   - dist/quotation.html   (from the Quotation page)
 *   - dist/dell-quote.html  (from the Dell-Quote page)
 *
 * Each document = <head> (Office.js + SSO bootstrap + add-in shell CSS + the
 * page's own custom CSS) + <body> (the page's copy.html body, which already
 * contains the html2pdf CDN tag and the inline JSON data blocks) + the page's
 * own custom JavaScript appended at the end.
 *
 * Static files in src/static/ (commands.html, office-sso.js, icons, logo) are
 * copied verbatim into dist/.
 */
"use strict";

var fs = require("fs");
var path = require("path");

var ROOT = __dirname;
var SITE = path.resolve(ROOT, "..", "quotation---site-j0yx8", "web-pages");
var DIST = path.join(ROOT, "dist");
var STATIC = path.join(ROOT, "src", "static");

var PAGES = [
  {
    out: "quotation.html",
    title: "Start a Quotation",
    dir: path.join(SITE, "quotation", "content-pages"),
    base: "Quotation.en-US.webpage"
  },
  {
    out: "dell-quote.html",
    title: "Build Dell Quote",
    dir: path.join(SITE, "dell-quote", "content-pages"),
    base: "Dell-Quote.en-US.webpage"
  }
];

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function readIfExists(file) {
  return fs.existsSync(file) ? read(file) : "";
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  ensureDir(dest);
  fs.readdirSync(src).forEach(function (name) {
    var s = path.join(src, name);
    var d = path.join(dest, name);
    if (fs.statSync(s).isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  });
}

// SHELL_CSS is injected ONLY into the add-in's dist/ pages (not the Power Pages
// site, which uses the raw source files). It auto-fits the wide builder layout
// into Outlook's narrow ~300-360px task pane so nothing has to be dragged wider.
var SHELL_CSS = [
  "/* Add-in shell: makes the lifted builders usable in a narrow Outlook task pane */",
  "html,body{margin:0;padding:0;}",
  "*{box-sizing:border-box;}",
  "body{font-family:'Segoe UI',Tahoma,Arial,sans-serif;background:#f3f4f6;-webkit-text-size-adjust:100%;overflow-x:hidden;}",
  "img{max-width:100%;height:auto;}",
  ".addin-banner{display:none;font-size:12px;padding:6px 10px;background:#eef4ff;color:#0b5cab;border-bottom:1px solid #cfe0f7;}",
  ".addin-banner.show{display:block;}",
  "",
  "/* The builder is a full-bleed pane here, not a centred 1180px A4 sheet. */",
  ".qt-wrapper,.dq-wrapper{max-width:100% !important;margin:0 !important;padding:8px 10px !important;}",
  "",
  "/* The add-in pane is ALWAYS narrow, so stack every 2-column layout into one",
  "   column unconditionally. This prevents the cramped columns that make long",
  "   values (e.g. the quote number) wrap one character per line. */",
  ".qt-grid,.dq-grid,.qt-cs-two-col,.qt-builder-row,.qt-ws-selectors{",
  "  display:grid !important;grid-template-columns:1fr !important;gap:10px 0 !important;}",
  ".qt-span-2{grid-column:auto !important;}",
  "",
  "/* QUOTATION header: left-align the meta block (To / Quotation No / Date /",
  "   Valid Until) once it is stacked, and drop the fixed label width so values",
  "   keep their own line instead of being squeezed. */",
  ".qt-cs-right{text-align:left !important;}",
  ".qt-cs-right .qt-cs-row{justify-content:flex-start !important;}",
  ".qt-cs-l{min-width:auto !important;}",
  ".qt-cs-v,.qt-cs-l{word-break:break-word;overflow-wrap:anywhere;}",
  "",
  "/* Mode switch (Software / Hardware / Server) wraps to full-width buttons",
  "   instead of three unreadable slivers. */",
  ".qt-mode-bar{flex-wrap:wrap !important;max-width:100% !important;}",
  ".qt-mode-btn{flex:1 1 100% !important;}",
  "",
  "/* Wide data tables scroll horizontally inside their wrapper rather than",
  "   pushing the whole pane sideways. */",
  ".qt-table-wrap,.qt-table-scroll,.qt-shared-area,#qt-shared-area,.dq-table-wrap{",
  "  overflow-x:auto !important;-webkit-overflow-scrolling:touch;max-width:100%;}",
  "",
  "@media (max-width:600px){",
  "  .qt-card,.qt-customer-summary{padding:12px !important;}",
  "  .qt-table,.dq-document table{font-size:11px !important;}",
  "}"
].join("\n");

function buildPage(page) {
  var body = read(path.join(page.dir, page.base + ".copy.html"));
  var css = readIfExists(path.join(page.dir, page.base + ".custom_css.css"));
  var js = readIfExists(path.join(page.dir, page.base + ".custom_javascript.js"));

  var doc =
    "<!DOCTYPE html>\n" +
    "<html lang=\"en\">\n" +
    "<head>\n" +
    "  <meta charset=\"UTF-8\" />\n" +
    "  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />\n" +
    "  <title>" + page.title + " — Smartsoft</title>\n" +
    "  <!-- Office.js: required for task-pane lifecycle + SSO -->\n" +
    "  <script src=\"https://appsforoffice.microsoft.com/lib/1/hosted/office.js\"></script>\n" +
    "  <script src=\"office-sso.js\"></script>\n" +
    "  <style>\n" + SHELL_CSS + "\n</style>\n" +
    "  <style>\n" + css + "\n</style>\n" +
    "</head>\n" +
    "<body>\n" +
    "  <div id=\"addin-identity\" class=\"addin-banner\"></div>\n" +
    body + "\n" +
    "  <!-- Lifted page logic (single source of truth: Power Pages custom JS) -->\n" +
    "  <script>\n" + js + "\n</script>\n" +
    "</body>\n" +
    "</html>\n";

  ensureDir(DIST);
  fs.writeFileSync(path.join(DIST, page.out), doc, "utf8");
  console.log("  built dist/" + page.out +
    "  (body " + body.length + "b, css " + css.length + "b, js " + js.length + "b)");
}

function main() {
  console.log("Building Outlook add-in pages from Power Pages source...");
  ensureDir(DIST);
  PAGES.forEach(buildPage);
  copyDir(STATIC, DIST);
  console.log("Copied static assets from src/static/ -> dist/");
  console.log("Done.");
}

main();
