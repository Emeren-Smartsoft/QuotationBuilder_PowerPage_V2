/* Dell Quote builder — vanilla ES5 IIFE
 * Parses a Dell quotation email (.eml) entirely in the browser, renders a
 * Smartsoft-branded quotation, and exports it as PDF or Word.
 *
 * Bump BUILD on non-trivial changes so the user can confirm a fresh upload.
 */
(function () {
  "use strict";
  var BUILD = "dq-build-84";
  console.log("[DQ] script loaded build=" + BUILD);

  /* ----- Config (Power Automate flow URLs) ----- */
  var CONFIG = { flowUrls: {} };
  try {
    var pd = document.getElementById("productData");
    if (pd && pd.textContent) {
      var parsed = JSON.parse(pd.textContent);
      if (parsed && typeof parsed === "object") {
        CONFIG = parsed;
        CONFIG.flowUrls = CONFIG.flowUrls || {};
      }
    }
  } catch (e) { console.warn("[DQ] productData parse failed", e); }

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
  var STATE = { quote: null, overrides: {}, margin: 0, discount: { mode: "pct", value: 0 }, letter: {} };

  /* ------------------ proposal template (cover letter) ------------------ */
  var proposalTemplatesLoaded = false;
  function loadProposalTemplates() {
    var sel = $("dq-proposal-template");
    if (!sel) { console.warn("[DQ] #dq-proposal-template not in DOM"); return; }
    if (proposalTemplatesLoaded) return;
    var url = CONFIG.flowUrls && CONFIG.flowUrls.getProposalTemplates;
    console.log("[DQ] loadProposalTemplates url=", url ? url.slice(0, 80) + "..." : "(missing)");
    if (!url || url.indexOf("PASTE_") === 0) {
      sel.innerHTML = '<option value="">-- None (quotation only) --</option>';
      return;
    }
    proposalTemplatesLoaded = true;
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templateName: "" })
    })
      .then(function (r) {
        console.log("[DQ] proposal templates HTTP", r.status);
        return r.json();
      })
      .then(function (data) {
        var list = (data && data.templates) || [];
        console.log("[DQ] proposal templates count", list.length, list);
        sel.innerHTML = '<option value="">-- None (quotation only) --</option>';
        list.forEach(function (t) {
          var o = document.createElement("option");
          o.value = t.name;
          o.textContent = t.displayName || t.name;
          sel.appendChild(o);
        });
      })
      .catch(function (err) {
        console.error("[DQ] Failed to load proposal templates", err);
        proposalTemplatesLoaded = false;
      });
  }

  function fetchProposalTemplateHtml(templateName) {
    return new Promise(function (resolve) {
      if (!templateName) { resolve(""); return; }
      var url = CONFIG.flowUrls.getProposalTemplates;
      if (!url || url.indexOf("PASTE_") === 0) { resolve(""); return; }
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateName: templateName })
      })
        .then(function (r) { return r.json(); })
        .then(function (data) { resolve(data.html || ""); })
        .catch(function (err) {
          console.error("[DQ] Failed to fetch proposal template", err);
          resolve("");
        });
    });
  }

  function fillProposalTemplate(html, ctx) {
    if (!html) return "";
    return html
      .replace(/\{\{COMPANY\}\}/g,     esc(ctx.company || ""))
      .replace(/\{\{CONTACT\}\}/g,     esc(ctx.contact || ""))
      .replace(/\{\{ADDRESS\}\}/g,     esc(ctx.address || ""))
      .replace(/\{\{EMAIL\}\}/g,       esc(ctx.email   || ""))
      .replace(/\{\{PHONE\}\}/g,       esc(ctx.phone   || ""))
      .replace(/\{\{DATE\}\}/g,        esc(ctx.date    || ""))
      .replace(/\{\{QUOTE_ID\}\}/g,    esc(ctx.quoteId || ""))
      .replace(/\{\{VALID_UNTIL\}\}/g, esc(ctx.validUntil || ""));
  }

  // The proposal-template HTML returned by the flow is a FULL standalone HTML
  // document (<html>/<head>/<body>/<style>/.toolbar). Stuffing it raw into the
  // export clone causes:
  //   - the .toolbar (Back / Print buttons) to render at the top
  //   - body { background:... } rules to leak globally
  //   - external CSS / fonts (Inter, FontAwesome) to fail to load
  //   - 3-column layouts to break when squeezed into our 794px holder
  // Parse the doc, drop chrome, hoist <style> tags, and return a clean body
  // fragment that the caller wraps in a scoped container.
  function processProposalTemplateHtml(raw) {
    if (!raw) return "";
    var doc;
    try { doc = new DOMParser().parseFromString(raw, "text/html"); }
    catch (e) { return raw; }

    // Remove on-screen chrome that should never be in the PDF/Word output.
    var killSel = ".toolbar, .no-print, header.toolbar, nav.toolbar, .toolbar-actions, .print-only-toolbar";
    var kill = doc.querySelectorAll(killSel);
    for (var i = 0; i < kill.length; i++) kill[i].parentNode.removeChild(kill[i]);

    // PAGINATION: mirror the Quotation page EXACTLY. It renders this same template
    // with NO blank pages by (a) NOT inserting any forced `html2pdf__page-break`
    // markers and (b) STRIPPING all page-break CSS, then letting html2pdf paginate
    // naturally using only the `pagebreak.avoid` list. Forcing a break before each
    // `.sheet` (the old behaviour) put a break right next to a page boundary, which
    // html2pdf turned into a big BLANK region above the next section (e.g. the gap
    // before "Professional Services"). So we do NOT inject breaks here anymore.

    // Hoist <style> blocks. Rewrite top-level body/html rules to apply to our
    // wrapper instead so they don't leak onto the host page. Also STRIP page-break
    // declarations (template + @media print) so they can't force/suppress breaks —
    // pagination is driven entirely by html2pdf's avoid list (same as Quotation).
    var styles = doc.querySelectorAll("head style, body style");
    var styleHtml = "";
    for (var s = 0; s < styles.length; s++) {
      var css = styles[s].textContent || "";
      css = css.replace(/(^|\})\s*body\s*\{/g,        "$1 .dq-cover-letter{");
      css = css.replace(/(^|\})\s*html\s*\{/g,        "$1 .dq-cover-letter{");
      css = css.replace(/(^|\})\s*\*\s*\{/g,          "$1 .dq-cover-letter *{");
      css = css.replace(/page-break-before\s*:\s*[^;}]+;?/gi, "");
      css = css.replace(/page-break-after\s*:\s*[^;}]+;?/gi, "");
      css = css.replace(/break-before\s*:\s*page\s*;?/gi, "");
      css = css.replace(/break-after\s*:\s*page\s*;?/gi, "");
      styleHtml += "<style>" + css + "</style>";
    }

    // Override block — appended LAST so it wins over the template's own rules.
    // Templates wrap content in `.page { max-width:1000px; margin:18px auto;
    // box-shadow:... }`. The `margin:auto` centering + an oversized child make
    // html2canvas capture a canvas wider than our holder, which renders the
    // whole document at ~63% width anchored to the left (clipping the cover on
    // the left edge). Forcing the page to fill 100% width with no centering and
    // clipping horizontal overflow keeps the capture exactly holder-wide.
    // Override block — appended LAST so it wins over the template's own rules.
    // IMPORTANT: this MIRRORS the Quotation page's #proposal-root overrideCss so the
    // proposal renders IDENTICALLY on both pages. Do NOT re-introduce per-element
    // spacing tweaks (.cover/.section/.notes padding) — the template's own CSS is
    // already correct (it's the version that prints perfectly from the browser);
    // overriding it here is exactly what bloated the header and pushed Hardware
    // Notes off page 1. We only neutralise sheet sizing, re-assert grids, pin the
    // last-page footer, and avoid breaking inside cards.
    styleHtml +=
      "<style>" +
      ".dq-cover-letter{width:100%!important;max-width:100%!important;margin:0!important;overflow-x:hidden!important;background:#fff!important}" +
      ".dq-cover-letter .page{width:100%!important;max-width:100%!important;margin:0!important;box-shadow:none!important;border-radius:0!important}" +
      // Sheet-based templates (e.g. Server_Version6) wrap each printable page in
      // `.sheet` fixed at 8.5in x 11in. Stretch to full render width and drop the
      // fixed Letter height/margins so content isn't narrow and doesn't overflow
      // into a blank page. (Same as Quotation page; leaves .sheet padding intact.)
      ".dq-cover-letter .sheet{width:100%!important;max-width:100%!important;min-height:0!important;height:auto!important;max-height:none!important;margin:0!important;box-shadow:none!important;border-radius:0!important}" +
      // Re-assert horizontal grids regardless of viewport width.
      ".dq-cover-letter .cover .meta-grid{display:grid!important;grid-template-columns:repeat(4,1fr)!important}" +
      ".dq-cover-letter .about-strip{display:grid!important;grid-template-columns:repeat(4,1fr)!important}" +
      ".dq-cover-letter .plans-grid{display:grid!important;grid-template-columns:repeat(3,1fr)!important}" +
      ".dq-cover-letter .tiers{display:grid!important;grid-template-columns:repeat(3,1fr)!important}" +
      ".dq-cover-letter .services{display:grid!important;grid-template-columns:1fr 1fr!important}" +
      ".dq-cover-letter .steps{display:grid!important;grid-template-columns:repeat(5,1fr)!important}" +
      ".dq-cover-letter .accept-grid{display:grid!important;grid-template-columns:1fr 1fr!important}" +
      ".dq-cover-letter .doc-footer{display:grid!important;grid-template-columns:1fr 1fr 1fr!important}" +
      // `.last-page` pins the footer to the page bottom; html2canvas has no PDF-page
      // concept so pin it to one A4 page in canvas px. The cover renders at 1080px,
      // so one A4 page tall ≈ 1080*(297/210) ≈ 1527px; use a hair under that so the
      // footer lands at the bottom of the page WITHOUT spilling to a blank page.
      ".dq-cover-letter .last-page{min-height:1500px!important;display:flex!important;flex-direction:column!important}" +
      ".dq-cover-letter .last-page>.doc-footer{margin-top:auto!important}" +
      // Keep individual cards & short rows intact; let breaks fall BETWEEN rows.
      ".dq-cover-letter .service-card,.dq-cover-letter .plan-card,.dq-cover-letter .tier,.dq-cover-letter .notes,.dq-cover-letter .step,.dq-cover-letter .about-strip{page-break-inside:avoid!important;break-inside:avoid!important}" +
      ".dq-cover-letter h1,.dq-cover-letter h2,.dq-cover-letter h3,.dq-cover-letter h4{page-break-after:avoid!important;break-after:avoid!important}" +
      ".dq-cover-letter img{max-width:100%!important;height:auto}" +
      ".dq-cover-letter table{max-width:100%!important}" +
      "</style>";

    var bodyHtml = (doc.body && doc.body.innerHTML) || raw;
    return styleHtml + bodyHtml;
  }

  // Split the processed proposal into its individual `.sheet` blocks plus the
  // shared (hoisted + sanitized) <style> HTML. Each `.sheet` in these templates
  // is DESIGNED to be one printed page, and measurement confirms each sheet is
  // shorter than one A4 page at our 1080px render width. Rendering every sheet
  // as its OWN html2pdf pass (one page each) is what makes the page splits land
  // exactly on the sheet boundaries — no sheet is ever cut across a page break
  // and there is never a blank middle page (each render is fully independent).
  // Templates with no `.sheet` (e.g. `.page`-based) fall back to a single block,
  // i.e. the previous whole-document behaviour.
  function processProposalTemplateParts(raw) {
    var combined = processProposalTemplateHtml(raw);
    if (!combined) return { styleHtml: "", sheets: [] };
    var doc;
    try { doc = new DOMParser().parseFromString('<div id="__dqr">' + combined + "</div>", "text/html"); }
    catch (e) { return { styleHtml: "", sheets: [combined] }; }
    var root = doc.getElementById("__dqr");
    if (!root) return { styleHtml: "", sheets: [combined] };

    // Collect every <style> tag (hoisted overrides + any body-embedded styles)
    // so it can be prepended to each sheet's isolated render.
    var styleHtml = "";
    var styleTags = root.querySelectorAll("style");
    for (var i = 0; i < styleTags.length; i++) styleHtml += styleTags[i].outerHTML;

    var sheetEls = root.querySelectorAll(".sheet");
    var sheets = [];
    if (sheetEls.length) {
      for (var k = 0; k < sheetEls.length; k++) sheets.push(sheetEls[k].outerHTML);
    } else {
      // No sheet-based pagination — strip the style tags and keep the rest as a
      // single block (rendered in one pass, exactly like before).
      for (var s = 0; s < styleTags.length; s++) styleTags[s].parentNode.removeChild(styleTags[s]);
      sheets.push(root.innerHTML);
    }
    return { styleHtml: styleHtml, sheets: sheets };
  }

  // Build the placeholder context from the current quote + customer overrides.
  function proposalTemplateContext() {
    var q = STATE.quote || {};
    var c = (typeof effectiveCustomer === "function") ? effectiveCustomer() : {};
    return {
      company:    c.company || "",
      contact:    c.contact || "",
      address:    c.address || "",
      email:      c.email   || "",
      phone:      c.phone   || "",
      date:       c.quoteDate || todayISO(),
      quoteId:    q.number || "",
      validUntil: c.validUntil || plusDaysISO(15)
    };
  }

  // Prepend a filled cover-letter block to an export clone (with a page break).
  function prependProposalTemplate(clone, html) {
    if (!html) return;
    var wrap = document.createElement("div");
    wrap.className = "dq-cover-letter";
    // page-break-after on the wrapper + page-break-before on the next sibling
    // ensures the quotation always starts on its own page.
    wrap.setAttribute("style", "page-break-after:always;break-after:page;");
    wrap.innerHTML = processProposalTemplateHtml(html);
    clone.insertBefore(wrap, clone.firstChild);
  }

  function effectiveCustomer() {
    var o = STATE.overrides || {};
    // Customer details are NOT taken from the parsed Dell/Ingram quote.
    // The user enters them manually or imports them from Dynamics 365 CRM.
    return {
      company:   o.company   || "",
      contact:   o.contact   || "",
      email:     o.email     || "",
      phone:     o.phone     || "",
      quoteDate: o.quoteDate || todayISO(),
      validUntil:o.validUntil|| plusDaysISO(15),
      address:   o.address   || ""
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

    /* ----- Export-only branded header (centered logo + QUOTATION title + To address top-right) ----- */
    html += '<div class="dq-export-head dq-print-only">';
    html += '  <div class="dq-export-brand"><img id="dq-export-logo" src="/smartsoft-logo.png" alt="Smartsoft" /></div>';
    html += '  <h1 class="dq-export-title">QUOTATION</h1>';
    html += '  <div class="dq-export-to">';
    html += '    <span class="dq-to-label">To,</span>';
    if (c.company) html += '    <div><strong>' + esc(c.company) + '</strong></div>';
    if (c.contact) html += '    <div>Attn: ' + esc(c.contact) + '</div>';
    if (c.address) html += '    <div style="white-space:pre-line">' + esc(c.address) + '</div>';
    if (c.email)   html += '    <div>' + esc(c.email) + '</div>';
    if (c.phone)   html += '    <div>' + esc(c.phone) + '</div>';
    html += '  </div>';
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
      html += '  <td class="num dq-qty-cell">';
      html += '    <input type="number" min="0" step="1" class="dq-qty-input dq-screen-only" data-idx="' + i + '" value="' + (it.qty || 0) + '" />';
      html += '    <span class="dq-print-only">' + (it.qty || 0) + '</span>';
      html += '  </td>';
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
    var tHead = 'font-weight:700;margin:10px 0 3px;color:#1a2533;font-size:12px;';
    var tItem = 'margin:2px 0 2px 26px;text-indent:-14px;text-align:justify;font-size:12px;';
    html += '<div class="dq-foot">';
    html += '  <div style="font-weight:700;font-size:13px;color:#1a2533;margin-bottom:4px;">Terms &amp; Conditions</div>';
    html += '  <div style="' + tHead + '">1) Commercial Terms:</div>';
    html += '  <p style="' + tItem + '">&middot;&nbsp;&nbsp;Price Quoted are valid only for above mentioned Bill of Material, Price will change if any Changes in Bill of Material.</p>';
    html += '  <p style="' + tItem + '">&middot;&nbsp;&nbsp;Interest @18% will be charged for the delayed payments.</p>';
    html += '  <p style="' + tItem + '">&middot;&nbsp;&nbsp;Payment Terms: 100% advance along with the purchase order.</p>';
    html += '  <p style="' + tItem + '">&middot;&nbsp;&nbsp;Warranty coverage shall be as per the terms specified in the product specifications or unique offering terms. No additional warranties are implied unless expressly stated.</p>';
    html += '  <div style="' + tHead + '">2) Taxes:</div>';
    html += '  <p style="' + tItem + '">&middot;&nbsp;&nbsp;Any changes in Taxes by Govt. of India while billing/invoicing will be subsequently added or subtracted from the value without any notice.</p>';
    html += '  <p style="' + tItem + '">&middot;&nbsp;&nbsp;These Terms and Conditions shall be governed by and construed in accordance with the laws of India.</p>';
    html += '  <div style="' + tHead + '">3) Invoicing:</div>';
    html += '  <p style="' + tItem + '">&middot;&nbsp;&nbsp;Invoicing/ Billing will be done only on OR after delivering the Product which has been ordered.</p>';
    html += '  <p style="' + tItem + '">&middot;&nbsp;&nbsp;If any correction to be made in the invoice it should be intimated within 3 days from the date of delivery of invoice.</p>';
    html += '  <div style="' + tHead + '">4) Delivery:</div>';
    html += '  <p style="' + tItem + '">&middot;&nbsp;&nbsp;Within 4-5 weeks from the date of receiving the Purchase Order. Electronic license would be delivered by the respective Principle.</p>';
    html += '  <p style="margin:12px 0 0;text-align:justify;font-style:italic;font-size:12px;">We hope that our offer will meet with your approval and wait to receive your firm order at your earliest convenience. Thanking you again and assuring you of our best attention at all times.</p>';
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
    if (n === 2) {
      try { loadProposalTemplates(); } catch (err) { console.error("[DQ] loadProposalTemplates error", err); }
    }
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
        STATE.letter = {};
        prefillOverrideForm();
        prefillLetterForm();
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

  /* --------------- editable cover letter + terms (Word export) -------------- */
  var DEFAULT_TERMS = [
    "Commercial Terms:",
    "Price Quoted are valid only for above mentioned Bill of Material, Price will change if any Changes in Bill of Material.",
    "Interest @18% will be charged for the delayed payments.",
    "Payment Terms: 100% advance along with the purchase order.",
    "Warranty coverage shall be as per the terms specified in the product specifications or unique offering terms. No additional warranties are implied unless expressly stated.",
    "Taxes:",
    "Any changes in Taxes by Govt. of India while billing/invoicing will be subsequently added or subtracted from the value without any notice.",
    "These Terms and Conditions shall be governed by and construed in accordance with the laws of India.",
    "Invoicing:",
    "Invoicing/ Billing will be done only on OR after delivering the Product which has been ordered.",
    "If any correction to be made in the invoice it should be intimated within 3 days from the date of delivery of invoice.",
    "Delivery:",
    "Within 4-5 weeks from the date of receiving the Purchase Order. Electronic license would be delivered by the respective Principle."
  ].join("\n");

  // Classify the quote's product family from item/component text so the
  // letter title reads "Quotation for <type>" (Server, GPU Server,
  // Workstation, Storage, ...). The title stays editable for overrides.
  function productType(q) {
    var items = (q && q.items) || [];
    var txt = "";
    for (var i = 0; i < items.length; i++) {
      txt += " " + (items[i].description || "");
      var comps = items[i].components || [];
      for (var j = 0; j < comps.length; j++) {
        txt += " " + (comps[j].module || "") + " " + (comps[j].description || "");
      }
    }
    txt = txt.toLowerCase();
    function has(re) { return re.test(txt); }
    if (has(/precision|workstation/)) return "Workstation";
    if (has(/powervault|\bme5\b|\bunity\b|storage array|\bjbod\b|\bnas\b|\bsan\b/)) return "Storage";
    if (has(/optiplex/)) return "Desktop";
    if (has(/latitude/)) return "Laptop";
    if (has(/poweredge|\bserver\b/)) {
      if (has(/gpu|nvidia|\bh100\b|\bh200\b|\bl40\b|\ba100\b|accelerat/)) return "GPU Server";
      return "Server";
    }
    return "Server";
  }

  function letterDefaults() {
    var q = STATE.quote || {};
    var firstItem = (q.items && q.items[0]) ? (q.items[0].description || "") : "";
    var ptype = productType(q);
    return {
      title:             "Quotation for " + ptype,
      recipientTitle:    "The Director",
      subject:           "Quotation for " + ptype,
      senderContactLine: "Email\u2013ashish@smartsoft.co.in   Contact No: 9895604838",
      intro:             "We are a trusted system integrator with over 27 years of industry experience and an authorized partner of Dell EMC, IBM, Microsoft, HP, HPE, Cisco, Arista Networks, Juniper, Check Point, and Palo Alto Networks. Our organization is supported by certified professionals with deep expertise in server, desktop, and application virtualization, networking, storage, collaboration, cybersecurity, system management, software licensing, and end-user computing. Backed by a dedicated R&D and technical support team, we deliver high-quality services and comprehensive end-to-end support. As a single-source solution provider, we offer fully integrated enterprise solutions encompassing hardware, software, virtualization, backup, security, connectivity, high availability, and implementation services.",
      closingLine:       "Please feel free to contact us for more information on how to equip your business with modern technology platform.",
      signName:          "Susan Mathew",
      signTitle:         "General Manager",
      make:              "DELL",
      model:             firstItem,
      terms:             DEFAULT_TERMS,
      closingNote:       "We hope that our offer will meet with your approval and wait to receive your firm order at your earliest convenience. Thanking you again and assuring you our best services at all times.",
      finalSignName:     "Ashish Vasudevan",
      finalSignOrg:      "For Smartsoft"
    };
  }

  // Merge saved letter overrides over the defaults (blank fields fall back).
  function effectiveLetter() {
    var d = letterDefaults();
    var o = STATE.letter || {};
    var out = {};
    for (var k in d) {
      if (!d.hasOwnProperty(k)) continue;
      out[k] = (o[k] != null && String(o[k]).length) ? o[k] : d[k];
    }
    return out;
  }

  function prefillLetterForm() {
    var f = $("dq-letter-form");
    if (!f) return;
    var l = effectiveLetter();
    for (var k in l) {
      if (l.hasOwnProperty(k) && f[k] != null) f[k].value = l[k];
    }
  }

  function applyLetter() {
    var f = $("dq-letter-form");
    if (!f) return;
    var d = letterDefaults();
    var out = {};
    for (var k in d) {
      if (d.hasOwnProperty(k) && f[k] != null) out[k] = f[k].value;
    }
    STATE.letter = out;
    var b = $("dq-apply-letter");
    if (b) { var t = b.textContent; b.textContent = "Saved \u2713"; setTimeout(function () { b.textContent = t; }, 1200); }
  }

  // yyyy-mm-dd -> dd/mm/yyyy (leaves other formats untouched).
  function fmtDMY(iso) {
    if (!iso) return "";
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
    return m ? (m[3] + "/" + m[2] + "/" + m[1]) : String(iso);
  }

  // Inline an image as a data: URL (cached). Relative URLs don't resolve when
  // a .doc is opened locally, so the Word export embeds images this way.
  var IMG_CACHE = {};
  function ensureImageDataUrl(src) {
    return new Promise(function (resolve) {
      if (IMG_CACHE[src] !== undefined) { resolve(IMG_CACHE[src]); return; }
      var img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = function () {
        try {
          var c = document.createElement("canvas");
          c.width = img.naturalWidth || img.width;
          c.height = img.naturalHeight || img.height;
          c.getContext("2d").drawImage(img, 0, 0);
          IMG_CACHE[src] = c.toDataURL("image/png");
        } catch (e) { IMG_CACHE[src] = ""; }
        resolve(IMG_CACHE[src]);
      };
      img.onerror = function () { IMG_CACHE[src] = ""; resolve(""); };
      img.src = src;
    });
  }

  // Build the letterhead + addressed cover-letter HTML for the Word export.
  // Mirrors the company's standard 2-page letter: page 1 = letterhead + title +
  // recipient address + sender contact; page 2 = date + recipient address +
  // subject + intro + closing + signature.
  function dqLetterCoverHtml(letter, c, lhData) {
    // Build address, dropping a leading line that merely repeats the company
    // name (the parsed Dell data often duplicates it on the first address line).
    var addrRaw = c.address ? String(c.address) : "";
    if (addrRaw && c.company) {
      var aLines = addrRaw.split(/\r?\n/);
      while (aLines.length && aLines[0].trim().toLowerCase() === String(c.company).trim().toLowerCase()) {
        aLines.shift();
      }
      addrRaw = aLines.join("\n");
    }
    var addr = addrRaw ? esc(addrRaw).replace(/\n/g, "<br/>") : "";
    // Recipient ("To") block — the only part that changes per quote.
    function recipient() {
      var s = 'To,<br/>' + esc(letter.recipientTitle) + '<br/>';
      s += '<span class="dq-lt-org">' + esc(c.company) + '</span>';
      if (addr) s += '<br/>' + addr;
      return s;
    }

    var s = "";
    /* ---------- Page 1 ---------- */
    if (lhData) s += '<div class="dq-lh"><img src="' + lhData + '" alt="Smartsoft" width="640" style="width:480pt;height:auto" /></div>';
    s += '<div class="dq-lt-gap1">&nbsp;</div>';
    s += '<div class="dq-lt-title">' + esc(letter.title) + '</div>';
    // NOTE: the recipient ("To") block lives ONLY on page 2 (dqLetterBodyHtml).
    // Page 1 is the cover: letterhead + centered title + sender contact pinned
    // to the lower-left via the large gap2 spacer.
    s += '<div class="dq-lt-gap2">&nbsp;</div>';
    s += '<div class="dq-lt-contact"><span class="dq-lt-clabel">Contact Person</span><br/><span class="dq-lt-cname">' + esc(letter.finalSignName) + '</span>';
    if (letter.senderContactLine) {
      // Email and "Contact No" each on their own line.
      var cl = String(letter.senderContactLine);
      var ci = cl.search(/Contact No/i);
      if (ci > 0) {
        s += '<br/><span class="dq-lt-norm">' + esc(cl.slice(0, ci).trim()) + '</span>';
        s += '<br/><span class="dq-lt-norm">' + esc(cl.slice(ci).trim()) + '</span>';
      } else {
        s += '<br/><span class="dq-lt-norm">' + esc(cl) + '</span>';
      }
    }
    s += '</div>';
    return s;
  }

  // Page 2 — the letter body (date, recipient, subject, intro, signature).
  // Lives in its own Word section so it always begins on a fresh page and the
  // running header (logo) applies here but NOT on the cover (page 1).
  function dqLetterBodyHtml(letter, c) {
    var addrRaw = c.address ? String(c.address) : "";
    if (addrRaw && c.company) {
      var aLines = addrRaw.split(/\r?\n/);
      while (aLines.length && aLines[0].trim().toLowerCase() === String(c.company).trim().toLowerCase()) {
        aLines.shift();
      }
      addrRaw = aLines.join("\n");
    }
    var addr = addrRaw ? esc(addrRaw).replace(/\n/g, "<br/>") : "";
    var recipient = 'To,<br/>' + esc(letter.recipientTitle) + '<br/>'
      + '<span class="dq-lt-org">' + esc(c.company) + '</span>' + (addr ? '<br/>' + addr : '');

    var s = "";
    // Page 2 begins via the Word SECTION BREAK (WordSection1 -> WordSection2),
    // so no page-break class is needed on the date (that would risk a blank
    // page at the top of the new section).
    s += '<div class="dq-lt-date">' + esc(fmtDMY(c.quoteDate)) + '</div>';
    s += '<div class="dq-lt-to">' + recipient + '</div>';
    s += '<div class="dq-lt-sub">Sub: ' + esc(letter.subject) + '</div>';
    s += '<div class="dq-lt-dear">Dear Sir,</div>';
    s += '<p class="dq-lt-p">' + esc(letter.intro) + '</p>';
    if (letter.closingLine) s += '<p class="dq-lt-closing">' + esc(letter.closingLine) + '</p>';
    s += '<div class="dq-lt-sign">' + esc(letter.finalSignOrg) + '<br/>' + esc(letter.signName) + '<br/>' + esc(letter.signTitle) + '</div>';
    return s;
  }


  // Build the Terms & Conditions + closing note + final signature HTML.
  // Mirrors the real doc: colon-ended lines are numbered bold sub-headings
  // (1) 2) 3)...), every other line is a justified bullet (·) item.
  // sigData (optional) is an inlined signature/seal image shown above the name.
  function dqTermsHtml(letter, sigData) {
    var lines = String(letter.terms || "").split(/\r?\n/);
    var out = '<div class="dq-terms"><div class="dq-terms-h">Terms &amp; Conditions</div>';
    var n = 0;
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i].replace(/\s+$/, "").trim();
      if (!ln) continue;
      if (/:$/.test(ln)) {
        n++;
        out += '<div class="dq-terms-sub">' + n + ') ' + esc(ln) + '</div>';
      } else {
        out += '<p class="dq-terms-p">\u00b7\u00a0\u00a0' + esc(ln) + '</p>';
      }
    }
    out += '</div>';
    if (letter.closingNote) out += '<p class="dq-lt-closenote">' + esc(letter.closingNote) + '</p>';
    var sig = '<div class="dq-lt-sign dq-lt-sign-final">Thanking You,<br/><br/>' + esc(letter.finalSignOrg) + '<br/>';
    if (sigData) sig += '<img src="' + sigData + '" class="dq-sign-img" alt="Signature" /><br/>';
    sig += esc(letter.finalSignName) + '</div>';
    out += sig;
    return out;
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

  /* --------------------------------------------------------------------------
     PDF pipeline (shared by Download PDF + Email PDF).

     The cover letter (a full standalone proposal-template document designed for
     ~1000px pages) and the quotation (designed for ~794px / A4 width) are
     rendered as TWO SEPARATE html2pdf passes — each at its own native width —
     and then merged with pdf-lib. Rendering both in one html2canvas pass forced
     a single shared width, which made the whole document render at ~63% width
     anchored to the left (cover clipped on the left, blank strip on the right).
     Separate passes + explicit scrollX/scrollY:0 eliminate that offset.
     This mirrors the proven Quotation-page pipeline.
     -------------------------------------------------------------------------- */

  function loadPdfLib() {
    return new Promise(function (resolve, reject) {
      if (window.PDFLib) { resolve(); return; }
      var s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js";
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error("pdf-lib failed to load")); };
      document.head.appendChild(s);
    });
  }

  // Open a real POPUP window SYNCHRONOUSLY from the click handler (before any
  // await/fetch) or the browser blocks it. Returns null if blocked. We DON'T
  // write anything here (no placeholder, no document.open) — writing a placeholder
  // and later calling document.open() can sever window.opener and break the
  // postMessage handshake. renderCoverInPopup writes the full doc ONCE, exactly
  // like the Quotation page.
  function openPdfPopup() {
    var pw = window.open("", "_blank", "width=1120,height=1100");
    return pw || null;
  }

  // Render proposal cover + quotation to a single merged PDF Blob ENTIRELY
  // INSIDE the popup — a verbatim port of the Quotation page's pipeline. The
  // popup loads html2pdf + pdf-lib, renders #proposal-root (1080px) then
  // #quotation-root (794px), merges with pdf-lib, and returns the merged PDF to
  // this parent via TWO channels (postMessage + a polled global) for robustness.
  // Doing the WHOLE pipeline in-window is what makes the proposal paginate
  // correctly (forced `.sheet` breaks honoured, no blank page) — identical to
  // the Quotation page. The popup also shows any error in its own status bar.
  function renderMergedInPopup(pw, proposalInnerHtml, quotationInnerHtml, dqCss, onStatus) {
    return new Promise(function (resolve, reject) {
      if (!pw || pw.closed) { reject(new Error("PDF window was closed")); return; }

      var hasProposal = !!proposalInnerHtml;
      var token = "dqc_" + Date.now() + "_" + Math.floor(Math.random() * 1e9);

      var proposalOpt = {
        margin: [0, 0, 0, 0],
        image: { type: "jpeg", quality: 0.95 },
        html2canvas: { scale: 2, useCORS: true, allowTaint: true, logging: false, backgroundColor: "#ffffff", windowWidth: 1080, width: 1080, scrollX: 0, scrollY: 0 },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait", compress: true },
        pagebreak: { mode: ["css", "legacy"], avoid: ["tr", "thead", "tfoot", ".notes", ".about-strip", ".service-card", ".plan-card", ".tier", ".step", "h2", "h3", "h4"] }
      };
      var qtOpt = {
        margin: [12, 10, 14, 10],
        image: { type: "jpeg", quality: 0.95 },
        html2canvas: { scale: 2, useCORS: true, allowTaint: true, logging: false, backgroundColor: "#ffffff", windowWidth: 794, width: 794, scrollX: 0, scrollY: 0 },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait", compress: true },
        pagebreak: { mode: ["css", "legacy"], avoid: ["tr", "thead", "tfoot", ".dq-comp-section > h3"] }
      };
      var proposalOptJson = JSON.stringify(proposalOpt);
      var qtOptJson = JSON.stringify(qtOpt);

      var settled = false, timer = null, poll = null;
      function cleanup() {
        window.removeEventListener("message", onMsg);
        if (timer) { clearTimeout(timer); timer = null; }
        if (poll) { clearInterval(poll); poll = null; }
      }
      function done(ok, payload) {
        if (settled) { return; }
        settled = true;
        cleanup();
        // Close the render popup once we have the result (the parent no longer
        // manages the popup lifecycle). Delay slightly so the popup's own
        // "Done" status is briefly visible and the postMessage/global delivery
        // has fully flushed.
        try {
          if (ok && pw && !pw.closed) { setTimeout(function () { try { pw.close(); } catch (e) {} }, 400); }
        } catch (e) {}
        if (ok) { resolve(b64ToBlob(payload)); }
        else { reject(payload instanceof Error ? payload : new Error(payload || "PDF render failed in popup")); }
      }
      function b64ToBlob(b64) {
        var bin = atob(b64), len = bin.length, bytes = new Uint8Array(len);
        for (var i = 0; i < len; i++) { bytes[i] = bin.charCodeAt(i); }
        return new Blob([bytes], { type: "application/pdf" });
      }
      function onMsg(e) {
        var d = e.data;
        if (!d || d.dqToken !== token) { return; }
        if (d.ok) { done(true, d.data); } else { done(false, new Error(d.error || "PDF render failed in popup")); }
      }
      window.addEventListener("message", onMsg);
      poll = setInterval(function () {
        try {
          if (pw.closed) { done(false, new Error("PDF window was closed before the PDF finished")); return; }
          var r = pw.__dqResult;
          if (r && r.token === token) {
            if (r.ok) { done(true, r.data); } else { done(false, new Error(r.error || "PDF render failed in popup")); }
          }
        } catch (e) { /* cross-origin read blocked — rely on postMessage */ }
      }, 250);
      timer = setTimeout(function () { done(false, new Error("Timed out generating the PDF")); }, 90000);

      var bootstrap =
        '<scr' + 'ipt>(function(){' +
        'var TOKEN=' + JSON.stringify(token) + ',HASPROP=' + (hasProposal ? 'true' : 'false') + ';' +
        'function deliver(ok,data,err){' +
          'try{window.__dqResult={token:TOKEN,ok:ok,data:data,error:err};}catch(e){}' +
          'try{if(window.opener)window.opener.postMessage({dqToken:TOKEN,ok:ok,data:data,error:err},"*");}catch(e){}' +
        '}' +
        'function setStatus(html){try{document.getElementById("dq-pdf-status").innerHTML=html;}catch(e){}}' +
        'function b2b64(blob){return blob.arrayBuffer().then(function(buf){var b=new Uint8Array(buf),c=0x8000,p=[];for(var i=0;i<b.length;i+=c){p.push(String.fromCharCode.apply(null,b.subarray(i,i+c)));}return btoa(p.join(""));});}' +
        'function mergePdfs(blobs){if(blobs.length===1)return b2b64(blobs[0]);if(!window.PDFLib)return Promise.reject(new Error("pdf-lib failed to load"));return PDFLib.PDFDocument.create().then(function(m){function add(i){if(i>=blobs.length)return m.saveAsBase64();return blobs[i].arrayBuffer().then(function(buf){return PDFLib.PDFDocument.load(new Uint8Array(buf));}).then(function(s){return m.copyPages(s,s.getPageIndices());}).then(function(pg){pg.forEach(function(p){m.addPage(p);});return add(i+1);});}return add(0);});}' +
        'function run(){try{' +
          'if(!window.html2pdf){deliver(false,null,"html2pdf failed to load in the PDF window");setStatus("<strong style=\\"color:#b00\\">html2pdf failed to load.</strong>");return;}' +
          'var proposalEl=document.getElementById("proposal-root");' +
          'var quotationEl=document.getElementById("quotation-root");' +
          'var proposalOpt=' + proposalOptJson + ';' +
          'var qtOpt=' + qtOptJson + ';' +
          'var pipeline;' +
          'if(HASPROP){' +
            'setStatus("Rendering proposal (1/2)\\u2026");' +
            'pipeline=window.html2pdf().set(proposalOpt).from(proposalEl).outputPdf("blob").then(function(pBlob){' +
              'proposalEl.style.display="none";quotationEl.style.display="block";' +
              'setStatus("Rendering quotation (2/2)\\u2026");' +
              'return window.html2pdf().set(qtOpt).from(quotationEl).outputPdf("blob").then(function(qBlob){return mergePdfs([pBlob,qBlob]);});' +
            '});' +
          '}else{' +
            'setStatus("Rendering quotation\\u2026");' +
            'pipeline=window.html2pdf().set(qtOpt).from(quotationEl).outputPdf("blob").then(b2b64);' +
          '}' +
          'pipeline.then(function(b64){setStatus("Done \\u2014 this window closes automatically.");deliver(true,b64,null);})' +
          '.catch(function(e){var msg=(e&&e.message)?e.message:String(e);setStatus("<strong style=\\"color:#b00\\">PDF failed:</strong> "+msg);deliver(false,null,msg);});' +
        '}catch(e){var msg=(e&&e.message)?e.message:String(e);setStatus("<strong style=\\"color:#b00\\">PDF failed:</strong> "+msg);deliver(false,null,msg);}}' +
        // Do NOT wait for window.load — proposal images / icon fonts can keep the
        // load event pending for a long time (that left the popup stuck on
        // "Preparing PDF..."). The html2pdf + pdf-lib <script>s are synchronous in
        // <head>, so just poll until both globals exist, then render. html2canvas
        // loads any images itself during capture (they're already cached/visible).
        'function libsReady(){return !!(window.html2pdf&&window.PDFLib);}' +
        'var _w=0;' +
        'function start(){if(libsReady()){setTimeout(run,200);return;}_w+=100;if(_w>20000){var m="PDF libraries (html2pdf/pdf-lib) failed to load";setStatus("<strong style=\\"color:#b00\\">"+m+"</strong>");deliver(false,null,m);return;}setTimeout(start,100);}' +
        'start();' +
        '})();<\/scr' + 'ipt>';

      var doc =
        '<!doctype html><html><head><meta charset="utf-8"><title>Generating PDF\u2026</title>' +
        '<style>html,body{margin:0;padding:0;background:#fff;}' +
        '#dq-pdf-status{position:fixed;top:0;left:0;right:0;z-index:99999;background:#fff;border-bottom:1px solid #ddd;padding:12px;text-align:center;font:14px Segoe UI,system-ui,sans-serif;color:#555;}' +
        '#proposal-root{width:1080px;margin:40px auto 0;background:#fff;}' +
        '#quotation-root{width:794px;margin:40px auto 0;background:#fff;}</style>' +
        (dqCss ? '<style>' + dqCss + '</style>' : '') +
        '<scr' + 'ipt src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.2/html2pdf.bundle.min.js"><\/scr' + 'ipt>' +
        '<scr' + 'ipt src="https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js"><\/scr' + 'ipt>' +
        '</head><body>' +
        '<div id="dq-pdf-status">Preparing PDF\u2026</div>' +
        '<div id="proposal-root" style="display:' + (hasProposal ? 'block' : 'none') + ';">' + (proposalInnerHtml || '') + '</div>' +
        '<div id="quotation-root" style="display:' + (hasProposal ? 'none' : 'block') + ';">' + (quotationInnerHtml || '') + '</div>' +
        bootstrap +
        '</body></html>';

      try {
        // EXACTLY like the Quotation page: the popup is opened immediately
        // BEFORE this write (in buildQuotationPdfBlob, after the template fetch
        // resolved), so its parser is still fresh and the inline bootstrap
        // <script> runs and the CDN <script>s load under the normal page CSP.
        // (Pre-opening the popup before the async fetch, or navigating to a
        // blob: URL, both broke script execution / CDN loading.)
        pw.document.write(doc);
        pw.document.close();
      } catch (e) {
        done(false, e);
      }
    });
  }

  // Render a detached element to a PDF Blob inside an ISOLATED IFRAME.
  //
  // Rendering off-screen in the host page made html2canvas mis-measure the
  // layout (content came out ~half width / clipped left) because the host
  // page's stylesheets (bootstrap, Power Pages theme) and responsive rules
  // interfere. An iframe gives the element a CLEAN document at origin (0,0).
  // IMPORTANT: do NOT copy the host stylesheets in — that re-introduces the
  // same interference (a dark band + shifted content). Inject ONLY the CSS the
  // element actually needs (passed via `extraCss`); the cover letter already
  // inlines its own <style> blocks so it needs none.
  function renderElToPdfBlob(el, width, opt, extraCss) {
    return new Promise(function (resolve, reject) {
      var iframe = document.createElement("iframe");
      iframe.setAttribute("aria-hidden", "true");
      iframe.style.position = "fixed";
      iframe.style.left = "-10000px";
      iframe.style.top = "0";
      iframe.style.width = width + "px";
      iframe.style.height = "1200px";
      iframe.style.border = "0";
      iframe.style.background = "#fff";
      document.body.appendChild(iframe);

      var idoc = iframe.contentWindow.document;
      idoc.open();
      idoc.write(
        '<!doctype html><html><head><meta charset="utf-8">' +
        '<style>*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;overflow-x:hidden;}' +
        '#dq-pdf-root{width:' + width + 'px;max-width:' + width + 'px;margin:0;padding:0;background:#fff;overflow-x:hidden;}' +
        '#dq-pdf-root *{max-width:100%;}</style>' +
        (extraCss ? '<style>' + extraCss + '</style>' : '') +
        '</head><body><div id="dq-pdf-root"></div></body></html>'
      );
      idoc.close();

      function cleanup() { if (iframe.parentNode) iframe.parentNode.removeChild(iframe); }

      function go() {
        try {
          var root = idoc.getElementById("dq-pdf-root");
          root.appendChild(idoc.importNode(el, true));
          // CROSS-DOCUMENT CAPTURE FIX: html2pdf runs in the PARENT window but the
          // target element lives in this iframe. In that setup html2canvas must be
          // told the capture width EXPLICITLY (= the iframe/root width) and must NOT
          // be given `windowWidth` — windowWidth offsets the capture and clips one
          // edge. Setting `width` only yields a clean, full-width canvas. Enforce it
          // here so every caller renders correctly regardless of the opt it passes.
          opt = opt || {};
          opt.html2canvas = opt.html2canvas || {};
          opt.html2canvas.width = width;
          if ("windowWidth" in opt.html2canvas) { delete opt.html2canvas.windowWidth; }
          window.html2pdf().set(opt).from(root).outputPdf("blob").then(
            function (blob) { cleanup(); resolve(blob); },
            function (err) { cleanup(); reject(err); }
          );
        } catch (e) { cleanup(); reject(e); }
      }
      // Give the iframe document a tick to apply styles / load fonts + images.
      setTimeout(go, 350);
    });
  }

  // Render a detached element to a SINGLE-PAGE A4 PDF Blob, scaled to fit.
  //
  // Used for proposal `.sheet` blocks: each sheet is DESIGNED to be one printed
  // page, but html2pdf's own pagination splits a single short sheet across TWO
  // pages (a spurious second page) and packs adjacent sheets together so a sheet
  // gets cut across the page boundary. To get exactly one page per sheet we
  // bypass html2pdf pagination entirely: capture the sheet as ONE image
  // (html2pdf.outputImg) and place it on a single A4 page with pdf-lib, scaled
  // to fit the page (full width, top-aligned). This is what makes the proposal
  // FIT the page and the page split land exactly on the sheet boundary.
  function renderElToOnePagePdfBlob(el, width, extraCss) {
    return loadPdfLib().then(function () {
      return new Promise(function (resolve, reject) {
        var iframe = document.createElement("iframe");
        iframe.setAttribute("aria-hidden", "true");
        iframe.style.position = "fixed";
        iframe.style.left = "-10000px";
        iframe.style.top = "0";
        iframe.style.width = width + "px";
        iframe.style.height = "1200px";
        iframe.style.border = "0";
        iframe.style.background = "#fff";
        document.body.appendChild(iframe);

        var idoc = iframe.contentWindow.document;
        idoc.open();
        idoc.write(
          '<!doctype html><html><head><meta charset="utf-8">' +
          '<style>*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;overflow-x:hidden;}' +
          '#dq-pdf-root{width:' + width + 'px;max-width:' + width + 'px;margin:0;padding:0;background:#fff;overflow-x:hidden;}' +
          '#dq-pdf-root *{max-width:100%;}</style>' +
          (extraCss ? '<style>' + extraCss + '</style>' : '') +
          '</head><body><div id="dq-pdf-root"></div></body></html>'
        );
        idoc.close();

        function cleanup() { if (iframe.parentNode) iframe.parentNode.removeChild(iframe); }

        function go() {
          try {
            var root = idoc.getElementById("dq-pdf-root");
            root.appendChild(idoc.importNode(el, true));
            // Capture the whole sheet as a single image. Cross-document capture:
            // set html2canvas.width = render width and DO NOT set windowWidth.
            var opt = {
              image: { type: "jpeg", quality: 0.95 },
              html2canvas: { scale: 2, useCORS: true, allowTaint: true, logging: false, backgroundColor: "#ffffff", scrollX: 0, scrollY: 0, width: width }
            };
            window.html2pdf().set(opt).from(root).outputImg("datauristring").then(function (dataUrl) {
              cleanup();
              return fetch(dataUrl).then(function (r) { return r.arrayBuffer(); }).then(function (buf) {
                return PDFLib.PDFDocument.create().then(function (pdf) {
                  return pdf.embedJpg(buf).then(function (img) {
                    var A4W = 595.28, A4H = 841.89;
                    // Fit the whole image within the page (preserve aspect). The
                    // sheet is portrait & narrower-than-tall, so this fills the
                    // page WIDTH and leaves white at the bottom if it's short —
                    // exactly how the template is meant to print (1 sheet = 1 page).
                    var sc = Math.min(A4W / img.width, A4H / img.height);
                    var w = img.width * sc, h = img.height * sc;
                    var page = pdf.addPage([A4W, A4H]);
                    page.drawImage(img, { x: (A4W - w) / 2, y: A4H - h, width: w, height: h });
                    return pdf.save();
                  });
                });
              }).then(function (bytes) {
                resolve(new Blob([bytes], { type: "application/pdf" }));
              });
            }, function (err) { cleanup(); reject(err); }).catch(function (err) { cleanup(); reject(err); });
          } catch (e) { cleanup(); reject(e); }
        }
        setTimeout(go, 350);
      });
    });
  }


  // `.dq-*`), excluding bootstrap / theme sheets. Injected into the render
  // iframe so the quotation keeps its styling without dragging in the host CSS
  // that breaks the capture.
  function collectDqCss() {
    var out = "";
    var sheets = document.styleSheets;
    for (var i = 0; i < sheets.length; i++) {
      var rules;
      try { rules = sheets[i].cssRules; } catch (e) { continue; }
      if (!rules) continue;
      var text = "";
      var hasDq = false;
      for (var j = 0; j < rules.length; j++) {
        var t = rules[j].cssText || "";
        text += t + "\n";
        if (t.indexOf(".dq-") !== -1) hasDq = true;
      }
      if (hasDq) out += text;
    }
    return out;
  }

  // Merge an array of PDF Blobs into a single PDF Blob (pdf-lib).
  function mergePdfBlobs(blobs) {
    if (blobs.length === 1) return Promise.resolve(blobs[0]);
    return loadPdfLib().then(function () {
      return PDFLib.PDFDocument.create().then(function (merged) {
        function addOne(i) {
          if (i >= blobs.length) {
            return merged.save().then(function (bytes) {
              return new Blob([bytes], { type: "application/pdf" });
            });
          }
          return blobs[i].arrayBuffer()
            .then(function (buf) { return PDFLib.PDFDocument.load(new Uint8Array(buf)); })
            .then(function (src) { return merged.copyPages(src, src.getPageIndices()); })
            .then(function (pages) {
              pages.forEach(function (p) { merged.addPage(p); });
              return addOne(i + 1);
            });
        }
        return addOne(0);
      });
    });
  }

  // Build the cover-letter element (scoped, sanitized proposal-template HTML).
  function buildCoverLetterEl(tplHtml) {
    var wrap = document.createElement("div");
    wrap.className = "dq-cover-letter";
    wrap.innerHTML = processProposalTemplateHtml(tplHtml);
    return wrap;
  }

  // Fetch + fill the selected template (if any), then produce the final merged
  // PDF Blob. onStatus(msg) is called with progress strings for button text.
  // The render popup is opened INTERNALLY, after the template fetch resolves and
  // right before it is written to (mirrors the Quotation page exactly).
  function buildQuotationPdfBlob(templateName, onStatus) {
    return fetchProposalTemplateHtml(templateName).then(function (tplHtmlRaw) {
      var tplHtml = fillProposalTemplate(tplHtmlRaw, proposalTemplateContext());
      var dqCss = collectDqCss();

      var quotationEl = buildExportClone();
      // For the PDF, move the price/items table to the bottom of the
      // configurations — just before the Terms & Conditions footer.
      (function () {
        var itemsTbl = quotationEl.querySelector(".dq-items-table");
        var foot = quotationEl.querySelector(".dq-foot");
        if (itemsTbl && foot && foot.parentNode === quotationEl) {
          // Add breathing room above the price table now that it sits at the
          // bottom, just after the configuration tables.
          itemsTbl.style.marginTop = "24px";
          quotationEl.insertBefore(itemsTbl, foot);
        }
      })();
      var qtOpt = {
        margin:   [12, 10, 14, 10],
        image:    { type: "jpeg", quality: 0.95 },
        html2canvas: { scale: 2, useCORS: true, allowTaint: true, logging: false, backgroundColor: "#ffffff", scrollX: 0, scrollY: 0 },
        jsPDF:    { unit: "mm", format: "a4", orientation: "portrait", compress: true },
        pagebreak:{ mode: ["css", "legacy"], avoid: ["tr", "thead", "tfoot", ".dq-comp-section > h3"] }
      };

      // No proposal template selected → render the quotation only (the existing
      // iframe path works perfectly and is instant).
      if (!tplHtml) {
        if (onStatus) onStatus("Rendering PDF...");
        return renderElToPdfBlob(quotationEl, 794, qtOpt, dqCss);
      }

      var coverParts = processProposalTemplateParts(tplHtml);

      // Render the proposal cover and the quotation each in an ISOLATED IFRAME,
      // then merge in the parent with pdf-lib. This is the path that reliably
      // DOWNLOADS on the live site.
      //
      // PAGE SPLIT: render EACH proposal `.sheet` as its OWN single A4 page via
      // renderElToOnePagePdfBlob (html2pdf.outputImg + pdf-lib), captured at
      // 1080px. Each sheet is designed to be one printed page; measurement shows
      // every sheet is shorter than one A4 page at this width, so it is scaled to
      // FIT the page (full width, top-aligned). One sheet = one page means the
      // page split lands exactly on the sheet boundary — no sheet is cut and there
      // is no spurious blank page (html2pdf's own pagination, which split a single
      // short sheet onto two pages, is bypassed). Templates without `.sheet` render
      // as one block.

      var coverBlobs = [];
      var total = coverParts.sheets.length;
      function renderSheetAt(i) {
        if (i >= total) return Promise.resolve();
        if (onStatus) onStatus("Rendering proposal (" + (i + 1) + "/" + total + ")...");
        var sheetEl = document.createElement("div");
        sheetEl.className = "dq-cover-letter";
        sheetEl.innerHTML = coverParts.styleHtml + coverParts.sheets[i];
        return renderElToOnePagePdfBlob(sheetEl, 1080, "").then(function (b) {
          coverBlobs.push(b);
          return renderSheetAt(i + 1);
        });
      }

      return renderSheetAt(0).then(function () {
        if (onStatus) onStatus("Rendering quote...");
        return renderElToPdfBlob(quotationEl, 794, qtOpt, dqCss).then(function (qtBlob) {
          if (onStatus) onStatus("Merging...");
          return mergePdfBlobs(coverBlobs.concat([qtBlob]));
        });
      });
    });
  }

  /* ============================ NATIVE-PRINT PDF ============================
     The Download PDF action prints via the browser ("Save as PDF") so the
     output is SELECTABLE / COPYABLE text — never a rasterized image. The
     proposal template keeps its own CSS (so its text sizes match the source
     exactly) and is scoped to `.dq-pp` so it cannot bleed into the quotation;
     the Dell quotation is appended as `.dq-pq` (real HTML, its own `.dq-` CSS).
     @page is forced to A4. This mirrors the Quotation page's openPrintPopup. */

  // Remove whole at-rule blocks (@media / @page) by brace-matching — a regex
  // alone cannot handle the nested rule braces reliably.
  function stripCssBlocks(css, prelude) {
    var re = new RegExp(prelude, "gi");
    var out = "", i = 0, m;
    while ((m = re.exec(css)) !== null) {
      out += css.slice(i, m.index);
      var depth = 1, j = re.lastIndex;
      while (j < css.length && depth > 0) {
        var ch = css.charAt(j);
        if (ch === "{") depth++;
        else if (ch === "}") depth--;
        j++;
      }
      i = j; re.lastIndex = j;
    }
    out += css.slice(i);
    return out;
  }

  // Collect ONLY `.dq-` selector rules (and @media blocks that mention them) so
  // the quotation keeps its styling without dragging host `body`/`*` rules into
  // the print popup (those would clobber the proposal / page box).
  function collectDqRules() {
    var out = "";
    var sheets = document.styleSheets;
    for (var i = 0; i < sheets.length; i++) {
      var rules;
      try { rules = sheets[i].cssRules; } catch (e) { continue; }
      if (!rules) continue;
      for (var j = 0; j < rules.length; j++) {
        var r = rules[j];
        var t = r.cssText || "";
        if (r.type === 4 /* CSSMediaRule */) {
          if (t.indexOf(".dq-") !== -1) out += t + "\n";
        } else if (r.selectorText && r.selectorText.indexOf(".dq-") !== -1) {
          out += t + "\n";
        }
      }
    }
    return out;
  }

  // Turn a full standalone proposal-template document into print-ready,
  // SCOPED markup. The template's own <style> is kept (preserving its text
  // sizes / colours / layout) but: @media + @page blocks are dropped (they
  // force Letter sizing & re-grid for screen), and global selectors
  // (html/body/*) are scoped to `.dq-pp`. A print-fit override block makes each
  // `.sheet` flow to A4 width and break onto its own page.
  function buildProposalPrintHtml(rawTpl) {
    if (!rawTpl) return { styleHtml: "", bodyHtml: "" };
    var doc;
    try { doc = new DOMParser().parseFromString(rawTpl, "text/html"); }
    catch (e) { return { styleHtml: "", bodyHtml: rawTpl }; }

    var kill = doc.querySelectorAll(".toolbar, .no-print, .toolbar-actions, .print-only-toolbar, script");
    for (var k = 0; k < kill.length; k++) {
      if (kill[k].parentNode) kill[k].parentNode.removeChild(kill[k]);
    }

    var styles = doc.querySelectorAll("style");
    var styleHtml = "";
    for (var s = 0; s < styles.length; s++) {
      var css = styles[s].textContent || "";
      css = stripCssBlocks(css, "@media[^{]*\\{");
      css = stripCssBlocks(css, "@page[^{]*\\{");
      // Scope global selectors to the proposal wrapper.
      css = css.replace(/(^|\})\s*html\s*,\s*body\s*\{/g, "$1 .dq-pp{");
      css = css.replace(/(^|\})\s*body\s*,\s*html\s*\{/g, "$1 .dq-pp{");
      css = css.replace(/(^|\})\s*body\s*\{/g, "$1 .dq-pp{");
      css = css.replace(/(^|\})\s*html\s*\{/g, "$1 .dq-pp{");
      css = css.replace(/(^|\})\s*\*\s*\{/g, "$1 .dq-pp *{");
      styleHtml += "<style>" + css + "</style>";
    }

    // Print-fit overrides (scoped, win by specificity + source order).
    styleHtml +=
      "<style>" +
      ".dq-pp{background:#fff!important}" +
      ".dq-pp .sheet{width:auto!important;max-width:100%!important;min-height:0!important;height:auto!important;max-height:none!important;margin:0!important;box-shadow:none!important;border-radius:0!important;overflow:visible!important;page-break-after:always;break-after:page}" +
      ".dq-pp .sheet:last-of-type{page-break-after:auto;break-after:auto}" +
      ".dq-pp .about-strip{display:grid!important;grid-template-columns:repeat(4,1fr)!important}" +
      ".dq-pp .plans-grid{display:grid!important;grid-template-columns:repeat(3,1fr)!important}" +
      ".dq-pp .services{display:grid!important;grid-template-columns:1fr 1fr!important}" +
      ".dq-pp .tiers{display:grid!important;grid-template-columns:repeat(3,1fr)!important}" +
      ".dq-pp .steps{display:grid!important;grid-template-columns:repeat(5,1fr)!important}" +
      ".dq-pp .accept-grid{display:grid!important;grid-template-columns:1fr 1fr!important}" +
      ".dq-pp .doc-footer{display:grid!important;grid-template-columns:1fr 1fr 1fr!important}" +
      ".dq-pp .meta-grid{display:grid!important;grid-template-columns:repeat(4,1fr)!important}" +
      ".dq-pp .plan-card,.dq-pp .service-card,.dq-pp .stat,.dq-pp .notes,.dq-pp .doc-footer,.dq-pp .tier,.dq-pp .step,.dq-pp .card{break-inside:avoid;page-break-inside:avoid}" +
      ".dq-pp h1,.dq-pp h2,.dq-pp h3,.dq-pp h4{break-after:avoid;page-break-after:avoid}" +
      ".dq-pp img{max-width:100%!important;height:auto}" +
      "</style>";

    var bodyHtml = (doc.body && doc.body.innerHTML) || rawTpl;
    return { styleHtml: styleHtml, bodyHtml: bodyHtml };
  }

  // Clone the quotation for print, moving the price/items table to the bottom
  // (just before T&C) and resolving image sources to absolute URLs so they load
  // inside the about:blank print popup.
  function buildPrintQuoteEl() {
    var clone = buildExportClone();
    var itemsTbl = clone.querySelector(".dq-items-table");
    var foot = clone.querySelector(".dq-foot");
    if (itemsTbl && foot && foot.parentNode === clone) {
      itemsTbl.style.marginTop = "24px";
      clone.insertBefore(itemsTbl, foot);
    }
    var imgs = clone.querySelectorAll("img");
    for (var i = 0; i < imgs.length; i++) {
      // imgs[i].src is the absolute, resolved URL in THIS document; pin it onto
      // the attribute so the serialized HTML carries an absolute src.
      try { imgs[i].setAttribute("src", imgs[i].src); } catch (e) {}
    }
    return clone;
  }

  // Open a print popup containing the (optional) proposal template + the Dell
  // quotation as selectable text, then trigger the browser print dialog.
  function printDellQuotation(templateName) {
    return Promise.all([fetchProposalTemplateHtml(templateName), ensureLogoDataUrl()]).then(function (res) {
      var rawTpl = res[0];
      var logoData = res[1];
      var tplHtml = rawTpl ? fillProposalTemplate(rawTpl, proposalTemplateContext()) : "";
      var prop = tplHtml ? buildProposalPrintHtml(tplHtml) : { styleHtml: "", bodyHtml: "" };
      var dqCss = collectDqRules();
      var quoteEl = buildPrintQuoteEl();
      // Inline the logo so it renders regardless of the popup's origin/relative
      // URL resolution (works identically on the site and in the Outlook add-in).
      if (logoData) {
        var lg = quoteEl.querySelector("#dq-export-logo");
        if (lg) lg.setAttribute("src", logoData);
      }

      var pw = window.open("", "_blank", "width=850,height=1100");
      if (!pw) { alert("Please allow pop-ups for this site to download the PDF."); return; }

      var baseCss =
        "*{box-sizing:border-box}" +
        "html,body{margin:0;padding:0;background:#fff;" +
        "-webkit-print-color-adjust:exact;print-color-adjust:exact;" +
        "color-adjust:exact;}" +
        // Default page box → applies to the QUOTATION and (critically) to EVERY
        // continuation page, so multi-page quotes keep top/bottom margins and
        // nothing bleeds to the edge.
        "@page{size:A4;margin:14mm 12mm;}" +
        // The proposal sheets are full-bleed by design (dark cover reaches the
        // page edge), so they get their own named page box with zero margin.
        // If a browser ignores named pages, sheets fall back to the default
        // margin — a white border, never a broken layout.
        (prop.bodyHtml ? "@page dqcover{size:A4;margin:0;}" : "") +
        (prop.bodyHtml ? ".dq-pp .sheet{page:dqcover;}" : "") +
        (prop.bodyHtml ? ".dq-pq{page-break-before:always;break-before:page;}" : "");

      // A visible "Save as PDF" bar guarantees the user can always trigger the
      // print/save dialog even if the auto-print call is blocked. It is hidden
      // when actually printing (@media print).
      var printBarCss =
        ".dq-print-bar{position:fixed;top:0;left:0;right:0;z-index:2147483647;" +
        "display:flex;gap:10px;align-items:center;justify-content:center;" +
        "padding:10px;background:#0a3d62;color:#fff;font:14px/1.3 Arial,sans-serif;" +
        "box-shadow:0 2px 8px rgba(0,0,0,.25)}" +
        ".dq-print-bar button{cursor:pointer;border:0;border-radius:6px;" +
        "padding:8px 16px;font:600 14px Arial,sans-serif;background:#fff;color:#0a3d62}" +
        ".dq-print-bar span{opacity:.9}" +
        "body{padding-top:52px}" +
        "@media print{.dq-print-bar{display:none!important}body{padding-top:0!important}}";

      var html =
        '<!DOCTYPE html><html><head><meta charset="utf-8">' +
        '<title>' + esc(fileBaseName()) + '</title>' +
        '<style>' + (dqCss || "") + '</style>' +
        '<style>' + baseCss + '</style>' +
        '<style>' + printBarCss + '</style>' +
        prop.styleHtml +
        '</head><body>' +
        '<div class="dq-print-bar">' +
        '<button type="button" onclick="window.print()">Save as PDF / Print</button>' +
        '<span>Choose &ldquo;Save as PDF&rdquo; as the destination.</span>' +
        '</div>' +
        (prop.bodyHtml ? '<div class="dq-pp">' + prop.bodyHtml + '</div>' : '') +
        '<div class="dq-pq">' + quoteEl.outerHTML + '</div>' +
        '<scr' + 'ipt>(function(){function p(){try{window.focus();}catch(e){}' +
        'try{window.print();}catch(e){}}' +
        'if(document.readyState==="complete"){setTimeout(p,400);}' +
        'else{window.addEventListener("load",function(){setTimeout(p,400);});}' +
        '})();</scr' + 'ipt>' +
        '</body></html>';

      pw.document.open();
      pw.document.write(html);
      pw.document.close();

      // Parent-side fallback: some browsers ignore the popup's own inline
      // print() call. Trigger it from here too once the popup has rendered.
      setTimeout(function () {
        try { pw.focus(); pw.print(); } catch (e) {}
      }, 900);
    });
  }

  function downloadPdf() {
    var sel = $("dq-proposal-template");
    var templateName = sel ? sel.value : "";
    var btn = $("dq-download-pdf");
    var oldTxt = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.textContent = "Preparing..."; }

    function restore() { if (btn) { btn.disabled = false; btn.textContent = oldTxt; } }

    // 1) Open the print popup so the user gets a SELECTABLE-TEXT PDF via the
    //    browser's "Save as PDF". This MUST run inside the click gesture so the
    //    pop-up is not blocked.
    printDellQuotation(templateName).catch(function (err) {
      console.error("[DQ] print view failed", err);
    });

    // 2) In the background, also save a copy to SharePoint (same flow the
    //    Quotation page uses). Native print cannot produce a file, so this copy
    //    is rendered via the image pipeline — identical content, saved to
    //    Documents/Quotations/.
    saveQuotationToSharePoint(templateName, function (s) { if (btn) btn.textContent = s; })
      .then(function () {
        if (btn) btn.textContent = "Saved ✓";
        setTimeout(restore, 1500);
      })
      .catch(function (err) {
        console.error("[DQ] SharePoint save failed", err);
        // Don't alarm the user — the print/download already happened. Surface
        // a soft notice only.
        if (btn) btn.textContent = "Saved to SharePoint failed";
        setTimeout(restore, 2500);
      });
  }

  // Shared: Blob → base64 string (chunked, ES5-safe).
  function blobToBase64(blob) {
    return blob.arrayBuffer().then(function (buf) {
      var bytes = new Uint8Array(buf);
      var chunk = 0x8000;
      var parts = [];
      for (var i = 0; i < bytes.length; i += chunk) {
        parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + chunk)));
      }
      return btoa(parts.join(""));
    });
  }

  // Render the quotation (+ optional proposal) to a PDF Blob and POST it to the
  // shared QuoteSite-SaveQuotation flow WITHOUT an email — i.e. save-only to
  // SharePoint, exactly like the Quotation page's save. Resolves on success.
  function saveQuotationToSharePoint(templateName, onStatus) {
    var saveUrl = CONFIG.flowUrls && CONFIG.flowUrls.saveQuotation;
    if (!saveUrl || saveUrl.indexOf("PASTE_") === 0) {
      return Promise.reject(new Error("Save flow URL is not configured."));
    }
    if (!window.html2pdf) {
      return Promise.reject(new Error("PDF library not loaded yet."));
    }
    var fileName = fileBaseName() + ".pdf";
    return buildQuotationPdfBlob(templateName, onStatus)
      .then(function (blob) {
        if (onStatus) onStatus("Saving...");
        return blobToBase64(blob);
      })
      .then(function (b64) {
        return fetch(saveUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileName: fileName, fileContent: b64 })
        });
      })
      .then(function (r) {
        if (r.status >= 200 && r.status < 300) return true;
        return r.text().then(function (t) { throw new Error("HTTP " + r.status + ": " + t); });
      });
  }

  /* ------------------ Email PDF via Outlook (Power Automate) ------------------
     Generates the same PDF as Download PDF, then POSTs it (base64-encoded)
     plus recipient/subject/body to the shared QuoteSite-SaveQuotation flow,
     which saves to SharePoint AND sends it as an Office 365 Outlook email
     when `recipientEmail` is supplied. */
  function emailPdf() {
    if (!window.html2pdf) { alert("PDF library not loaded yet. Please retry in a moment."); return; }
    var saveUrl = CONFIG.flowUrls && CONFIG.flowUrls.saveQuotation;
    if (!saveUrl || saveUrl.indexOf("PASTE_") === 0) {
      alert("Save flow URL is not configured for the Dell Quote page. Email cannot be sent.");
      return;
    }
    if (!STATE.quote) { alert("Please upload and parse a Dell quotation first."); return; }

    var c = effectiveCustomer();
    var toEmail = window.prompt("Send Dell quotation to (email):", c.email || "");
    if (toEmail === null) return;
    toEmail = (toEmail || "").trim();
    if (!toEmail || toEmail.indexOf("@") === -1) { alert("A valid recipient email is required."); return; }
    var ccEmail = window.prompt("CC (optional, comma-separated):", "");
    if (ccEmail === null) return;
    ccEmail = (ccEmail || "").trim();

    var sel = $("dq-proposal-template");
    var templateName = sel ? sel.value : "";
    var btn = $("dq-email-pdf");
    var oldTxt = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.textContent = "Preparing..."; }

    var fileName = fileBaseName() + ".pdf";
    var subject  = "Dell Quotation - " + fileBaseName() + " - Smartsoft";
    var bodyHtml =
      "<p>Dear " + esc(c.contact || "Sir/Madam") + ",</p>" +
      "<p>Please find attached our Dell quotation for your kind consideration.</p>" +
      "<p>Should you need any clarifications, feel free to reach out.</p>" +
      "<p>Warm regards,<br/>Smartsoft Team<br/>29 years of trusted IT solutions<br/>sales@smartsoft.co.in</p>";

    function done(ok, err) {
      if (btn) { btn.disabled = false; btn.textContent = oldTxt; }
      if (ok) {
        alert("Quotation emailed to " + toEmail + "." + (ccEmail ? "\nCC: " + ccEmail : ""));
      } else {
        console.error("[DQ] emailPdf failed", err);
        alert("Failed to send email: " + (err && err.message ? err.message : "unknown error"));
      }
    }

    function blobToBase64(blob) {
      return blob.arrayBuffer().then(function (buf) {
        var bytes = new Uint8Array(buf);
        var chunk = 0x8000;
        var parts = [];
        for (var i = 0; i < bytes.length; i += chunk) {
          parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + chunk)));
        }
        return btoa(parts.join(""));
      });
    }

    // Do NOT pre-open the popup. buildQuotationPdfBlob opens it after the
    // template fetch, right before writing (mirrors the Quotation page).
    buildQuotationPdfBlob(templateName, function (s) { if (btn) btn.textContent = s; })
      .then(function (pdfBlob) {
        if (btn) btn.textContent = "Uploading...";
        return blobToBase64(pdfBlob);
      })
      .then(function (b64) {
        if (btn) btn.textContent = "Sending...";
        return fetch(saveUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fileName: fileName,
            fileContent: b64,
            recipientEmail: toEmail,
            recipientName: c.contact || "",
            ccEmail: ccEmail,
            emailSubject: subject,
            emailBody: bodyHtml
          })
        });
      })
      .then(function (r) {
        if (r.status >= 200 && r.status < 300) done(true);
        else r.text().then(function (t) { done(false, new Error("HTTP " + r.status + ": " + t)); });
      })
      .catch(function (err) { done(false, err); });
  }

  function downloadWord() {
    if (!STATE.quote) return;
    var btn = $("dq-download-word");
    var oldTxt = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.textContent = "Preparing..."; }

    ensureImageDataUrl("/smartsoft-header.png").then(function (lhData) {
     ensureImageDataUrl("/smartsoft-signature.png").then(function (sigData) {
      var letter = effectiveLetter();
      var c = effectiveCustomer();
      var clone = buildExportClone();

      // Drop the on-screen-derived export header and the auto footer; this
      // export builds its own letterhead, terms and signature.
      var eh = clone.querySelector(".dq-export-head"); if (eh) eh.parentNode.removeChild(eh);
      var ef = clone.querySelector(".dq-foot"); if (ef) ef.parentNode.removeChild(ef);

      // Strip <thead> from the component tables so Word does NOT repeat the
      // header row on continuation pages (cells stay <th> so they still bold).
      var compTables = clone.querySelectorAll(".dq-comp-table");
      for (var i = 0; i < compTables.length; i++) {
        var t = compTables[i];
        var thead = t.querySelector("thead");
        if (!thead) continue;
        var tbody = t.querySelector("tbody");
        var headRows = thead.querySelectorAll("tr");
        for (var r = headRows.length - 1; r >= 0; r--) {
          if (tbody) tbody.insertBefore(headRows[r], tbody.firstChild);
          else t.insertBefore(headRows[r], thead);
        }
        thead.parentNode.removeChild(thead);
      }

      // Relabel each component section heading to "Item N: <description>".
      var compSections = clone.querySelectorAll(".dq-comp-section");
      for (var j = 0; j < compSections.length; j++) {
        var h3 = compSections[j].querySelector("h3");
        if (h3) {
          var m = /Item\s+\d+:[\s\S]*/.exec(h3.textContent || "");
          if (m) h3.textContent = m[0];
        }
      }
      var itemsTable = clone.querySelector(".dq-items-table");

      // Section 1 = the cover page (page 1) — letterhead + title + recipient +
      // contact. It lives in its own Word section so NO running header shows
      // here (only the big letterhead in the body).
      var sec1 = document.createElement("div");
      sec1.className = "dq-document";
      sec1.innerHTML = dqLetterCoverHtml(letter, c, lhData);
      var section1Inner = sec1.innerHTML;

      // Section 2 = the letter body ONLY (page 2). The running header (logo) applies here.
      // No TECHNICAL DETAILS or terms — those go to section 3.
      var body = document.createElement("div");
      body.innerHTML = dqLetterBodyHtml(letter, c);
      var section2Inner = body.innerHTML;

      // Section 3 = TECHNICAL DETAILS, COMMERCIAL DETAILS, and Terms (page 3+).
      // The running header (logo) continues here.
      var wrap = document.createElement("div");
      wrap.className = "dq-document";

      // TECHNICAL DETAILS header — no page-break class needed; section break handles it.
      var techH = document.createElement("div");
      techH.className = "dq-lt-h";
      techH.textContent = "TECHNICAL DETAILS";
      wrap.appendChild(techH);

      var mm = document.createElement("div");
      mm.className = "dq-lt-mm";
      mm.innerHTML = "<div>Make: " + esc(letter.make) + "</div><div>Model: " + esc(letter.model) + "</div>";
      wrap.appendChild(mm);

      for (var s = 0; s < compSections.length; s++) wrap.appendChild(compSections[s]);

      var commH = document.createElement("div");
      commH.className = "dq-lt-h";
      commH.textContent = "COMMERCIAL DETAILS";
      wrap.appendChild(commH);
      if (itemsTable) wrap.appendChild(itemsTable);

      var terms = document.createElement("div");
      terms.innerHTML = dqTermsHtml(letter, sigData);
      wrap.appendChild(terms);

      var section3Inner = wrap.innerHTML;


      // Inline CSS so Word renders close to the template (Times New Roman).
      var css = ""
        + "body{font:11pt/1.55 'Times New Roman',Times,serif;color:#2b2b2b}"
        + ".dq-document{padding:0}"
        + ".dq-document,.dq-document *{font-family:'Times New Roman',Times,serif}"
        + ".dq-pagebreak{page-break-before:always;break-before:page}"
        + ".dq-lh{margin:0 0 6pt;text-align:center}"
        + ".dq-lh img{width:480pt;height:auto}"
        + ".dq-lt-rule{border-top:1px solid #c9ccd1;height:0;margin:6pt 0 0;font-size:1pt;line-height:1pt;mso-line-height-rule:exactly}"
        + ".dq-lt-gap1{height:130pt;line-height:130pt;font-size:1pt;mso-line-height-rule:exactly}"
        + ".dq-lt-gap2{height:240pt;line-height:240pt;font-size:1pt;mso-line-height-rule:exactly}"
        + ".dq-lt-title{font-size:24pt;font-weight:bold;text-align:center;margin:0}"
        + ".dq-lt-gap{height:34pt;line-height:34pt;font-size:1pt;mso-line-height-rule:exactly}"
        + ".dq-lt-totbl{width:100%;border-collapse:collapse;border:0}"
        + ".dq-lt-totbl td{border:0;padding:0;vertical-align:top}"
        + ".dq-lt-totbl-l{width:48%}"
        + ".dq-lt-totbl-r{width:52%}"
        + ".dq-lt-to{line-height:1.85;margin:0 0 22pt}"
        + ".dq-lt-org{font-weight:bold}"
        + ".dq-lt-contact{line-height:1.7;margin-top:0}"
        + ".dq-lt-clabel{font-size:9pt;color:#8a9099;letter-spacing:.5pt;text-transform:uppercase}"
        + ".dq-lt-cname{font-weight:bold;font-size:12pt}"
        + ".dq-lt-norm{font-weight:normal;font-size:11pt;color:#4b4f55}"
        + ".dq-lt-date{text-align:right;font-style:italic;color:#6b7280;margin:0 0 30pt}"
        + ".dq-lt-sub{font-weight:bold;margin:20pt 0 14pt;font-size:12pt}"
        + ".dq-lt-dear{margin:0 0 14pt}"
        + ".dq-lt-p{margin:14pt 0;line-height:1.85;text-align:justify}"
        + ".dq-lt-closing{margin:16pt 0;line-height:1.7;font-weight:bold}"
        + ".dq-lt-sign{margin-top:26pt;line-height:1.7}"
        + ".dq-lt-sign .dq-lt-org{font-weight:bold}"
        + ".dq-lt-h{font-size:13pt;font-weight:bold;text-transform:uppercase;text-align:left;margin:18pt 0 8pt;color:#2b2b2b}"
        + ".dq-lt-mm{margin:0 0 10pt;line-height:1.5;color:#4b4f55}"
        + ".dq-items-table,.dq-comp-table{border-collapse:collapse;width:100%;margin-bottom:8pt}"
        + ".dq-items-table th,.dq-comp-table th{background:#e9edf2;color:#2b2b2b;text-align:left;text-transform:uppercase;font-size:8.5pt;font-weight:bold;border:1px solid #b8bec6;padding:6pt 8pt}"
        + ".dq-items-table td,.dq-comp-table td{border:1px solid #c2c8cf;padding:5pt 8pt;vertical-align:top;font-size:9.5pt}"
        + ".dq-items-table tfoot td,.dq-items-table .dq-tot td{font-weight:bold}"
        + ".dq-items-table tfoot .dq-tot-label,.dq-items-table .dq-tot .dq-tot-label{text-align:right}"
        + ".dq-items-table .dq-tot-grand td{font-weight:bold;font-size:11.5pt;color:#2b2b2b;border:1px solid #b8bec6}"
        + ".dq-comp-table .dq-comp-group td{background:#eef1f5;color:#4b4f55;font-weight:bold;text-transform:uppercase;font-size:8.5pt}"
        + ".num{text-align:right}"
        + ".dq-comp-section{margin-top:10pt}"
        + ".dq-comp-section h3{font-size:11pt;font-weight:bold;margin:10pt 0 4pt;padding:0;background:none;border:0;color:#2b2b2b}"
        + ".dq-terms{margin-top:14pt}"
        + ".dq-terms-h{font-weight:bold;font-size:13pt;text-transform:uppercase;margin:18pt 0 8pt;color:#2b2b2b}"
        + ".dq-terms-sub{font-weight:bold;margin:10pt 0 3pt}"
        + ".dq-terms-p{margin:2pt 0 2pt 26pt;line-height:1.4;text-align:justify;text-indent:-14pt;color:#4b4f55}"
        + ".dq-lt-closenote{margin:14pt 0 8pt;line-height:1.6;text-align:justify}"
        + ".dq-lt-sign-final{page-break-inside:avoid;break-inside:avoid;margin-top:14pt}"
        + ".dq-lt-sign-final .dq-lt-org{font-weight:bold}"
        + ".dq-sign-img{width:120pt;height:auto;margin:2pt 0}";

      // HEADER MODEL — single Word section + mso-title-page:yes.
      //   * mso-first-header (fh1) = EMPTY → page 1 (cover) shows no logo.
      //   * mso-header (h1) = logo → repeats on EVERY page 2,3,4,5… because the
      //     whole doc is ONE continuous section (a single section's running
      //     header reliably repeats on all continuation/table pages — multi-
      //     section "header inside the div" only painted the first page of each
      //     section, which is why page 4 lost the logo in build 44).
      //   * Header DEFINITION divs go at the very END of <body> (genuine Word
      //     HTML placement); at the top Word ignores the @page linkage.
      // Internal page breaks (pageBreak span) still force the cover, letter and
      // technical blocks onto separate pages without starting new sections.
      var firstHeader = "<div style=\"mso-element:header\" id=\"fh1\"><p class=\"MsoHeader\">\u00a0</p></div>";
      var logoHeader = "<div style=\"mso-element:header\" id=\"h1\"><p class=\"MsoHeader\" style=\"text-align:right;margin:0\">"
        + (lhData ? "<img src=\"" + lhData + "\" width=\"200\" style=\"width:150pt;height:auto\" alt=\"Smartsoft\" />" : "")
        + "</p></div>";
      var pageBreak = "<span style=\"font-size:12.0pt;font-family:'Times New Roman',serif\"><br clear=\"all\" style=\"page-break-before:always\" /></span>";

      var html = ""
        + "<html xmlns:o=\"urn:schemas-microsoft-com:office:office\" xmlns:w=\"urn:schemas-microsoft-com:office:word\" xmlns=\"http://www.w3.org/TR/REC-html40\">"
        + "<head><meta charset=\"utf-8\" /><title>Smartsoft Quotation</title>"
        + "<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>90</w:Zoom><w:DoNotOptimizeForBrowser/></w:WordDocument></xml><![endif]-->"
        + "<style>@page WordSection1{size:8.5in 11.0in;mso-page-orientation:portrait;margin:2.4cm 1.5cm 1.5cm 1.5cm;mso-header-margin:0.6cm;mso-title-page:yes;mso-header:h1;mso-first-header:fh1;} div.WordSection1{page:WordSection1;}"
        + " p.MsoHeader{margin:0;border:none} " + css + "</style>"
        + "</head><body>"
        + "<div class=\"WordSection1\">"
        + "<div class=\"dq-document\">" + section1Inner + "</div>"
        + pageBreak
        + "<div class=\"dq-document\">" + section2Inner + "</div>"
        + pageBreak
        + "<div class=\"dq-document\">" + section3Inner + "</div>"
        + "</div>"
        + "<div style=\"display:none;mso-hide:none\">"
        + firstHeader
        + logoHeader
        + "</div>"
        + "</body></html>";

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
      if (btn) { btn.disabled = false; btn.textContent = oldTxt; }
     });
    });
  }

  /* ------------------------------- wire ------------------------------ */
  /* --- CRM Dynamics 365 Account/Contact Lookup --- */
  function wireCrmPicker() {
    var accountSearch = $("dq-account-search");
    var accountDropdown = $("dq-account-dropdown");
    var contactSearch = $("dq-contact-search");
    var contactDropdown = $("dq-contact-dropdown");
    var useD365Btn = $("dq-use-d365-contact");
    var d365Status = $("dq-d365-status");
    if (!accountSearch || !accountDropdown || !contactSearch || !contactDropdown || !useD365Btn) return;

    var selectedAccountId = null;
    var selectedAccountName = null;
    var selectedAccountAddress = null;
    var selectedContactId = null;
    var selectedContactData = null;

    function crmFetchAccounts(query) {
      var url = CONFIG.flowUrls && CONFIG.flowUrls.getCRMData;
      if (!url || url.indexOf("PASTE_") === 0) { console.warn("[DQ] getCRMData flow URL not configured"); return; }
      accountDropdown.innerHTML = '<div style="padding:8px; color:#888; font-style:italic;">Loading...</div>';
      accountDropdown.style.display = "block";
      fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ search: query, top: 500 }) })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          var accounts = (data.mode === "accounts" && data.accounts) ? data.accounts : [];
          if (!accounts.length) {
            accountDropdown.innerHTML = '<div style="padding:10px; color:#999; font-size:13px;">No accounts found</div>';
          } else {
            accountDropdown.innerHTML = accounts.map(function (acc) {
              return '<div class="dq-dd-item" style="padding:10px 12px; cursor:pointer; border-bottom:1px solid #f0f0f0; font-size:14px;" data-id="' + esc(acc.id) + '" data-name="' + esc(acc.name) + '" data-address="' + esc(acc.address || "") + '">' +
                '<strong>' + esc(acc.name) + '</strong>' +
                (acc.address ? '<br><span style="font-size:12px; color:#666;">' + esc(String(acc.address).trim()) + '</span>' : '') +
                '</div>';
            }).join("");
            accountDropdown.querySelectorAll(".dq-dd-item").forEach(function (el) {
              el.addEventListener("mousedown", function (e) {
                e.preventDefault();
                selectedAccountId = el.getAttribute("data-id");
                selectedAccountName = el.getAttribute("data-name");
                selectedAccountAddress = el.getAttribute("data-address") || "";
                accountSearch.value = selectedAccountName;
                accountDropdown.style.display = "none";
                contactSearch.disabled = false;
                contactSearch.style.background = "";
                contactSearch.placeholder = "Click or type to search contacts in " + selectedAccountName + "...";
                contactSearch.value = "";
                contactDropdown.innerHTML = "";
                selectedContactId = null;
                selectedContactData = null;
                useD365Btn.disabled = true;
                d365Status.textContent = "";
                crmFetchContacts("");
              });
            });
          }
          accountDropdown.style.display = "block";
        })
        .catch(function (err) {
          accountDropdown.innerHTML = '<div style="padding:10px; color:#c00; font-size:13px;">Error loading accounts</div>';
          console.error("[DQ] CRM account search failed", err);
        });
    }

    function crmFetchContacts(query) {
      if (!selectedAccountId) return;
      var url = CONFIG.flowUrls && CONFIG.flowUrls.getCRMData;
      if (!url || url.indexOf("PASTE_") === 0) return;
      contactDropdown.innerHTML = '<div style="padding:8px; color:#888; font-style:italic;">Loading...</div>';
      contactDropdown.style.display = "block";
      fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId: selectedAccountId, search: query, top: 500 }) })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          var contacts = (data.mode === "contacts" && data.contacts) ? data.contacts : [];
          if (!contacts.length) {
            contactDropdown.innerHTML = '<div style="padding:10px; color:#999; font-size:13px;">No contacts found for this account</div>';
          } else {
            contactDropdown.innerHTML = contacts.map(function (con) {
              var fullName = esc(((con.firstName || "") + " " + (con.lastName || "")).trim());
              return '<div class="dq-dd-item" style="padding:10px 12px; cursor:pointer; border-bottom:1px solid #f0f0f0; font-size:14px;" data-id="' + esc(con.contactId) + '" data-contact="' + esc(JSON.stringify(con)) + '">' +
                '<strong>' + fullName + '</strong>' +
                (con.email ? '<br><span style="font-size:12px; color:#666;">✉ ' + esc(con.email) + '</span>' : '') +
                (con.phone ? ' &nbsp;<span style="font-size:12px; color:#666;">📞 ' + esc(con.phone) + '</span>' : '') +
                '</div>';
            }).join("");
            contactDropdown.querySelectorAll(".dq-dd-item").forEach(function (el) {
              el.addEventListener("mousedown", function (e) {
                e.preventDefault();
                selectedContactId = el.getAttribute("data-id");
                selectedContactData = JSON.parse(el.getAttribute("data-contact"));
                contactSearch.value = ((selectedContactData.firstName || "") + " " + (selectedContactData.lastName || "")).trim();
                contactDropdown.style.display = "none";
                useD365Btn.disabled = false;
                d365Status.textContent = "✓ Ready to import";
              });
            });
          }
          contactDropdown.style.display = "block";
        })
        .catch(function (err) {
          contactDropdown.innerHTML = '<div style="padding:10px; color:#c00; font-size:13px;">Error loading contacts</div>';
          console.error("[DQ] CRM contact search failed", err);
        });
    }

    accountSearch.addEventListener("focus", function () { crmFetchAccounts((accountSearch.value || "").trim()); });
    accountSearch.addEventListener("click", function () { crmFetchAccounts((accountSearch.value || "").trim()); });
    accountSearch.addEventListener("input", function () { crmFetchAccounts((accountSearch.value || "").trim()); });

    contactSearch.addEventListener("focus", function () { if (selectedAccountId) crmFetchContacts((contactSearch.value || "").trim()); });
    contactSearch.addEventListener("click", function () { if (selectedAccountId) crmFetchContacts((contactSearch.value || "").trim()); });
    contactSearch.addEventListener("input", function () { if (selectedAccountId) crmFetchContacts((contactSearch.value || "").trim()); });

    useD365Btn.addEventListener("click", function () {
      if (!selectedContactData) return;
      var f = $("dq-customer-form");
      if (f) {
        f.company.value = selectedAccountName || "";
        f.contact.value = ((selectedContactData.firstName || "") + " " + (selectedContactData.lastName || "")).trim();
        f.email.value = selectedContactData.email || "";
        f.phone.value = selectedContactData.phone || "";
        f.address.value = selectedContactData.address || selectedAccountAddress || "";
      }
      applyOverrides();
      d365Status.textContent = "✓ Imported from Dynamics 365";
      console.log("[DQ] CRM contact imported:", selectedContactData);
    });

    document.addEventListener("click", function (e) {
      if (e.target !== accountSearch && e.target !== accountDropdown && !accountDropdown.contains(e.target)) {
        accountDropdown.style.display = "none";
      }
      if (e.target !== contactSearch && e.target !== contactDropdown && !contactDropdown.contains(e.target)) {
        contactDropdown.style.display = "none";
      }
    });

    console.log("[DQ] CRM Dynamics 365 lookup wired");
  }

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
    wireCrmPicker();
    var applyLetterBtn = $("dq-apply-letter");
    if (applyLetterBtn) applyLetterBtn.addEventListener("click", applyLetter);
    $("dq-download-pdf").addEventListener("click", downloadPdf);
    $("dq-download-word").addEventListener("click", downloadWord);
    var emailBtn = $("dq-email-pdf");
    if (emailBtn) emailBtn.addEventListener("click", emailPdf);

    var marginInput = $("dq-margin");
    if (marginInput) {
      marginInput.addEventListener("input", function () {
        var v = parseFloat(marginInput.value);
        STATE.margin = isFinite(v) && v >= 0 ? v : 0;
        if (STATE.quote) renderDocument();
      });
    }

    var discountInput = $("dq-discount");
    var discountMode  = $("dq-discount-mode");
    function applyDiscount() {
      var v = parseFloat(discountInput.value);
      STATE.discount.value = isFinite(v) && v >= 0 ? v : 0;
      STATE.discount.mode  = discountMode.value === "amt" ? "amt" : "pct";
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

    // Editable quantity column: recompute on change/blur to avoid focus loss
    // mid-typing (renderDocument() rebuilds the whole table).
    var doc = $("dq-document");
    if (doc) {
      doc.addEventListener("change", function (e) {
        var t = e.target;
        if (!t || !t.classList || t.classList.contains("dq-qty-input") === false) return;
        if (!STATE.quote || !STATE.quote.items) return;
        var idx = parseInt(t.getAttribute("data-idx"), 10);
        if (isNaN(idx) || idx < 0 || idx >= STATE.quote.items.length) return;
        var v = parseInt(t.value, 10);
        if (isNaN(v) || v < 0) v = STATE.quote.items[idx].qty || 0;
        STATE.quote.items[idx].qty = v;
        renderDocument();
      });
    }

    // Eagerly fetch proposal templates so the dropdown is ready when the user
    // lands on step 2 (also retried on showStep(2) in case it fails first time).
    try { loadProposalTemplates(); } catch (err) { console.error("[DQ] loadProposalTemplates error", err); }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
