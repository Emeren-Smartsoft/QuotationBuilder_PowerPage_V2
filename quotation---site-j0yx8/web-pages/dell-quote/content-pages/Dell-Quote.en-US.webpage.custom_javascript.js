/* Dell Quote builder — vanilla ES5 IIFE
 * Parses a Dell quotation email (.eml) entirely in the browser, renders a
 * Smartsoft-branded quotation, and exports it as PDF or Word.
 *
 * Bump BUILD on non-trivial changes so the user can confirm a fresh upload.
 */
(function () {
  "use strict";
  var BUILD = "dq-build-7";
  console.log("[DQ] script loaded build=" + BUILD);

  /* ----------------------------- helpers ----------------------------- */
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function inrNum(s) {
    if (s == null) return 0;
    var t = String(s).replace(/[₹\s]/g, "").replace(/,/g, "");
    var n = parseFloat(t);
    return isFinite(n) ? n : 0;
  }
  function fmtINR(n) {
    n = Number(n) || 0;
    return "\u20B9 " + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function pad(n) { return ("0" + n).slice(-2); }
  function todayISO() { var d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function plusDaysISO(days) {
    var d = new Date(Date.now() + days * 86400000);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  /* ----------------------------- EML parsing ------------------------- */
  // Decode a base64 string into UTF-8 text.
  function b64ToUtf8(b64) {
    var clean = b64.replace(/[^A-Za-z0-9+/=]/g, "");
    var bin = atob(clean);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    try { return new TextDecoder("utf-8").decode(bytes); }
    catch (e) { return bin; }
  }
  // Decode quoted-printable.
  function decodeQP(s) {
    return s.replace(/=\r?\n/g, "").replace(/=([0-9A-Fa-f]{2})/g, function (_, h) {
      return String.fromCharCode(parseInt(h, 16));
    });
  }
  // Given full .eml text, return a map of parts: { 'text/plain': '...', 'text/html': '...' }.
  function parseEml(raw) {
    raw = raw.replace(/\r\n/g, "\n");
    // Split top headers from body
    var hdrEnd = raw.indexOf("\n\n");
    if (hdrEnd === -1) throw new Error("Could not find header/body separator in .eml file.");
    var headers = raw.substring(0, hdrEnd);
    var body = raw.substring(hdrEnd + 2);
    var ctMatch = /content-type:\s*([^\n]+(?:\n[ \t][^\n]+)*)/i.exec(headers);
    var ct = ctMatch ? ctMatch[1].replace(/\n\s+/g, " ") : "";
    var bMatch = /boundary="?([^";\s]+)"?/i.exec(ct);
    var parts = {};
    if (!bMatch) {
      // Single-part email
      var enc = /content-transfer-encoding:\s*([^\n]+)/i.exec(headers);
      parts[primaryType(ct) || "text/plain"] = decodePart(body, enc ? enc[1] : "");
      return parts;
    }
    var boundary = bMatch[1];
    var chunks = body.split("--" + boundary);
    for (var i = 0; i < chunks.length; i++) {
      var c = chunks[i];
      if (!c || c.indexOf("--") === 0) continue; // closer
      var sep = c.indexOf("\n\n");
      if (sep === -1) continue;
      var pHdr = c.substring(0, sep);
      var pBody = c.substring(sep + 2);
      var pCt = /content-type:\s*([^\n]+)/i.exec(pHdr);
      var pEnc = /content-transfer-encoding:\s*([^\n]+)/i.exec(pHdr);
      var type = primaryType(pCt ? pCt[1] : "");
      if (!type) continue;
      parts[type] = decodePart(pBody, pEnc ? pEnc[1] : "");
    }
    return parts;
  }
  function primaryType(ct) {
    if (!ct) return "";
    var m = /([\w.+-]+\/[\w.+-]+)/.exec(ct);
    return m ? m[1].toLowerCase() : "";
  }
  function decodePart(body, enc) {
    enc = (enc || "").trim().toLowerCase();
    if (enc === "base64") return b64ToUtf8(body);
    if (enc === "quoted-printable") return decodeQP(body);
    return body;
  }

  /* ---------------------- Dell quote text parser --------------------- */
  // Take plain-text body and return a structured object.
  function parseDellQuote(text) {
    text = text.replace(/\r\n/g, "\n").replace(/\u00a0/g, " ");
    var lines = text.split("\n").map(function (l) { return l.replace(/\s+$/, ""); });

    function findVal(label) {
      var re = new RegExp("^\\s*" + label.replace(/[.()]/g, "\\$&") + "\\s*[:\\-]?\\s*(.*)$", "i");
      for (var i = 0; i < lines.length; i++) {
        var m = re.exec(lines[i]);
        if (m && m[1] && m[1].trim()) return m[1].trim();
      }
      return "";
    }
    function findValBelow(label) {
      // value on the line after the label
      var re = new RegExp("^\\s*" + label.replace(/[.()]/g, "\\$&") + "\\s*[:\\-]?\\s*$", "i");
      for (var i = 0; i < lines.length - 1; i++) {
        if (re.test(lines[i])) {
          for (var j = i + 1; j < lines.length; j++) {
            if (lines[j].trim()) return lines[j].trim();
          }
        }
      }
      return "";
    }

    var quote = {
      number:    findVal("Quote No.?"),
      quotedOn:  findVal("Quoted On"),
      expiresBy: findVal("Expires By"),
      totalStr:  findVal("Total (INR)"),
      company:   findVal("Company Name"),
      customer:  findVal("Customer Name"),
      custNo:    findVal("Customer Number"),
      dealId:    findVal("Deal ID"),
      endUser:   findVal("End User"),
      salesRep:  findVal("Sales Representative"),
      salesEmail:""
    };
    // Sales rep email (first dell.com address)
    var emRe = /([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
    var em;
    while ((em = emRe.exec(text)) !== null) {
      if (/dell\.com/i.test(em[1])) { quote.salesEmail = em[1]; break; }
    }
    quote.total = inrNum(quote.totalStr);

    // Billing address block
    quote.billingAddress = extractAddress(text, "Billing Address:");

    // ===== Pricing summary items (description + qty + unit + subtotal) =====
    var items = [];
    var pricingBlock = sliceBetween(text, "Pricing Summary", /Tax Summary/i);
    if (pricingBlock) {
      // Items appear as:
      //   <spaces>N.
      //   <description>
      //   <spaces>qty
      //   <spaces>₹unit
      //   <spaces>₹subtotal
      var pl = pricingBlock.split("\n");
      for (var i = 0; i < pl.length; i++) {
        var m = /^\s+(\d+)\.\s*$/.exec(pl[i]);
        if (!m) continue;
        var desc = "", qty = 0, unit = 0, sub = 0;
        var j = i + 1;
        // description: collect non-empty, non-numeric lines until we hit a numeric line
        while (j < pl.length && pl[j].trim() && !/^\s*\d+\s*$/.test(pl[j]) && !/^\s*₹/.test(pl[j])) {
          desc += (desc ? " " : "") + pl[j].trim();
          j++;
        }
        // qty
        while (j < pl.length && !/^\s*\d+\s*$/.test(pl[j])) j++;
        if (j < pl.length) { qty = parseInt(pl[j].trim(), 10) || 0; j++; }
        // unit
        while (j < pl.length && !/^\s*₹/.test(pl[j])) j++;
        if (j < pl.length) { unit = inrNum(pl[j]); j++; }
        // subtotal
        while (j < pl.length && !/^\s*₹/.test(pl[j])) j++;
        if (j < pl.length) { sub = inrNum(pl[j]); j++; }
        if (desc) items.push({ index: parseInt(m[1], 10), description: desc, qty: qty, unit: unit, subtotal: sub, components: [] });
      }
    }

    // ===== Tax summary =====
    var taxBlock = sliceBetween(text, "Tax Summary", /Total \(INR\)/i);
    var tax = { rate: 0, amount: 0, subtotal: 0, total: quote.total, type: "GST" };
    if (taxBlock) {
      var tm = /(IGST|CGST|SGST|GST)\s+(\d+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)/i.exec(taxBlock);
      if (tm) { tax.type = tm[1].toUpperCase(); tax.rate = parseFloat(tm[2]) || 0; tax.amount = inrNum(tm[3]); }
      var sm = /Subtotal:\s*\n\s*₹([\d,]+(?:\.\d+)?)/i.exec(taxBlock);
      if (sm) tax.subtotal = inrNum(sm[1]);
      var am = /Total Tax Amount:\s*\n\s*₹([\d,]+(?:\.\d+)?)/i.exec(taxBlock);
      if (am) tax.amount = inrNum(am[1]);
    }
    if (!tax.subtotal) {
      var ssum = 0;
      for (var k = 0; k < items.length; k++) ssum += items[k].subtotal;
      tax.subtotal = ssum;
    }
    quote.tax = tax;

    // ===== Components: walk the "Product Details" section =====
    // Each top-level product is introduced by a "<n>." line, followed by an
    // image URL line, then a description line, then "(SKU)" line, then qty,
    // unit, subtotal. After "Module / Description / SKU / Qty" header we get
    // group headers (Components / Software / Service) and rows of:
    //   <group>
    //   <description>
    //           <sku>
    //           <qty>
    var prodSection = text.split(/\n\s*Product Details\s*\n/i)[1] || "";
    if (prodSection) {
      // Strip footer noise so we don't keep scanning Terms of Sale.
      var endIdx = prodSection.search(/\n\s*Connect with Dell|\n\s*Terms of Sale|\n\s*Effective \d/i);
      if (endIdx > 0) prodSection = prodSection.substring(0, endIdx);

      var blocks = prodSection.split(/\n(?=\s*\d+\.\s*\n)/);
      var lastItem = null;
      for (var b = 0; b < blocks.length; b++) {
        var blk = blocks[b];
        var idxMatch = /^\s*(\d+)\.\s*\n/.exec(blk);
        if (!idxMatch) continue;
        var idxN = parseInt(idxMatch[1], 10);
        // Match this block to an item from the Pricing Summary, by index first.
        var item = null;
        for (var ii = 0; ii < items.length; ii++) if (items[ii].index === idxN) { item = items[ii]; break; }
        if (!item) {
          // Fallback: create a placeholder item.
          item = { index: idxN, description: "", qty: 0, unit: 0, subtotal: 0, components: [] };
          items.push(item);
        }
        lastItem = item;
        // Extract SKU on the "(XXX-XXXX)" line at the top of the product details.
        var topSku = /\(([\dA-Z]+-[\dA-Z]+)\)/.exec(blk);
        if (topSku) item.sku = topSku[1];
        // Extract a meta block (delivery, HSN)
        var hsn = /HSN\/SAC:\s*(\d+)/i.exec(blk); if (hsn) item.hsn = hsn[1];
        var del = /Estimated delivery if purchased today:\s*([^\n]+)/i.exec(blk); if (del) item.delivery = del[1].trim();
        var place = /Place of Supply:\s*([^\n]+)/i.exec(blk); if (place) item.placeOfSupply = place[1].trim();
        var ship = /Shipping Method:\s*([^\n]+)/i.exec(blk); if (ship) item.shippingMethod = ship[1].trim();

        // Find the Components/Software/Service rows.
        // Look for the "Module/Description/SKU/Qty" header.
        var hdrIdx = blk.search(/\n\s*Module\s*\n\s*Description\s*\n\s*SKU\s*\n\s*Qty/i);
        var rest = hdrIdx >= 0 ? blk.substring(hdrIdx) : blk;
        var rlines = rest.split("\n");
        var currentGroup = "";
        var rl = 0;
        // Skip past the header rows
        for (; rl < rlines.length; rl++) if (/^\s*Qty\s*$/.test(rlines[rl])) { rl++; break; }
        while (rl < rlines.length) {
          // Skip blanks
          while (rl < rlines.length && !rlines[rl].trim()) rl++;
          if (rl >= rlines.length) break;
          var ln = rlines[rl].trim();
          // Section header (Components / Software / Service) — single capitalised word block
          if (/^(Components|Software|Service)$/i.test(ln)) {
            currentGroup = ln;
            rl++;
            continue;
          }
          // module label
          var moduleLabel = ln;
          rl++;
          // description (may span multiple lines until SKU pattern appears)
          var descParts = [];
          while (rl < rlines.length && rlines[rl].trim() && !/^\s+[\dA-Z]+-[\dA-Z]+\s*$/.test(rlines[rl])) {
            descParts.push(rlines[rl].trim());
            rl++;
          }
          if (rl >= rlines.length) break;
          var skuLine = rlines[rl].trim();
          rl++;
          // qty
          while (rl < rlines.length && !rlines[rl].trim()) rl++;
          var qtyLine = (rl < rlines.length) ? rlines[rl].trim() : "1";
          rl++;
          var qtyNum = parseInt(qtyLine, 10);
          if (!descParts.length || !skuLine) continue;
          item.components.push({
            group: currentGroup || "Components",
            module: moduleLabel,
            description: descParts.join(" "),
            sku: skuLine,
            qty: isFinite(qtyNum) ? qtyNum : 1
          });
        }
      }
    }

    quote.items = items;
    return quote;
  }

  function sliceBetween(text, startLabel, endRe) {
    var i = text.search(new RegExp("\\n\\s*" + startLabel + "\\s*\\n", "i"));
    if (i < 0) return "";
    var after = text.substring(i);
    var j = after.search(endRe);
    return j > 0 ? after.substring(0, j) : after;
  }

  function extractAddress(text, label) {
    var re = new RegExp("\\n\\s*" + label + "\\s*\\n([\\s\\S]*?)\\n\\s*(?:Sold To Address:|Shipping Address:|AD Code is|Pricing Summary|Bill & Ship From:)", "i");
    var m = re.exec(text);
    if (!m) return "";
    return m[1].split("\n").map(function (l) { return l.trim(); }).filter(Boolean).join("\n");
  }

  /* ----------------------------- rendering --------------------------- */
  var STATE = { quote: null, overrides: {}, margin: 0, discount: { mode: "pct", value: 0 } };

  function effectiveCustomer() {
    var q = STATE.quote || {};
    var o = STATE.overrides || {};
    return {
      company:   o.company   || q.company || q.endUser || "",
      contact:   o.contact   || q.customer || "",
      email:     o.email     || "",
      phone:     o.phone     || "",
      quoteDate: o.quoteDate || todayISO(),
      validUntil:o.validUntil|| plusDaysISO(15),
      address:   o.address   || q.billingAddress || ""
    };
  }

  function renderDocument() {
    var q = STATE.quote;
    if (!q) return;
    var c = effectiveCustomer();
    var rate = (q.tax && q.tax.rate) ? q.tax.rate : 18;
    var taxType = (q.tax && q.tax.type) || "GST";
    var marginPct = Number(STATE.margin) || 0;
    var marginMult = 1 + (marginPct / 100);

    var items = q.items || [];
    var subtotal = 0;
    for (var s = 0; s < items.length; s++) {
      var dellUnit = items[s].unit || 0;
      var custUnit = dellUnit * marginMult;
      subtotal += custUnit * (items[s].qty || 0);
    }
    // Discount (mode = "pct" or "amt"), capped at subtotal.
    var dMode = (STATE.discount && STATE.discount.mode) || "pct";
    var dVal  = Number(STATE.discount && STATE.discount.value) || 0;
    if (dVal < 0) dVal = 0;
    var discountAmt = dMode === "amt" ? dVal : subtotal * (dVal / 100);
    if (discountAmt > subtotal) discountAmt = subtotal;
    var discountedSubtotal = subtotal - discountAmt;
    var taxAmt = discountedSubtotal * (rate / 100);
    var grand = discountedSubtotal + taxAmt;

    var html = "";

    /* ----- Export-only branded header (centered logo + centered QUOTATION title) ----- */
    html += '<div class="dq-export-head dq-print-only">';
    html += '  <div class="dq-export-brand"><img id="dq-export-logo" src="/smartsoft-logo.png" alt="Smartsoft" /></div>';
    html += '  <h1 class="dq-export-title">QUOTATION</h1>';
    html += '</div>';

    /* ----- Screen-only header block (Bill To + Source Quote) — stripped on download ----- */
    html += '<div class="dq-screen-only">';
    html += '  <div class="dq-doc-head">';
    html += '    <div class="dq-doc-brand">';
    html += '      <img src="/smartsoft-logo.png" alt="Smartsoft" onerror="this.style.display=\'none\'" />';
    html += '      <strong>Smartsoft</strong>';
    html += '      <small>29 years of trusted IT solutions</small>';
    html += '    </div>';
    html += '    <div class="dq-doc-title">';
    html += '      <h1>QUOTATION</h1>';
    html += '      <div><strong>Ref Quote:</strong> ' + esc(q.number || "\u2014") + '</div>';
    html += '      <div><strong>Date:</strong> ' + esc(c.quoteDate) + '</div>';
    html += '      <div><strong>Valid Until:</strong> ' + esc(c.validUntil) + '</div>';
    html += '    </div>';
    html += '  </div>';

    html += '  <div class="dq-meta-grid">';
    html += '    <div class="dq-meta-block">';
    html += '      <h4>Bill To</h4>';
    html += '      <div><strong>' + esc(c.company) + '</strong></div>';
    if (c.contact) html += '      <div><span class="dq-muted">Attn:</span> ' + esc(c.contact) + '</div>';
    if (c.email)   html += '      <div><span class="dq-muted">Email:</span> ' + esc(c.email) + '</div>';
    if (c.phone)   html += '      <div><span class="dq-muted">Phone:</span> ' + esc(c.phone) + '</div>';
    if (c.address) html += '      <div style="white-space:pre-line;margin-top:4px;color:#3a4452">' + esc(c.address) + '</div>';
    html += '    </div>';
    html += '    <div class="dq-meta-block">';
    html += '      <h4>Source Quote</h4>';
    if (q.number)     html += '      <div><span class="dq-muted">Quote No.:</span> ' + esc(q.number) + '</div>';
    if (q.quotedOn)   html += '      <div><span class="dq-muted">Quoted On:</span> ' + esc(q.quotedOn) + '</div>';
    if (q.expiresBy)  html += '      <div><span class="dq-muted">Expires By:</span> ' + esc(q.expiresBy) + '</div>';
    if (q.endUser)    html += '      <div><span class="dq-muted">End User:</span> ' + esc(q.endUser) + '</div>';
    if (q.dealId)     html += '      <div><span class="dq-muted">Deal ID:</span> ' + esc(q.dealId) + '</div>';
    if (q.salesRep)   html += '      <div><span class="dq-muted">Dell Rep:</span> ' + esc(q.salesRep) + (q.salesEmail ? " &lt;" + esc(q.salesEmail) + "&gt;" : "") + '</div>';
    html += '    </div>';
    html += '  </div>';
    html += '</div>'; /* /dq-screen-only header */

    /* ----- Items table (no SKU / Part No column) ----- */
    html += '<table class="dq-items-table">';
    html += '  <thead><tr>';
    html += '    <th style="width:42px;">Sl.</th>';
    html += '    <th>Description</th>';
    html += '    <th style="width:50px;">Qty</th>';
    html += '    <th style="width:140px;">Unit Price (\u20B9)</th>';
    html += '    <th style="width:150px;">Line Total (\u20B9)</th>';
    html += '  </tr></thead><tbody>';
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var dUnit = it.unit || 0;
      var cUnit = dUnit * marginMult;
      var lineTotal = cUnit * (it.qty || 0);
      html += '<tr>';
      html += '  <td>' + (it.index || (i + 1)) + '</td>';
      html += '  <td><strong>' + esc(it.description) + '</strong>';
      // Margin/DTP breakdown — screen only
      if (marginPct > 0) {
        html += '<div class="dq-line-dtp dq-screen-only">Dell DTP: ' + fmtINR(dUnit) + ' &nbsp;+&nbsp; Margin: ' + marginPct + '%</div>';
      }
      html += '  </td>';
      html += '  <td class="num">' + (it.qty || 0) + '</td>';
      html += '  <td class="num">' + fmtINR(cUnit) + '</td>';
      html += '  <td class="num">' + fmtINR(lineTotal) + '</td>';
      html += '</tr>';
    }
    if (!items.length) {
      html += '<tr><td colspan="5" style="text-align:center;color:#777;padding:18px;">No line items were detected in this Dell quote.</td></tr>';
    }
    html += '</tbody>';

    /* ----- Totals as table footer rows (inline with items table) ----- */
    html += '<tfoot>';
    html += '  <tr class="dq-tot"><td colspan="3" class="dq-tot-label">Subtotal</td><td class="num" colspan="2">' + fmtINR(subtotal) + '</td></tr>';
    if (discountAmt > 0) {
      var dLabel = "Discount" + (dMode === "pct" ? " (" + dVal + "%)" : "");
      html += '  <tr class="dq-tot"><td colspan="3" class="dq-tot-label">' + esc(dLabel) + '</td><td class="num" colspan="2">&minus; ' + fmtINR(discountAmt) + '</td></tr>';
      html += '  <tr class="dq-tot"><td colspan="3" class="dq-tot-label">Net Amount</td><td class="num" colspan="2">' + fmtINR(discountedSubtotal) + '</td></tr>';
    }
    html += '  <tr class="dq-tot"><td colspan="3" class="dq-tot-label">GST (' + rate + '%)</td><td class="num" colspan="2">' + fmtINR(taxAmt) + '</td></tr>';
    html += '  <tr class="dq-tot dq-tot-grand"><td colspan="3" class="dq-tot-label">Grand Total (INR)</td><td class="num" colspan="2">' + fmtINR(grand) + '</td></tr>';
    html += '</tfoot>';
    html += '</table>';

    /* ----- Per-item Configuration & Components sections (separate tables so PDF can paginate cleanly) ----- */
    for (var p = 0; p < items.length; p++) {
      var pit = items[p];
      if (!pit.components || !pit.components.length) continue;
      html += '<div class="dq-comp-section">';
      html += '  <h3>Configuration &amp; Included Components &mdash; Item ' + (pit.index || (p + 1)) + ': ' + esc(pit.description) + '</h3>';
      html += '  <table class="dq-comp-table">';
      html += '    <thead><tr>';
      html += '      <th style="width:36px;">#</th>';
      html += '      <th style="width:28%;">Module</th>';
      html += '      <th>Description</th>';
      html += '      <th style="width:60px;">Qty</th>';
      html += '    </tr></thead><tbody>';
      var curGrp = "";
      for (var k = 0; k < pit.components.length; k++) {
        var comp = pit.components[k];
        if (comp.group && comp.group !== curGrp) {
          curGrp = comp.group;
          html += '<tr class="dq-comp-group"><td colspan="4">' + esc(curGrp) + '</td></tr>';
        }
        html += '<tr>';
        html += '<td>' + (k + 1) + '</td>';
        html += '<td>' + esc(comp.module) + '</td>';
        html += '<td>' + esc(comp.description) + '</td>';
        html += '<td class="num">' + comp.qty + '</td>';
        html += '</tr>';
      }
      html += '</tbody></table>';
      html += '</div>';
    }

    /* ----- Footer ----- */
    html += '<div class="dq-foot">';
    html += '  <p><strong>Terms &amp; Conditions:</strong> Prices are valid for 15 days from the date of this quotation. All prices are in INR. GST @' + rate + '% is applicable as shown. Payment terms: 100% advance. Delivery as per product availability and OEM lead times.</p>';
    html += '  <p class="dq-autogen" style="margin-top:6px;font-style:italic;color:#888;">This is an auto-generated quotation.</p>';
    html += '</div>';

    $("dq-document").innerHTML = html;
  }

  /* ------------------------- step navigation ------------------------- */
  function showStep(n) {
    var dots = document.querySelectorAll(".dq-step");
    for (var i = 0; i < dots.length; i++) dots[i].classList.remove("active");
    var active = document.querySelector('.dq-step[data-step="' + n + '"]');
    if (active) active.classList.add("active");
    $("dq-step-upload").classList.toggle("dq-hidden", n !== 1);
    $("dq-step-preview").classList.toggle("dq-hidden", n !== 2);
    window.scrollTo(0, 0);
  }

  /* ------------------------------- I/O ------------------------------- */
  var selectedFile = null;
  function handleFile(file) {
    if (!file) return;
    var nm = (file.name || "").toLowerCase();
    if (nm.lastIndexOf(".eml") !== nm.length - 4) {
      showError("Please choose a .eml file (saved from Outlook).");
      return;
    }
    hideError();
    selectedFile = file;
    $("dq-file-name").textContent = "Selected: " + file.name;
    $("dq-parse-btn").disabled = false;
  }
  function showError(msg) {
    var el = $("dq-parse-error");
    el.textContent = msg;
    el.classList.remove("dq-hidden");
  }
  function hideError() { $("dq-parse-error").classList.add("dq-hidden"); }

  function parseSelected() {
    if (!selectedFile) return;
    hideError();
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var parts = parseEml(String(reader.result || ""));
        var text = parts["text/plain"] || "";
        if (!text && parts["text/html"]) {
          // Fallback: strip tags from HTML part
          var tmp = document.createElement("div");
          tmp.innerHTML = parts["text/html"];
          text = tmp.textContent || tmp.innerText || "";
        }
        if (!text) throw new Error("Could not find a readable text part inside the .eml file.");
        var quote = parseDellQuote(text);
        if (!quote.number && !(quote.items && quote.items.length)) {
          throw new Error("This does not look like a Dell quotation email (no Quote No. or line items found).");
        }
        STATE.quote = quote;
        STATE.overrides = {};
        prefillOverrideForm();
        renderDocument();
        showStep(2);
      } catch (err) {
        console.error("[DQ] parse failed", err);
        showError("Couldn't parse this .eml file: " + (err.message || err));
      }
    };
    reader.onerror = function () { showError("Failed to read the file."); };
    reader.readAsText(selectedFile, "utf-8");
  }

  function prefillOverrideForm() {
    var f = $("dq-customer-form");
    var c = effectiveCustomer();
    if (!f) return;
    f.company.value    = c.company;
    f.contact.value    = c.contact;
    f.email.value      = c.email;
    f.phone.value      = c.phone;
    f.quoteDate.value  = c.quoteDate;
    f.validUntil.value = c.validUntil;
    f.address.value    = c.address;
  }

  function applyOverrides() {
    var f = $("dq-customer-form");
    STATE.overrides = {
      company: f.company.value.trim(),
      contact: f.contact.value.trim(),
      email:   f.email.value.trim(),
      phone:   f.phone.value.trim(),
      quoteDate:  f.quoteDate.value,
      validUntil: f.validUntil.value,
      address: f.address.value.trim()
    };
    renderDocument();
  }

  /* ----------------------------- exporters --------------------------- */
  function fileBaseName() {
    var q = STATE.quote || {};
    var num = (q.number || "quote").replace(/[^\w.-]+/g, "_");
    return "Smartsoft-Quotation-" + num;
  }

  // Clone the document element and strip anything marked screen-only.
  // Also un-hide elements marked print-only so they render in the export.
  function buildExportClone() {
    var clone = $("dq-document").cloneNode(true);
    var rm = clone.querySelectorAll(".dq-screen-only");
    for (var i = 0; i < rm.length; i++) rm[i].parentNode.removeChild(rm[i]);
    var po = clone.querySelectorAll(".dq-print-only");
    for (var j = 0; j < po.length; j++) po[j].classList.remove("dq-print-only");
    return clone;
  }

  // Cache for the inlined logo (used by the Word export — relative URLs
  // don't resolve when a .doc file is opened locally outside the browser).
  var LOGO_DATA_URL = null;
  function ensureLogoDataUrl() {
    return new Promise(function (resolve) {
      if (LOGO_DATA_URL !== null) { resolve(LOGO_DATA_URL); return; }
      var img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = function () {
        try {
          var c = document.createElement("canvas");
          c.width = img.naturalWidth || img.width;
          c.height = img.naturalHeight || img.height;
          c.getContext("2d").drawImage(img, 0, 0);
          LOGO_DATA_URL = c.toDataURL("image/png");
        } catch (e) {
          console.warn("[DQ] could not inline logo", e);
          LOGO_DATA_URL = "";
        }
        resolve(LOGO_DATA_URL);
      };
      img.onerror = function () { LOGO_DATA_URL = ""; resolve(""); };
      img.src = "/smartsoft-logo.png";
    });
  }

  function downloadPdf() {
    if (!window.html2pdf) { alert("PDF library not loaded yet. Please retry in a moment."); return; }
    var clone = buildExportClone();
    // html2pdf needs the element in the DOM to measure layout. Park it off-screen.
    var holder = document.createElement("div");
    holder.style.position = "fixed";
    holder.style.left = "-10000px";
    holder.style.top = "0";
    holder.style.width = "794px";        // ~A4 width at 96dpi
    holder.style.background = "#fff";
    holder.appendChild(clone);
    document.body.appendChild(holder);

    var opt = {
      margin:   [12, 10, 14, 10],
      filename: fileBaseName() + ".pdf",
      image:    { type: "jpeg", quality: 0.95 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff" },
      jsPDF:    { unit: "mm", format: "a4", orientation: "portrait", compress: true },
      pagebreak:{
        mode: ["css", "legacy", "avoid-all"],
        avoid: ["tr", ".dq-comp-section > h3", ".dq-export-head"]
      }
    };
    window.html2pdf().set(opt).from(clone).save()
      .then(function () { document.body.removeChild(holder); })
      .catch(function () { document.body.removeChild(holder); });
  }

  function downloadWord() {
    return (function () {
      var clone = buildExportClone();

      // Word export: drop the logo entirely (relative URLs don't resolve when
      // a .doc is opened locally and inlined images bloat the file).
      var brand = clone.querySelector(".dq-export-brand");
      if (brand) brand.parentNode.removeChild(brand);

      // Strip <thead> from the components tables so Word does NOT repeat the
      // header row on continuation pages. The first row inside the (now thead-less)
      // table still renders as a header because the cells use <th>.
      var compTables = clone.querySelectorAll(".dq-comp-table");
      for (var i = 0; i < compTables.length; i++) {
        var t = compTables[i];
        var thead = t.querySelector("thead");
        if (!thead) continue;
        var tbody = t.querySelector("tbody");
        var headRows = thead.querySelectorAll("tr");
        for (var r = headRows.length - 1; r >= 0; r--) {
          if (tbody) {
            tbody.insertBefore(headRows[r], tbody.firstChild);
          } else {
            t.insertBefore(headRows[r], thead);
          }
        }
        thead.parentNode.removeChild(thead);
      }

      var inner = clone.innerHTML;

      // Inline minimal CSS so Word renders close to the screen view.
      var css = ""
        + "body{font:11pt/1.4 'Segoe UI',Arial,sans-serif;color:#1a2533}"
        + ".dq-document{padding:0}"
        + ".dq-export-head{text-align:center;border-bottom:2.5pt solid #0b5cab;padding:0 0 8pt;margin:0 0 14pt}"
        + ".dq-export-brand{margin:0 0 2pt;text-align:center}"
        + ".dq-export-brand img{height:54px;width:auto;vertical-align:middle}"
        + ".dq-export-title{color:#0b5cab;font-size:24pt;margin:0;letter-spacing:2pt;font-weight:bold;text-align:center;line-height:1}"
        + ".dq-items-table,.dq-comp-table{border-collapse:collapse;width:100%;margin-bottom:8pt}"
        + ".dq-items-table th,.dq-items-table td,.dq-comp-table th,.dq-comp-table td{border:1px solid #b8c4d2;padding:5pt 7pt;vertical-align:top;font-size:9.5pt}"
        + ".dq-items-table thead th{background:#0b5cab;color:#fff;text-align:left}"
        + ".dq-items-table tfoot td,.dq-items-table .dq-tot td{background:#f3f7fc;font-weight:bold}"
        + ".dq-items-table tfoot .dq-tot-label,.dq-items-table .dq-tot .dq-tot-label{text-align:right}"
        + ".dq-items-table .dq-tot-grand td{background:#f3f7fc;font-weight:bold;font-size:11pt;color:#0b5cab}"
        + ".dq-comp-table th{background:#0b5cab;color:#fff;text-align:left;font-size:9pt}"
        + ".dq-comp-table .dq-comp-group td{background:#f3f7fc;color:#0b5cab;font-weight:bold;text-transform:uppercase;font-size:8.5pt}"
        + ".dq-line-meta{color:#555;font-size:9pt;margin-top:2pt}"
        + ".num{text-align:right}"
        + ".dq-comp-section{margin-top:14pt;page-break-before:auto}"
        + ".dq-comp-section h3{color:#0b5cab;font-size:12pt;margin:0 0 6pt;padding:6pt 10pt;background:#eaf2fb;border-left:3pt solid #0b5cab}"
        + ".dq-foot{margin-top:14pt;padding-top:8pt;border-top:1px solid #b8c4d2;font-size:9pt;color:#444}"
        + ".dq-autogen{font-style:italic;color:#888}";

      var html = ""
        + "<html xmlns:o=\"urn:schemas-microsoft-com:office:office\" xmlns:w=\"urn:schemas-microsoft-com:office:word\" xmlns=\"http://www.w3.org/TR/REC-html40\">"
        + "<head><meta charset=\"utf-8\" /><title>Smartsoft Quotation</title>"
        + "<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>90</w:Zoom><w:DoNotOptimizeForBrowser/></w:WordDocument></xml><![endif]-->"
        + "<style>@page WordSection1{size:A4 portrait;margin:1.5cm 1.5cm 1.5cm 1.5cm;} div.WordSection1{page:WordSection1;} " + css + "</style>"
        + "</head><body><div class=\"WordSection1\"><div class=\"dq-document\">" + inner + "</div></div></body></html>";

      var blob = new Blob(["\ufeff", html], { type: "application/msword" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = fileBaseName() + ".doc";
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        URL.revokeObjectURL(a.href);
        a.parentNode.removeChild(a);
      }, 100);
    })();
  }

  /* ------------------------------- wire ------------------------------ */
  function init() {
    var fileInput = $("dq-file");
    var dz = $("dq-drop-zone");
    if (!fileInput || !dz) return;

    fileInput.addEventListener("change", function () {
      if (fileInput.files && fileInput.files[0]) handleFile(fileInput.files[0]);
    });
    ["dragenter", "dragover"].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); e.stopPropagation(); dz.classList.add("is-drag"); });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); e.stopPropagation(); dz.classList.remove("is-drag"); });
    });
    dz.addEventListener("drop", function (e) {
      var dt = e.dataTransfer;
      if (dt && dt.files && dt.files[0]) handleFile(dt.files[0]);
    });

    $("dq-parse-btn").addEventListener("click", parseSelected);
    $("dq-back-btn").addEventListener("click", function () {
      showStep(1);
      $("dq-file").value = "";
      $("dq-file-name").textContent = "";
      $("dq-parse-btn").disabled = true;
      selectedFile = null;
    });
    $("dq-apply-overrides").addEventListener("click", applyOverrides);
    $("dq-download-pdf").addEventListener("click", downloadPdf);
    $("dq-download-word").addEventListener("click", downloadWord);

    var marginInput = $("dq-margin");
    if (marginInput) {
      marginInput.addEventListener("input", function () {

    var discountInput = $("dq-discount");
    var discountMode  = $("dq-discount-mode");
    function applyDiscount() {
      var v = parseFloat(discountInput.value);
      STATE.discount.value = isFinite(v) && v >= 0 ? v : 0;
      STATE.discount.mode  = discountMode.value === "amt" ? "amt" : "pct";
      // Adjust input step/placeholder to the chosen mode for nicer UX.
      if (STATE.discount.mode === "pct") {
        discountInput.step = "0.5";
        discountInput.max = "100";
      } else {
        discountInput.step = "1";
        discountInput.removeAttribute("max");
      }
      if (STATE.quote) renderDocument();
    }
    if (discountInput) discountInput.addEventListener("input",  applyDiscount);
    if (discountMode)  discountMode.addEventListener("change", applyDiscount);
        var v = parseFloat(marginInput.value);
        STATE.margin = isFinite(v) && v >= 0 ? v : 0;
        if (STATE.quote) renderDocument();
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
