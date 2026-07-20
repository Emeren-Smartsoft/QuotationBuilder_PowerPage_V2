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
  },
  {
    out: "ocr-extract.html",
    title: "OCR Extract",
    dir: path.join(SITE, "ocr-extract", "content-pages"),
    base: "OCR-Extract.en-US.webpage"
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
  "/* OCR page: fit into narrow task pane */",
  ".ocr-wrapper{max-width:100% !important;margin:0 !important;padding:8px 10px !important;}",
  ".ocr-card{padding:14px 12px !important;}",
  ".ocr-drop-zone{padding:24px 12px !important;}",
  ".ocr-toolbar{flex-direction:column !important;align-items:stretch !important;}",
  ".ocr-toolbar>div{display:flex;flex-direction:column;gap:6px;}",
  ".ocr-steps-nav{flex-wrap:wrap !important;}",
  ".ocr-btn{padding:8px 12px !important;font-size:13px !important;width:100%;text-align:center;box-sizing:border-box;}",
  ".ocr-tabs{flex-wrap:wrap !important;}",
  ".ocr-preview{max-height:none !important;}",
  ".ocr-result-table{font-size:11px !important;}",
  ".ocr-result-table th,.ocr-result-table td{padding:5px 6px !important;}",
  "",
  "@media (max-width:600px){",
  "  .qt-card,.qt-customer-summary{padding:12px !important;}",
  "  .qt-table,.dq-document table{font-size:11px !important;}",
  "}"
].join("\n");

// SHELL_HTML is injected into <body> BEFORE the page content, add-in only.
// It provides an in-page email dialog that replaces window.prompt() calls,
// which are silently blocked in Outlook's Edge WebView2 task-pane runtime.
var SHELL_HTML = [
  "<!-- Add-in email dialog (replaces window.prompt blocked by Outlook WebView2) -->",
  "<div id=\"qt-addin-email-overlay\" style=\"display:none;position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:99999;align-items:center;justify-content:center;\">",
  "  <div style=\"background:#fff;border-radius:8px;padding:22px 20px;width:90%;max-width:340px;box-shadow:0 4px 24px rgba(0,0,0,.25);font-family:'Segoe UI',sans-serif;\">",
  "    <div style=\"font-size:15px;font-weight:700;color:#1a2533;margin-bottom:14px;\">Email Quotation</div>",
  "    <label style=\"display:block;font-size:12px;color:#555;margin-bottom:4px;\">To (recipient email) <span style=\"color:red\">*</span></label>",
  "    <input id=\"qt-addin-email-to\" type=\"email\" placeholder=\"customer@example.com\"",
  "      style=\"width:100%;padding:8px 10px;border:1px solid #ccc;border-radius:5px;font-size:13px;margin-bottom:10px;box-sizing:border-box;\"/>",
  "    <label style=\"display:block;font-size:12px;color:#555;margin-bottom:4px;\">CC (optional, comma-separated)</label>",
  "    <input id=\"qt-addin-email-cc\" type=\"text\" placeholder=\"cc@example.com\"",
  "      style=\"width:100%;padding:8px 10px;border:1px solid #ccc;border-radius:5px;font-size:13px;margin-bottom:16px;box-sizing:border-box;\"/>",
  "    <div style=\"display:flex;gap:10px;justify-content:flex-end;\">",
  "      <button id=\"qt-addin-email-cancel\" type=\"button\"",
  "        style=\"padding:8px 16px;border:1px solid #ccc;border-radius:5px;background:#f5f5f5;font-size:13px;cursor:pointer;\">Cancel</button>",
  "      <button id=\"qt-addin-email-send\" type=\"button\"",
  "        style=\"padding:8px 18px;border:0;border-radius:5px;background:#0b5cab;color:#fff;font-size:13px;font-weight:600;cursor:pointer;\">Send</button>",
  "    </div>",
  "  </div>",
  "</div>"
].join("\n");

