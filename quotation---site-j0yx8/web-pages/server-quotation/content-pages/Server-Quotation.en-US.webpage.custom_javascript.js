/* Server Quotation page logic — vanilla ES5-style IIFE */
(function () {
  "use strict";
  var BUILD = "sq-build-6";
  console.log("[SQ] script loaded build=" + BUILD);

  var DATA = null;
  try {
    DATA = JSON.parse(document.getElementById("sq-data").textContent);
  } catch (e) {
    console.error("[SQ] failed to parse data", e);
    return;
  }
  // Build option index by partNo
  var OPTIONS = DATA.options || {};
  var BASES = DATA.bases || [];
  var COMPAT = DATA.compat || {};

  // State
  var customer = {};
  var selectedBasePartNo = null;
  var lineItems = []; // {partNo, description, qty, unit, kind:'base'|'option'}

  // --- Helpers ---
  function $(id) { return document.getElementById(id); }
  function fmt(n) {
    n = Number(n) || 0;
    return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      var v = attrs[k];
      if (v == null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "html") n.innerHTML = v;
      else if (k.indexOf("on") === 0) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    if (children) for (var i = 0; i < children.length; i++) {
      var c = children[i];
      if (c == null) continue;
      n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return n;
  }
  function uniqSorted(arr) {
    var s = {}, out = [];
    for (var i = 0; i < arr.length; i++) if (arr[i] && !s[arr[i]]) { s[arr[i]] = 1; out.push(arr[i]); }
    return out.sort();
  }

  // --- Step navigation ---
  function showStep(n) {
    var steps = document.querySelectorAll(".sq-step");
    for (var i = 0; i < steps.length; i++) steps[i].classList.remove("active");
    var active = document.querySelector('.sq-step[data-step="' + n + '"]');
    if (active) active.classList.add("active");
    $("sq-step-1").classList.toggle("sq-hidden", n !== 1);
    $("sq-step-2").classList.toggle("sq-hidden", n !== 2);
    $("sq-step-3").classList.toggle("sq-hidden", n !== 3);
    window.scrollTo(0, 0);
  }

  // --- Step 1: customer form ---
  function setupCustomerForm() {
    var today = new Date(), pad = function (n) { return ("0" + n).slice(-2); };
    var iso = today.getFullYear() + "-" + pad(today.getMonth() + 1) + "-" + pad(today.getDate());
    var v = new Date(today.getTime() + 30 * 86400000);
    var vIso = v.getFullYear() + "-" + pad(v.getMonth() + 1) + "-" + pad(v.getDate());
    var f = $("sq-customer-form");
    f.quoteDate.value = iso;
    f.validUntil.value = vIso;
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!f.company.value.trim() || !f.contact.value.trim() || !f.email.value.trim()) {
        alert("Please fill required customer details.");
        return;
      }
      customer = {
        company: f.company.value.trim(),
        contact: f.contact.value.trim(),
        email: f.email.value.trim(),
        phone: f.phone.value.trim(),
        quoteDate: f.quoteDate.value,
        validUntil: f.validUntil.value,
        address: f.address.value.trim()
      };
      renderCustomerSummary();
      showStep(2);
    });
  }
  function renderCustomerSummary() {
    var html = ""
      + "<div><b>" + escapeHtml(customer.company) + "</b></div>"
      + "<div>Contact: " + escapeHtml(customer.contact) + "</div>"
      + "<div>Email: " + escapeHtml(customer.email) + (customer.phone ? " &middot; " + escapeHtml(customer.phone) : "") + "</div>"
      + "<div>Date: " + escapeHtml(customer.quoteDate) + " &middot; Valid: " + escapeHtml(customer.validUntil) + "</div>";
    $("sq-customer-summary").innerHTML = html;
    $("sq-customer-summary-2").innerHTML = html;
  }
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // --- Step 2: base picker ---
  function setupBasePicker() {
    var fGen = $("sq-f-gen"), fFf = $("sq-f-ff"), fFam = $("sq-f-family"), fS = $("sq-f-search");
    var ffOpts = uniqSorted(BASES.map(function (b) { return b.formFactor; }));
    for (var i = 0; i < ffOpts.length; i++) fFf.appendChild(el("option", { value: ffOpts[i] }, [ffOpts[i]]));
    var famOpts = uniqSorted(BASES.map(function (b) { return b.family; }));
    for (var j = 0; j < famOpts.length; j++) fFam.appendChild(el("option", { value: famOpts[j] }, [famOpts[j]]));

    [fGen, fFf, fFam, fS].forEach(function (e) { e.addEventListener("input", renderBaseList); });
    $("sq-back-1").addEventListener("click", function () { showStep(1); });
    $("sq-go-3").addEventListener("click", function () {
      if (!selectedBasePartNo) return;
      initQuoteFromBase();
      showStep(3);
    });
    renderBaseList();
  }
  function renderBaseList() {
    var list = $("sq-base-list");
    var gen = $("sq-f-gen").value, ff = $("sq-f-ff").value, fam = $("sq-f-family").value;
    var q = $("sq-f-search").value.trim().toLowerCase();
    list.innerHTML = "";
    var matches = BASES.filter(function (b) {
      if (gen && b.generation !== gen) return false;
      if (ff && b.formFactor !== ff) return false;
      if (fam && b.family !== fam) return false;
      if (q) {
        var hay = (b.partNo + " " + b.family + " " + b.processor + " " + b.memory + " " + b.hdd).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
    if (!matches.length) {
      list.appendChild(el("div", { class: "sq-empty" }, ["No matching base configurations."]));
      return;
    }
    matches.forEach(function (b) {
      var row = el("div", { class: "sq-base-row" + (b.partNo === selectedBasePartNo ? " selected" : "") }, [
        el("div", { class: "sq-bp-id" }, [
          el("div", { class: "sq-bp-fam" }, [b.family + " (" + b.generation + ")"]),
          el("div", null, [b.partNo])
        ]),
        el("div", { class: "sq-bp-spec" }, [
          el("div", null, [b.processor + (b.ghz ? " @ " + b.ghz : "")]),
          el("div", { style: "color:#666;font-size:11.5px" }, [
            [b.formFactor, b.memory, b.hdd, b.warranty].filter(Boolean).join(" \u2022 ")
          ])
        ]),
        el("div", { class: "sq-bp-price" }, ["INR " + fmt(b.eeup)])
      ]);
      row.addEventListener("click", function () {
        selectedBasePartNo = b.partNo;
        $("sq-go-3").disabled = false;
        renderBaseList();
      });
      list.appendChild(row);
    });
  }

  // --- Step 3 ---
  function initQuoteFromBase() {
    var base = findBase(selectedBasePartNo);
    if (!base) return;
    lineItems = [{
      partNo: base.partNo,
      description: base.family + " — " + base.processor + " | " + base.memory + " | " + base.hdd + " | " + base.warranty,
      qty: 1,
      unit: base.eeup,
      kind: "base"
    }];
    renderBaseDetail(base);
    setupOptionsToolbar();
    renderOptionsList();
    renderQuoteTable();
  }
  function findBase(pn) {
    for (var i = 0; i < BASES.length; i++) if (BASES[i].partNo === pn) return BASES[i];
    return null;
  }
  function renderBaseDetail(b) {
    var dl = ""
      + "<dt>Part No</dt><dd>" + escapeHtml(b.partNo) + "</dd>"
      + "<dt>Family</dt><dd>" + escapeHtml(b.family) + " (" + escapeHtml(b.generation) + ")</dd>"
      + "<dt>Form Factor</dt><dd>" + escapeHtml(b.formFactor) + (b.socket ? " &middot; " + escapeHtml(b.socket) : "") + "</dd>"
      + "<dt>Processor</dt><dd>" + escapeHtml(b.processor) + (b.ghz ? " @ " + escapeHtml(b.ghz) : "") + (b.cache ? " &middot; " + escapeHtml(b.cache) : "") + "</dd>"
      + "<dt>Memory</dt><dd>" + escapeHtml(b.memory) + "</dd>"
      + "<dt>Storage</dt><dd>" + escapeHtml(b.hdd) + (b.backplane ? " &middot; " + escapeHtml(b.backplane) : "") + "</dd>"
      + "<dt>RAID</dt><dd>" + escapeHtml(b.raid) + "</dd>"
      + "<dt>Management</dt><dd>" + escapeHtml(b.mgmt) + "</dd>"
      + "<dt>Other</dt><dd>" + escapeHtml(b.others) + "</dd>"
      + "<dt>Warranty</dt><dd>" + escapeHtml(b.warranty) + "</dd>"
      + "<dt>Base Price (EEUP)</dt><dd><b>INR " + fmt(b.eeup) + "</b></dd>";
    $("sq-base-detail").innerHTML = "<h3>Base Configuration</h3><dl>" + dl + "</dl>";
  }

  function hasCompatMatrix() {
    var pns = COMPAT[selectedBasePartNo];
    return !!(pns && pns.length);
  }
  function getCompatibleOptionList() {
    var showAll = $("sq-opt-all").checked;
    if (showAll) {
      var arr = [];
      for (var pn in OPTIONS) arr.push(OPTIONS[pn]);
      return arr;
    }
    var pns = COMPAT[selectedBasePartNo] || [];
    var out = [];
    for (var i = 0; i < pns.length; i++) if (OPTIONS[pns[i]]) out.push(OPTIONS[pns[i]]);
    return out;
  }

  function setupOptionsToolbar() {
    var typeSel = $("sq-opt-type");
    typeSel.innerHTML = '<option value="">All types</option>';
    var compatOpts = getCompatibleOptionList();
    var types = uniqSorted(compatOpts.map(function (o) { return o.type; }));
    types.forEach(function (t) { typeSel.appendChild(el("option", { value: t }, [t])); });

    typeSel.onchange = renderOptionsList;
    $("sq-opt-search").oninput = renderOptionsList;
    $("sq-opt-all").onchange = function () {
      setupOptionsToolbar(); // refresh types
      renderOptionsList();
    };
    $("sq-back-2").onclick = function () { showStep(2); };
    $("sq-print").onclick = function () { window.print(); };
  }

  function renderOptionsList() {
    var list = $("sq-options-list");
    list.innerHTML = "";
    var type = $("sq-opt-type").value;
    var q = $("sq-opt-search").value.trim().toLowerCase();
    var opts = getCompatibleOptionList();
    if (!hasCompatMatrix() && !$("sq-opt-all").checked) {
      list.appendChild(el("div", { style: "padding:10px 12px;background:#fff8e1;border-bottom:1px solid #f0e0a8;color:#7a5d00;font-size:12.5px;" }, [
        "\u26A0 No compatibility matrix exists for this base in the price list \u2014 showing the full options catalog. Verify compatibility before quoting."
      ]));
      return;
    }
    if (!opts.length) {
      list.appendChild(el("div", { class: "sq-empty" }, [
        "No compatibility matrix entry for this base. Tick 'Show all options' to add line items manually."
      ]));
      return;
    }
    opts = opts.filter(function (o) {
      if (type && o.type !== type) return false;
      if (q) {
        var hay = (o.partNo + " " + o.description + " " + o.type).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
    opts.sort(function (a, b) {
      if (a.type !== b.type) return a.type < b.type ? -1 : 1;
      return a.description < b.description ? -1 : a.description > b.description ? 1 : 0;
    });
    if (!opts.length) {
      list.appendChild(el("div", { class: "sq-empty" }, ["No options match the current filter."]));
      return;
    }
    // cap render to avoid huge DOM
    var capped = opts.slice(0, 400);
    capped.forEach(function (o) {
      var inQuote = lineItems.some(function (li) { return li.partNo === o.partNo; });
      var row = el("div", { class: "sq-opt-row" }, [
        el("div", null, [el("input", { type: "checkbox", "data-pn": o.partNo, checked: inQuote ? "checked" : null })]),
        el("div", { class: "sq-opt-type" }, [o.type || ""]),
        el("div", null, [
          el("div", null, [o.description]),
          el("div", { class: "sq-opt-pn" }, [o.partNo])
        ]),
        el("div", null, [o.type || ""]),
        el("div", { class: "sq-opt-price" }, ["INR " + fmt(o.eeup)])
      ]);
      // simpler — hide duplicated type col by removing; keep layout
      row.children[3].style.display = "none";
      row.querySelector('input[type=checkbox]').addEventListener("change", function (ev) {
        if (ev.target.checked) {
          if (!lineItems.some(function (li) { return li.partNo === o.partNo; })) {
            lineItems.push({ partNo: o.partNo, description: o.description, qty: 1, unit: o.eeup, kind: "option" });
          }
        } else {
          lineItems = lineItems.filter(function (li) { return !(li.partNo === o.partNo && li.kind === "option"); });
        }
        renderQuoteTable();
      });
      list.appendChild(row);
    });
    if (opts.length > capped.length) {
      list.appendChild(el("div", { class: "sq-empty" }, ["Showing first " + capped.length + " of " + opts.length + " — narrow the search to see more."]));
    }
  }

  function renderQuoteTable() {
    var body = $("sq-quote-body");
    body.innerHTML = "";
    var sub = 0;
    lineItems.forEach(function (li, idx) {
      var lineTotal = (Number(li.qty) || 0) * (Number(li.unit) || 0);
      sub += lineTotal;
      var removeBtn = li.kind === "base"
        ? el("span", { style: "color:#888;font-size:11px" }, ["base"])
        : el("button", { type: "button", class: "sq-btn sq-btn-danger", onclick: function () {
            lineItems.splice(idx, 1); renderQuoteTable(); renderOptionsList();
          } }, ["Remove"]);
      var qtyInput = el("input", { type: "number", min: "1", value: String(li.qty), class: "sq-qty" });
      qtyInput.addEventListener("input", function () {
        li.qty = Math.max(1, parseInt(qtyInput.value, 10) || 1);
        renderQuoteTable();
      });
      var tr = el("tr", null, [
        el("td", { class: "sq-no-print" }, [removeBtn]),
        el("td", null, [li.partNo]),
        el("td", null, [li.description]),
        el("td", null, [qtyInput]),
        el("td", { class: "num" }, [fmt(li.unit)]),
        el("td", { class: "num" }, [fmt(lineTotal)])
      ]);
      body.appendChild(tr);
    });
    var gst = sub * 0.18;
    $("sq-subtotal").textContent = fmt(sub);
    $("sq-gst").textContent = fmt(gst);
    $("sq-grand").textContent = fmt(sub + gst);
  }

  // --- bootstrap ---
  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }
  ready(function () {
    if (!$("sq-customer-form")) {
      console.warn("[SQ] page markup not found");
      return;
    }
    setupCustomerForm();
    setupBasePicker();
    setupDellMode();
  });

  // ===========================
  // DELL QUOTE MODE
  // ===========================
  var PROPOSAL_URL = "https://9812337a468ced9ca7578b2d70425b.8d.environment.api.powerplatform.com:443/powerautomate/automations/direct/workflows/54c9adc1566b4c6c94106f936ea366a8/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=lZW2LDYMbBrCf4MJ13Kaedg3kXXznejJsZC3e1FfH3g";

  var dellMode = false;
  var dellParsed = null; // { header: {...}, lines: [...] }

  function setupDellMode() {
    var tabLenovo = $("sq-mode-lenovo");
    var tabDell = $("sq-mode-dell");
    if (!tabLenovo || !tabDell) return;

    tabLenovo.addEventListener("click", function () {
      dellMode = false;
      tabLenovo.classList.add("active");
      tabDell.classList.remove("active");
      $("sq-steps-lenovo").classList.remove("sq-hidden");
      $("sq-dell-upload").classList.add("sq-hidden");
      $("sq-dell-result").classList.add("sq-hidden");
      showStep(1);
    });

    tabDell.addEventListener("click", function () {
      dellMode = true;
      tabDell.classList.add("active");
      tabLenovo.classList.remove("active");
      $("sq-steps-lenovo").classList.add("sq-hidden");
      $("sq-step-1").classList.add("sq-hidden");
      $("sq-step-2").classList.add("sq-hidden");
      $("sq-step-3").classList.add("sq-hidden");
      $("sq-dell-upload").classList.remove("sq-hidden");
      $("sq-dell-result").classList.add("sq-hidden");
    });

    // File upload
    var fileInput = $("sq-dell-file");
    var dropArea = $("sq-dell-drop");
    var textArea = $("sq-dell-text");

    fileInput.addEventListener("change", function () {
      if (fileInput.files.length) readDellFile(fileInput.files[0]);
    });

    dropArea.addEventListener("dragover", function (e) { e.preventDefault(); dropArea.classList.add("sq-drag-over"); });
    dropArea.addEventListener("dragleave", function () { dropArea.classList.remove("sq-drag-over"); });
    dropArea.addEventListener("drop", function (e) {
      e.preventDefault();
      dropArea.classList.remove("sq-drag-over");
      if (e.dataTransfer.files.length) readDellFile(e.dataTransfer.files[0]);
    });

    // Parse button
    $("sq-dell-parse").addEventListener("click", function () {
      var text = textArea.value.trim();
      if (!text) {
        showDellError("Please paste the Dell quote text or upload an .eml file.");
        return;
      }
      parseDellQuote(text);
    });

    // Back button
    $("sq-dell-back").addEventListener("click", function () {
      $("sq-dell-result").classList.add("sq-hidden");
      $("sq-dell-upload").classList.remove("sq-hidden");
    });

    // Print
    $("sq-dell-print").addEventListener("click", function () { window.print(); });

    // Merge with Proposal
    $("sq-dell-merge").addEventListener("click", function () { mergeWithProposal("dell"); });

    // Also hook the Lenovo merge button
    var lenovoMerge = $("sq-merge-proposal");
    if (lenovoMerge) {
      lenovoMerge.addEventListener("click", function () { mergeWithProposal("lenovo"); });
    }
  }

  function readDellFile(file) {
    var reader = new FileReader();
    reader.onload = function (e) {
      var raw = e.target.result;
      var text = "";
      if (file.name.toLowerCase().indexOf(".eml") !== -1) {
        text = extractTextFromEml(raw);
      } else {
        text = raw;
      }
      $("sq-dell-text").value = text;
    };
    reader.readAsText(file);
  }

  function extractTextFromEml(raw) {
    // Find the text/plain MIME part (base64 encoded)
    var lines = raw.split(/\r?\n/);
    var inTextPart = false;
    var isBase64 = false;
    var b64lines = [];
    var blankSeen = false;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (line.indexOf("Content-Type: text/plain") !== -1) {
        inTextPart = true;
        isBase64 = false;
        blankSeen = false;
        b64lines = [];
        continue;
      }
      if (inTextPart && !blankSeen) {
        if (line.indexOf("Content-Transfer-Encoding: base64") !== -1) {
          isBase64 = true;
          continue;
        }
        if (line.trim() === "") {
          blankSeen = true;
          continue;
        }
        continue;
      }
      if (inTextPart && blankSeen) {
        if (line.indexOf("--") === 0 && line.indexOf("_") !== -1) {
          // boundary reached
          break;
        }
        b64lines.push(line.trim());
      }
    }

    if (isBase64 && b64lines.length) {
      try {
        return atob(b64lines.join(""));
      } catch (e) {
        console.warn("[SQ] base64 decode failed, returning raw");
      }
    }
    // Fallback: return everything after the first blank line
    var idx = raw.indexOf("\r\n\r\n");
    return idx > 0 ? raw.substring(idx + 4) : raw;
  }

  function parseDellQuote(text) {
    hideDellError();
    var header = {};
    var lines = [];

    // Extract quote number
    var m = text.match(/Quote No\.?:\s*(\S+)/i);
    header.quoteNo = m ? m[1] : "";

    // Total
    m = text.match(/Total \(INR\):\s*₹?([\d,]+\.?\d*)/i);
    header.total = m ? parseINR(m[1]) : 0;

    // Dates
    m = text.match(/Quoted On:\s*(.+)/i);
    header.quotedOn = m ? m[1].trim() : "";
    m = text.match(/Expires By:\s*(.+)/i);
    header.expiresBy = m ? m[1].trim() : "";

    // Customer (End User field)
    m = text.match(/End User:\s*(.+)/i);
    var endUser = m ? m[1].trim() : "";
    // Remove trailing PAN/ID markers like "| *****5884"
    endUser = endUser.replace(/\s*\|\s*\*+\d*\s*$/, "").trim();
    header.customer = endUser;

    // Company / distributor
    m = text.match(/Company Name:\s*(.+)/i);
    header.companyName = m ? m[1].trim() : "";

    // Customer Name (contact person)
    m = text.match(/Customer Name:\s*(.+)/i);
    header.contactName = m ? m[1].trim() : "";

    // Sales rep
    m = text.match(/Sales Representative:\s*(.+)/i);
    header.salesRep = m ? m[1].trim() : "";

    // Sales rep email
    m = text.match(/Sales Representative:.*?\nEmail:\s*(\S+)/i);
    if (!m) m = text.match(/Email:\s*(\S+@\S+)/i);
    header.salesEmail = m ? m[1].replace(/<.*/, "").trim() : "";

    // Billing address
    m = text.match(/Billing Address:\s*\n([\s\S]*?)(?=Sold To|Shipping|$)/i);
    header.billingAddress = m ? m[1].trim().split("\n").map(function (l) { return l.trim(); }).filter(Boolean).join(", ") : "";

    // Shipping address
    m = text.match(/Shipping Address:\s*\n([\s\S]*?)(?=GSTIN|AD Code|Bill & Ship|$)/i);
    header.shippingAddress = m ? m[1].trim().split("\n").map(function (l) { return l.trim(); }).filter(Boolean).join(", ") : "";

    // GSTIN
    m = text.match(/GSTIN:\s*(\S+)/i);
    header.gstin = m ? m[1] : "";

    // Parse line items - two formats:
    // Format 1 (Pricing Summary): "1.\nDescription\nQty\n₹UnitPrice\n₹Subtotal"
    // Format 2 (Product Details with component breakdown)

    // Try Format 2 first (detailed with SKU modules)
    var hasProductDetails = text.indexOf("Product Details") !== -1;
    if (hasProductDetails) {
      lines = parseDellProductDetails(text);
    }

    // If no detailed lines found, use Pricing Summary
    if (!lines.length) {
      lines = parseDellPricingSummary(text);
    }

    if (!lines.length) {
      showDellError("Could not parse any line items from the quote. Please check the format.");
      return;
    }

    header.lineCount = lines.length;
    dellParsed = { header: header, lines: lines };
    renderDellQuotation();
  }

  function parseDellPricingSummary(text) {
    var lines = [];
    // Match pattern: "N.\nDescription\nQty\n₹Price\n₹Subtotal"
    var section = text.substring(text.indexOf("Pricing Summary"));
    if (!section) return lines;

    var re = /(\d+)\.\s*\n\s*(.+?)\s*\n\s*(\d+)\s*\n\s*₹?([\d,]+\.?\d*)\s*\n\s*₹?([\d,]+\.?\d*)/g;
    var m;
    while ((m = re.exec(section)) !== null) {
      lines.push({
        lineNo: parseInt(m[1], 10),
        sku: "",
        description: m[2].trim(),
        qty: parseInt(m[3], 10) || 1,
        unitPrice: parseINR(m[4]),
        subtotal: parseINR(m[5])
      });
    }
    return lines;
  }

  function parseDellProductDetails(text) {
    var lines = [];
    var section = text.substring(text.indexOf("Product Details"));
    if (!section) return lines;

    // Each product starts with "N.\n<image url or empty>\nProductName\n(SKU)"
    // followed by module breakdowns: "Module\nDescription\nSKU\nQty"
    var productBlocks = section.split(/\n\d+\.\s*\n/);
    productBlocks.shift(); // remove header

    for (var i = 0; i < productBlocks.length; i++) {
      var block = productBlocks[i];
      var blockLines = block.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);

      // First few lines: optional image URL, product name, (SKU), qty, unit price, subtotal
      var productName = "";
      var productSku = "";
      var productQty = 1;
      var productUnitPrice = 0;

      for (var j = 0; j < blockLines.length && j < 10; j++) {
        var bl = blockLines[j];
        // skip image urls
        if (bl.indexOf("http") === 0 || bl.indexOf("<http") === 0) continue;
        // SKU in parentheses
        var skuMatch = bl.match(/^\((\d{3}-\w+)\)$/);
        if (skuMatch) { productSku = skuMatch[1]; continue; }
        // price lines
        if (bl.match(/^₹/)) continue;
        // qty (standalone number)
        if (bl.match(/^\d+$/) && !productName) { continue; }
        // product name is first non-url, non-sku text
        if (!productName && !bl.match(/^\d+$/) && bl.length > 3) {
          productName = bl;
          continue;
        }
      }

      // Find qty and unit price from the pricing section at top of block
      var priceMatch = block.match(/(\d+)\s*\n\s*₹?([\d,]+\.?\d*)\s*\n\s*₹?([\d,]+\.?\d*)/);
      if (priceMatch) {
        productQty = parseInt(priceMatch[1], 10) || 1;
        productUnitPrice = parseINR(priceMatch[2]);
      }

      // Extract component modules
      var modules = [];
      var moduleRe = /\n([A-Z][A-Za-z /&()+\-\.]+)\n(.+?)\n\s+(\d{3}-\w+)\s*\n\s+(\d+)/g;
      var mm;
      while ((mm = moduleRe.exec(block)) !== null) {
        modules.push({
          module: mm[1].trim(),
          description: mm[2].trim(),
          sku: mm[3].trim(),
          qty: parseInt(mm[4], 10) || 1
        });
      }

      if (productName) {
        lines.push({
          lineNo: i + 1,
          sku: productSku,
          description: productName,
          qty: productQty,
          unitPrice: productUnitPrice,
          subtotal: productUnitPrice * productQty,
          modules: modules
        });
      }
    }
    return lines;
  }

  function parseINR(s) {
    if (!s) return 0;
    return parseFloat(String(s).replace(/,/g, "")) || 0;
  }

  function showDellError(msg) {
    var el = $("sq-dell-error");
    el.textContent = msg;
    el.classList.remove("sq-hidden");
  }
  function hideDellError() {
    $("sq-dell-error").classList.add("sq-hidden");
  }

  function renderDellQuotation() {
    $("sq-dell-upload").classList.add("sq-hidden");
    $("sq-dell-result").classList.remove("sq-hidden");

    var h = dellParsed.header;
    var items = dellParsed.lines;

    // Customer summary
    var cs = $("sq-dell-customer-summary");
    cs.innerHTML = ""
      + "<div><b>" + escapeHtml(h.customer || h.companyName) + "</b></div>"
      + "<div>Contact: " + escapeHtml(h.contactName) + "</div>"
      + (h.salesRep ? "<div>Dell Sales Rep: " + escapeHtml(h.salesRep) + "</div>" : "")
      + "<div>Quote #" + escapeHtml(h.quoteNo) + " &middot; " + escapeHtml(h.quotedOn) + " &mdash; " + escapeHtml(h.expiresBy) + "</div>";

    // Quote meta
    var meta = $("sq-dell-quote-meta");
    meta.innerHTML = ""
      + '<div class="sq-dell-meta-grid">'
      + '<div><span class="sq-dm-label">Quote No</span><span class="sq-dm-value">' + escapeHtml(h.quoteNo) + '</span></div>'
      + '<div><span class="sq-dm-label">Customer (End User)</span><span class="sq-dm-value">' + escapeHtml(h.customer) + '</span></div>'
      + '<div><span class="sq-dm-label">Quoted On</span><span class="sq-dm-value">' + escapeHtml(h.quotedOn) + '</span></div>'
      + '<div><span class="sq-dm-label">Valid Until</span><span class="sq-dm-value">' + escapeHtml(h.expiresBy) + '</span></div>'
      + (h.gstin ? '<div><span class="sq-dm-label">GSTIN</span><span class="sq-dm-value">' + escapeHtml(h.gstin) + '</span></div>' : '')
      + (h.billingAddress ? '<div class="sq-dm-wide"><span class="sq-dm-label">Billing Address</span><span class="sq-dm-value">' + escapeHtml(h.billingAddress) + '</span></div>' : '')
      + '</div>';

    // Line items table
    var body = $("sq-dell-quote-body");
    body.innerHTML = "";
    var subtotal = 0;
    for (var i = 0; i < items.length; i++) {
      var li = items[i];
      var lineTotal = li.subtotal || (li.qty * li.unitPrice);
      subtotal += lineTotal;

      // Main product row
      var desc = escapeHtml(li.description);
      // If modules exist, add expandable details
      if (li.modules && li.modules.length) {
        desc += ' <button type="button" class="sq-btn-toggle sq-no-print" data-target="sq-mod-' + i + '">Details ▾</button>';
        desc += '<div id="sq-mod-' + i + '" class="sq-module-details sq-hidden">';
        desc += '<table class="sq-module-table"><thead><tr><th>Module</th><th>Description</th><th>SKU</th><th>Qty</th></tr></thead><tbody>';
        for (var j = 0; j < li.modules.length; j++) {
          var mod = li.modules[j];
          desc += '<tr><td>' + escapeHtml(mod.module) + '</td><td>' + escapeHtml(mod.description) + '</td><td>' + escapeHtml(mod.sku) + '</td><td>' + mod.qty + '</td></tr>';
        }
        desc += '</tbody></table></div>';
      }

      var tr = document.createElement("tr");
      tr.innerHTML = ""
        + '<td>' + (i + 1) + '</td>'
        + '<td style="font-family:Consolas,monospace;font-size:11.5px">' + escapeHtml(li.sku) + '</td>'
        + '<td>' + desc + '</td>'
        + '<td>' + li.qty + '</td>'
        + '<td class="num">' + fmt(li.unitPrice) + '</td>'
        + '<td class="num">' + fmt(lineTotal) + '</td>';
      body.appendChild(tr);
    }

    var gst = subtotal * 0.18;
    $("sq-dell-subtotal").textContent = fmt(subtotal);
    $("sq-dell-gst").textContent = fmt(gst);
    $("sq-dell-grand").innerHTML = "<strong>" + fmt(subtotal + gst) + "</strong>";

    // Bind toggle buttons
    var toggles = document.querySelectorAll(".sq-btn-toggle");
    for (var t = 0; t < toggles.length; t++) {
      (function (btn) {
        btn.addEventListener("click", function () {
          var target = document.getElementById(btn.getAttribute("data-target"));
          if (target) target.classList.toggle("sq-hidden");
          btn.textContent = target && !target.classList.contains("sq-hidden") ? "Details ▴" : "Details ▾";
        });
      })(toggles[t]);
    }

    window.scrollTo(0, 0);
  }

  // ===========================
  // MERGE WITH PROPOSAL
  // ===========================
  function mergeWithProposal(source) {
    var btn = source === "dell" ? $("sq-dell-merge") : $("sq-merge-proposal");
    if (btn) { btn.disabled = true; btn.textContent = "Loading proposal..."; }

    fetchProposalTemplate("Server").then(function (html) {
      if (!html) {
        alert("Could not load the Server proposal template from SharePoint. Please check the flow URL.");
        if (btn) { btn.disabled = false; btn.textContent = "Merge with Proposal"; }
        return;
      }

      // Fill placeholders in the proposal template
      var ctx = {};
      if (source === "dell" && dellParsed) {
        ctx.company = dellParsed.header.customer || dellParsed.header.companyName;
        ctx.contact = dellParsed.header.contactName;
        ctx.address = dellParsed.header.billingAddress;
        ctx.email = dellParsed.header.salesEmail;
        ctx.phone = "";
        ctx.date = dellParsed.header.quotedOn;
        ctx.quoteId = dellParsed.header.quoteNo;
        ctx.validUntil = dellParsed.header.expiresBy;
      } else {
        ctx.company = customer.company;
        ctx.contact = customer.contact;
        ctx.address = customer.address;
        ctx.email = customer.email;
        ctx.phone = customer.phone;
        ctx.date = customer.quoteDate;
        ctx.quoteId = "";
        ctx.validUntil = customer.validUntil;
      }

      var filledHtml = fillProposalPlaceholders(html, ctx);

      // Get the quotation HTML
      var quotationEl = source === "dell" ? $("sq-dell-result") : $("sq-step-3");
      var quotationHtml = quotationEl ? quotationEl.outerHTML : "";

      // Open merged document in a new window for printing/PDF
      openMergedDocument(filledHtml, quotationHtml);

      if (btn) { btn.disabled = false; btn.textContent = "Merge with Proposal"; }
    });
  }

  function fetchProposalTemplate(name) {
    return new Promise(function (resolve) {
      if (!PROPOSAL_URL || PROPOSAL_URL.indexOf("PASTE_") === 0) {
        resolve("");
        return;
      }
      fetch(PROPOSAL_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateName: name })
      })
        .then(function (r) { return r.json(); })
        .then(function (data) { resolve(data.html || ""); })
        .catch(function (err) {
          console.error("[SQ] Failed to fetch proposal template", err);
          resolve("");
        });
    });
  }

  function fillProposalPlaceholders(html, ctx) {
    if (!html) return "";
    return html
      .replace(/\{\{COMPANY\}\}/g, escapeHtml(ctx.company || ""))
      .replace(/\{\{CONTACT\}\}/g, escapeHtml(ctx.contact || ""))
      .replace(/\{\{ADDRESS\}\}/g, escapeHtml(ctx.address || ""))
      .replace(/\{\{EMAIL\}\}/g, escapeHtml(ctx.email || ""))
      .replace(/\{\{PHONE\}\}/g, escapeHtml(ctx.phone || ""))
      .replace(/\{\{DATE\}\}/g, escapeHtml(ctx.date || ""))
      .replace(/\{\{QUOTE_ID\}\}/g, escapeHtml(ctx.quoteId || ""))
      .replace(/\{\{VALID_UNTIL\}\}/g, escapeHtml(ctx.validUntil || ""));
  }

  function openMergedDocument(proposalHtml, quotationHtml) {
    var win = window.open("", "_blank");
    if (!win) { alert("Please allow popups to view the merged document."); return; }

    // Clean up the quotation HTML: remove no-print elements
    var temp = document.createElement("div");
    temp.innerHTML = quotationHtml;
    var noPrints = temp.querySelectorAll(".sq-no-print");
    for (var i = 0; i < noPrints.length; i++) noPrints[i].parentNode.removeChild(noPrints[i]);
    // Remove hidden sections
    var hiddens = temp.querySelectorAll(".sq-hidden");
    for (var j = 0; j < hiddens.length; j++) hiddens[j].parentNode.removeChild(hiddens[j]);
    var cleanQuotation = temp.innerHTML;

    var doc = win.document;
    doc.open();
    doc.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Server Quotation &amp; Proposal</title>');
    doc.write('<style>');
    doc.write('body{margin:0;font-family:"Inter",-apple-system,sans-serif;font-size:14px;color:#1a2740;line-height:1.55}');
    doc.write('.proposal-section{max-width:1000px;margin:0 auto}');
    doc.write('.quotation-section{max-width:1000px;margin:0 auto;padding:40px 56px}');
    doc.write('.quotation-section h2{font-size:1.5rem;font-weight:800;margin:0 0 16px;color:#0a1f3f}');
    doc.write('.page-break{break-before:page;page-break-before:always}');
    doc.write('.sq-table{width:100%;border-collapse:collapse;font-size:12.5px}');
    doc.write('.sq-table th,.sq-table td{border:1px solid #d6dee6;padding:7px 9px;vertical-align:top}');
    doc.write('.sq-table thead th{background:#0b5cab;color:#fff;text-align:left;font-weight:600}');
    doc.write('.sq-table td.num{text-align:right;font-variant-numeric:tabular-nums}');
    doc.write('.sq-table tfoot td{font-weight:700;background:#f3f7fc}');
    doc.write('.sq-customer-summary{background:#f7f9fb;border:1px solid #e0e4e8;border-radius:6px;padding:10px 12px;margin-bottom:14px;font-size:12.5px}');
    doc.write('.sq-dell-meta-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px 16px;margin:10px 0}');
    doc.write('.sq-dm-label{display:block;font-size:11px;color:#666;text-transform:uppercase;letter-spacing:.5px;font-weight:700}');
    doc.write('.sq-dm-value{display:block;font-size:13px;color:#1a2533;font-weight:600}');
    doc.write('.sq-module-table{width:100%;border-collapse:collapse;margin:6px 0;font-size:11.5px}');
    doc.write('.sq-module-table th,.sq-module-table td{border:1px solid #e0e4e8;padding:4px 7px;text-align:left}');
    doc.write('.sq-module-table th{background:#f3f7fc;font-weight:600}');
    doc.write('.sq-module-details{margin-top:8px}');
    doc.write('@media print{.sq-no-print{display:none !important}.page-break{break-before:page}}');
    doc.write('</style></head><body>');

    // Proposal first
    if (proposalHtml) {
      doc.write('<div class="proposal-section">' + proposalHtml + '</div>');
      doc.write('<div class="page-break"></div>');
    }

    // Quotation
    doc.write('<div class="quotation-section">' + cleanQuotation + '</div>');

    doc.write('<script>');
    doc.write('setTimeout(function(){window.print();},800);');
    doc.write('<\/script>');
    doc.write('</body></html>');
    doc.close();
  }

})();