// SHELL_JS is appended AFTER the page JS, add-in only.
// It patches the email buttons on both pages to use the in-page dialog
// instead of window.prompt(), which Outlook's WebView2 silently blocks.
var SHELL_JS = [
  "(function(){",
  "  var overlay = document.getElementById('qt-addin-email-overlay');",
  "  if (!overlay) return;",
  "  var toInput  = document.getElementById('qt-addin-email-to');",
  "  var ccInput  = document.getElementById('qt-addin-email-cc');",
  "  var sendBtn  = document.getElementById('qt-addin-email-send');",
  "  var cancelBtn= document.getElementById('qt-addin-email-cancel');",
  "  var _resolve = null;",
  "",
  "  // Replace window.prompt with our modal for add-in context.",
  "  // The page JS calls window.prompt() twice: once for To, once for CC.",
  "  // We intercept both with a single two-field modal.",
  "  var _promptCallCount = 0;",
  "  var _toValue = '';",
  "  var _ccValue = '';",
  "  var _originalPrompt = window.prompt;",
  "",
  "  function showEmailDialog(defaultTo) {",
  "    return new Promise(function(resolve) {",
  "      _resolve = resolve;",
  "      toInput.value = defaultTo || '';",
  "      ccInput.value = '';",
  "      overlay.style.display = 'flex';",
  "      setTimeout(function(){ toInput.focus(); }, 100);",
  "    });",
  "  }",
  "",
  "  function closeDialog(result) {",
  "    overlay.style.display = 'none';",
  "    if (_resolve) { _resolve(result); _resolve = null; }",
  "  }",
  "",
  "  sendBtn.addEventListener('click', function(){",
  "    var to = (toInput.value || '').trim();",
  "    if (!to || to.indexOf('@') === -1) {",
  "      toInput.style.borderColor = 'red';",
  "      toInput.focus();",
  "      return;",
  "    }",
  "    toInput.style.borderColor = '';",
  "    closeDialog({ to: to, cc: (ccInput.value || '').trim() });",
  "  });",
  "",
  "  cancelBtn.addEventListener('click', function(){ closeDialog(null); });",
  "",
  "  // Patch email buttons on both pages to use the dialog.",
  "  function patchEmailButton(btnId, getDefaultEmail) {",
  "    var btn = document.getElementById(btnId);",
  "    if (!btn) return;",
  "    // Clone to remove existing listeners wired by page JS.",
  "    var fresh = btn.cloneNode(true);",
  "    btn.parentNode.replaceChild(fresh, btn);",
  "    fresh.addEventListener('click', function(e) {",
  "      e.stopImmediatePropagation();",
  "      var defaultEmail = typeof getDefaultEmail === 'function' ? getDefaultEmail() : '';",
  "      showEmailDialog(defaultEmail).then(function(result) {",
  "        if (!result) return; // cancelled",
  "        // For the Quotation page: set pending fields then trigger save.",
  "        if (btnId === 'qt-email') {",
  "          // Check cart via the save button guard.",
  "          var saveBtn = document.getElementById('qt-save');",
  "          if (!saveBtn) { alert('Save button not found.'); return; }",
  "          // Build email fields the same way the page JS does.",
  "          var summaryEl = document.querySelector('.qt-customer-summary');",
  "          var qId = summaryEl ? (summaryEl.textContent.match(/QT-\\d+-\\d+/) || ['Quotation'])[0] : 'Quotation';",
  "          var contact = (document.querySelector('[name=contact]') || {}).value || 'Sir/Madam';",
  "          var subject = 'Proposal & Quotation - ' + qId + ' - Smartsoft';",
  "          var body = '<p>Dear ' + contact + ',</p>' +",
  "            '<p>Please find attached our proposal and quotation (Ref: <b>' + qId + '</b>) for your kind consideration.</p>' +",
  "            '<p>Should you need any clarifications, feel free to reach out.</p>' +",
  "            '<p>Warm regards,<br/>Smartsoft Team<br/>29 years of trusted IT solutions<br/>sales@smartsoft.co.in</p>';",
  "          window._pendingEmailFields = {",
  "            recipientEmail: result.to,",
  "            recipientName:  contact,",
  "            ccEmail:        result.cc,",
  "            emailSubject:   subject,",
  "            emailBody:      body",
  "          };",
  "          saveBtn.click();",
  "        }",
  "        // Dell-Quote page handled separately via patchDellEmailButton.",
  "      });",
  "    });",
  "  }",
  "",
  "  // Patch when DOM is ready (page JS may not have run yet).",
  "  function patchDellEmailButton() {",
  "    var btn = document.getElementById('dq-email-pdf');",
  "    if (!btn || btn._addinPatched) return;",
  "    btn._addinPatched = true;",
  "    // Use capturing so we intercept BEFORE page JS listener.",
  "    btn.addEventListener('click', function(e) {",
  "      e.stopImmediatePropagation(); // prevent page JS from running now",
  "      var defaultEmail = '';",
  "      showEmailDialog(defaultEmail).then(function(result) {",
  "        if (!result) return;",
  "        var calls = 0;",
  "        window.prompt = function() {",
  "          calls++;",
  "          if (calls === 1) return result.to;",
  "          if (calls === 2) return result.cc;",
  "          return null;",
  "        };",
  "        // Now fire a fresh click that the page JS listener will handle.",
  "        btn.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}));",
  "        setTimeout(function(){ window.prompt = _originalPrompt; }, 2000);",
  "      });",
  "    }, true); // capture phase",
  "  }",
  "",
  "  function tryPatch() {",
  "    patchEmailButton('qt-email', function(){ return (document.querySelector('[name=email]') || {}).value || ''; });",
  "    patchDellEmailButton();",
  "  }",
  "",
  "  if (document.readyState === 'loading') {",
  "    document.addEventListener('DOMContentLoaded', tryPatch);",
  "  } else {",
  "    // Page JS already ran; patch immediately then once more after a tick",
  "    // in case page JS clones/re-wires buttons during initialisation.",
  "    tryPatch();",
  "    setTimeout(tryPatch, 500);",
  "  }",
  "}());"
].join("\n");

// STATE_JS auto-saves and restores form inputs via localStorage so that
// if Outlook closes and reopens the task pane (e.g. message switch),
// the user's in-progress quotation data is preserved and restored.
// Uses localStorage (not sessionStorage) because Outlook creates a new
// WebView session each time the pane opens, which clears sessionStorage.
var STATE_JS = [
  "(function(){",
  "  var KEY = 'qb_addin_state_' + location.pathname.replace(/[^a-z0-9]/gi,'_');",
  "  var TS_KEY = KEY + '_ts';",
  "  var DEBOUNCE = 400;",
  "  var MAX_AGE = 8 * 60 * 60 * 1000; // 8 hours — auto-expire stale state",
  "  var _timer = null;",
  "",
  "  function getAllInputs(){",
  "    return document.querySelectorAll('input,textarea,select');",
  "  }",
  "",
  "  function saveState(){",
  "    try {",
  "      var state = {};",
  "      getAllInputs().forEach(function(el,i){",
  "        var id = el.id || el.name || ('_idx_'+i);",
  "        if(el.type==='checkbox'||el.type==='radio'){ state[id] = el.checked; }",
  "        else if(el.value) { state[id] = el.value; }",
  "      });",
  "      // Save which steps/sections are visible",
  "      var visible = [];",
  "      document.querySelectorAll('[id]').forEach(function(el){",
  "        if(el.style && el.style.display !== 'none' && el.id &&",
  "           (el.id.indexOf('step')>-1 || el.id.indexOf('Step')>-1)){",
  "          visible.push(el.id);",
  "        }",
  "      });",
  "      state._visibleSteps = visible;",
  "      localStorage.setItem(KEY, JSON.stringify(state));",
  "      localStorage.setItem(TS_KEY, Date.now().toString());",
  "    } catch(e){ /* storage full or blocked */ }",
  "  }",
  "",
  "  function restoreState(){",
  "    try {",
  "      // Check age — don't restore stale state from yesterday",
  "      var ts = parseInt(localStorage.getItem(TS_KEY) || '0', 10);",
  "      if(Date.now() - ts > MAX_AGE){ localStorage.removeItem(KEY); localStorage.removeItem(TS_KEY); return; }",
  "      var raw = localStorage.getItem(KEY);",
  "      if(!raw) return;",
  "      var state = JSON.parse(raw);",
  "      var hasValues = Object.keys(state).some(function(k){ return k !== '_visibleSteps' && state[k]; });",
  "      if(!hasValues) return;",
  "      if(window.console) console.log('[ADDIN] Restoring saved quotation state');",
  "      getAllInputs().forEach(function(el,i){",
  "        var id = el.id || el.name || ('_idx_'+i);",
  "        if(!(id in state)) return;",
  "        if(el.type==='checkbox'||el.type==='radio'){ el.checked = !!state[id]; }",
  "        else { el.value = state[id]; }",
  "        // Fire change event so page JS picks up the value",
  "        try { el.dispatchEvent(new Event('change',{bubbles:true})); } catch(e){}",
  "      });",
  "    } catch(e){ /* parse error or blocked */ }",
  "  }",
  "",
  "  function debouncedSave(){",
  "    clearTimeout(_timer);",
  "    _timer = setTimeout(saveState, DEBOUNCE);",
  "  }",
  "",
  "  // Listen for changes on all current and future inputs",
  "  document.addEventListener('input', debouncedSave, true);",
  "  document.addEventListener('change', debouncedSave, true);",
  "  document.addEventListener('click', debouncedSave, true);",
  "",
  "  // Periodic auto-save: CRM lookups populate fields via JS without firing",
  "  // input/change events, so poll every 3 seconds to catch those values.",
  "  setInterval(saveState, 3000);",
  "",
  "  // Also save immediately when the page is about to unload/hide",
  "  window.addEventListener('beforeunload', saveState);",
  "  document.addEventListener('visibilitychange', function(){",
  "    if(document.visibilityState==='hidden') saveState();",
  "  });",
  "",
  "  // Restore state after page JS has initialised",
  "  function init(){",
  "    setTimeout(restoreState, 300);",
  "    if(window.console) console.log('[ADDIN] State persistence active, key=' + KEY);",
  "",
  "    // Intercept alert() to detect save success and clear state.",
  "    // The page JS calls alert('Quotation saved to SharePoint...') on success.",
  "    var _origAlert = window.alert;",
  "    window.alert = function(msg) {",
  "      _origAlert.apply(window, arguments);",
  "      if (typeof msg === 'string' && msg.indexOf('saved') > -1 && msg.indexOf('successfully') > -1) {",
  "        if(window.console) console.log('[ADDIN] Save success detected — clearing saved state');",
  "        window._clearAddinState();",
  "      }",
  "    };",
  "  }",
  "  if(document.readyState==='loading'){",
  "    document.addEventListener('DOMContentLoaded', init);",
  "  } else { init(); }",
  "",
  "  // Clear saved state after a successful save/email (clean slate)",
  "  window._clearAddinState = function(){ try{ localStorage.removeItem(KEY); localStorage.removeItem(TS_KEY); }catch(e){} };",
  "}());"
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
    SHELL_HTML + "\n" +
    body + "\n" +
    "  <!-- Lifted page logic (single source of truth: Power Pages custom JS) -->\n" +
    "  <script>\n" + js + "\n</script>\n" +
    "  <!-- Add-in shell JS: email modal + prompt override (Outlook WebView2 fix) -->\n" +
    "  <script>\n" + SHELL_JS + "\n</script>\n" +
    "  <!-- Add-in state persistence: survives task-pane reloads -->\n" +
    "  <script>\n" + STATE_JS + "\n</script>\n" +
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
