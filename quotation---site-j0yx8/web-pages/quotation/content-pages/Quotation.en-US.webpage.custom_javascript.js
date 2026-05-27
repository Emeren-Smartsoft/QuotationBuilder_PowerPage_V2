(function () {
  "use strict";
  console.log("[QT] script loaded build=2026-05-dell-pricelist-v1");

  var GST_RATE = 0.18;
  function fmt(n) { return "\u20B9 " + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

  /* --- Config --- */
  var CONFIG = { flowUrls: {}, defaultMargin: 10 };
  try {
    var raw = document.getElementById("productData");
    if (raw) CONFIG = JSON.parse(raw.textContent);
  } catch (e) { console.error("Failed to parse productData config", e); }
  if (window.QT_PRODUCTS) CONFIG = window.QT_PRODUCTS;

  function $(id) { return document.getElementById(id); }
  var step1      = $("qt-step-1");
  var step2      = $("qt-step-2");
  var stepDots   = document.querySelectorAll(".qt-step");
  var form       = $("qt-customer-form");
  var summary    = $("qt-customer-summary");
  var catSel     = $("qt-category");
  var segSel     = $("qt-segment");
  var loadingEl  = $("qt-loading");
  var panel      = $("qt-products-panel");
  var ctxLabel   = $("qt-panel-context");
  var listEl     = $("qt-products-list");
  var searchEl   = $("qt-search");
  var addBtn     = $("qt-add-selected");
  var tbody      = $("qt-table-body");
  var grandEl    = $("qt-grand-total");
  var backBtn    = $("qt-back");
  var printBtn   = $("qt-print");
  var saveBtn    = $("qt-save");
  var emailBtn   = $("qt-email");
  var clSel      = $("qt-covering-letter");

  if (!form) return;

  var customer = {};
  var cart = [];
  var currentProductsCache = [];
  var allProductsForCategory = [];
  var lastLoadedCategory = "";
  var isLoadingProducts = false;

  /* --- Load categories from Power Automate flow --- */
  var FALLBACK_CATEGORIES = ["Softwares", "CheckPoint", "CrowdStrike", "Microsoft Defender", "Paloalto"];

  function loadCategories() {
    var url = CONFIG.flowUrls.getCategories;
    if (!url || url.indexOf("PASTE_") === 0) {
      catSel.innerHTML = '<option value="">-- Select Category --</option>';
      FALLBACK_CATEGORIES.forEach(function (cat) {
        var o = document.createElement("option");
        o.value = cat; o.textContent = cat;
        catSel.appendChild(o);
      });
      return;
    }
    catSel.innerHTML = '<option value="">-- Loading... --</option>';
    fetch(url, { method: "GET" })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        catSel.innerHTML = '<option value="">-- Select Category --</option>';
        (data.categories || []).forEach(function (cat) {
          var o = document.createElement("option");
          o.value = cat; o.textContent = cat;
          catSel.appendChild(o);
        });
      })
      .catch(function (err) {
        console.error("Failed to load categories", err);
        catSel.innerHTML = '<option value="">-- Error loading --</option>';
      });
  }

  /* --- Load proposal templates --- */
  var proposalTemplatesLoaded = false;
  function loadCoveringLetters() {
    if (!clSel || proposalTemplatesLoaded) return;
    var url = CONFIG.flowUrls.getProposalTemplates;
    if (!url || url.indexOf("PASTE_") === 0) {
      clSel.innerHTML = '<option value="">-- None (quotation only) --</option>';
      return;
    }
    proposalTemplatesLoaded = true;
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templateName: "" })
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        clSel.innerHTML = '<option value="">-- None (quotation only) --</option>';
        (data.templates || []).forEach(function (t) {
          var o = document.createElement("option");
          o.value = t.name;
          o.textContent = t.displayName || t.name;
          clSel.appendChild(o);
        });
      })
      .catch(function (err) {
        console.error("Failed to load proposal templates", err);
        proposalTemplatesLoaded = false;
      });
  }

  /* --- Fetch a single proposal template's HTML --- */
  function fetchCoveringLetterHtml(templateName) {
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
          console.error("Failed to fetch proposal template", err);
          resolve("");
        });
    });
  }

  /* --- Replace placeholders in covering letter HTML --- */
  function fillCoveringLetter(html, ctx) {
    if (!html) return "";
    return html
      .replace(/\{\{COMPANY\}\}/g,     escapeHtml(ctx.company || ""))
      .replace(/\{\{CONTACT\}\}/g,     escapeHtml(ctx.contact || ""))
      .replace(/\{\{ADDRESS\}\}/g,     escapeHtml(ctx.address || ""))
      .replace(/\{\{EMAIL\}\}/g,       escapeHtml(ctx.email   || ""))
      .replace(/\{\{PHONE\}\}/g,       escapeHtml(ctx.phone   || ""))
      .replace(/\{\{DATE\}\}/g,        escapeHtml(ctx.date    || ""))
      .replace(/\{\{QUOTE_ID\}\}/g,    escapeHtml(ctx.quoteId || ""))
      .replace(/\{\{VALID_UNTIL\}\}/g, escapeHtml(ctx.validUntil || ""));
  }

  /* --- Load products from Power Automate flow --- */
  function loadProducts(category, segment) {
    var url = CONFIG.flowUrls.getProducts;
    if (!url || url.indexOf("PASTE_") === 0) {
      console.warn("Power Automate flow URL for getProducts not configured.");
      listEl.innerHTML = '<div style="padding:14px;color:#c00;">Flow URL not configured. Set up Power Automate flows.</div>';
      panel.classList.remove("qt-hidden");
      return;
    }

    // If same category already loaded, just filter client-side
    if (category === lastLoadedCategory && allProductsForCategory.length > 0) {
      applySegmentFilter(segment);
      return;
    }

    loadingEl.classList.remove("qt-hidden");
    panel.classList.add("qt-hidden");
    isLoadingProducts = true;

    // Always fetch ALL products for category (no segment filter) - filter client-side
    var body = { category: category };

    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        allProductsForCategory = (data.products || []).map(function (p, idx) {
          var rawSku = p.ProductId || p.sku || "";
          return {
            uid: "row" + idx + "::" + rawSku,
            sku: rawSku,
            description: p.SkuTitle || p.description || "",
            dtp: Number(p.DTP || p.dtp || 0),
            erp: Number(p.ERP || p.erp || 0),
            segment: p.Segment || p.segment || "",
            productTitle: p.ProductTitle || p.productTitle || ""
          };
        });
        lastLoadedCategory = category;
        isLoadingProducts = false;
        // Use current segment dropdown value (user may have changed it while loading)
        applySegmentFilter(segSel.value || "");
        loadingEl.classList.add("qt-hidden");
        panel.classList.remove("qt-hidden");
      })
      .catch(function (err) {
        console.error("Failed to load products", err);
        isLoadingProducts = false;
        loadingEl.classList.add("qt-hidden");
        listEl.innerHTML = '<div style="padding:14px;color:#c00;">Failed to load products. Please try again.</div>';
        panel.classList.remove("qt-hidden");
      });
  }

  function applySegmentFilter(segment) {
    if (segment) {
      currentProductsCache = allProductsForCategory.filter(function (p) {
        return p.segment.toLowerCase() === segment.toLowerCase();
      });
    } else {
      currentProductsCache = allProductsForCategory.slice();
    }
    renderProductList();
  }

  /* --- Step navigation --- */
  function setStep(n) {
    step1.classList.toggle("qt-hidden", n !== 1);
    step2.classList.toggle("qt-hidden", n !== 2);
    stepDots.forEach(function (el) { el.classList.toggle("active", Number(el.dataset.step) <= n); });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    console.log("[QT] Continue clicked, reportValidity=", form.reportValidity());
    if (!form.reportValidity()) return;
    var fd = new FormData(form);
    customer = Object.fromEntries(fd.entries());
    console.log("[QT] customer", customer);
    try { renderCustomerSummary(); } catch (err) { console.error("[QT] renderCustomerSummary error", err); }
    try { setStep(2); } catch (err) { console.error("[QT] setStep error", err); }
    try { loadCategories(); } catch (err) { console.error("[QT] loadCategories error", err); }
    try { loadCoveringLetters(); } catch (err) { console.error("[QT] loadCoveringLetters error", err); }
  });

  backBtn.addEventListener("click", function () { setStep(1); });

  function generateQuoteId() {
    var now = new Date();
    var yy = String(now.getFullYear()).slice(-2);
    var mm = String(now.getMonth()+1).padStart(2,'0');
    var dd = String(now.getDate()).padStart(2,'0');
    var rand = String(Math.floor(Math.random() * 9000) + 1000);
    return 'QT-' + yy + mm + dd + '-' + rand;
  }

  var quoteId = generateQuoteId();

  function renderCustomerSummary() {
    var today = new Date();
    var dateStr = customer.quoteDate || (today.getFullYear() + '-' + String(today.getMonth()+1).padStart(2,'0') + '-' + String(today.getDate()).padStart(2,'0'));
    // Valid until: use user-supplied value if present, else date + 15 days
    var validStr;
    if (customer.validUntil) {
      validStr = customer.validUntil;
    } else {
      var validDate = new Date(dateStr);
      validDate.setDate(validDate.getDate() + 15);
      validStr = validDate.getFullYear() + '-' + String(validDate.getMonth()+1).padStart(2,'0') + '-' + String(validDate.getDate()).padStart(2,'0');
    }

    summary.innerHTML =
      '<div class="qt-cs-title">QUOTATION</div>' +
      '<div class="qt-cs-two-col">' +
        '<div class="qt-cs-left">' +
          '<div class="qt-cs-row"><span class="qt-cs-l" style="font-weight:600;color:#555;">To,</span></div>' +
          '<div class="qt-cs-row"><span class="qt-cs-v qt-cs-name">' + escapeHtml(customer.contact || '') + '</span></div>' +
          '<div class="qt-cs-row"><span class="qt-cs-v">' + escapeHtml(customer.company || '') + '</span></div>' +
          (customer.address ? '<div class="qt-cs-row"><span class="qt-cs-v">' + escapeHtml(customer.address) + '</span></div>' : '') +
          (customer.email ? '<div class="qt-cs-row"><span class="qt-cs-v">' + escapeHtml(customer.email) + '</span></div>' : '') +
          (customer.phone ? '<div class="qt-cs-row"><span class="qt-cs-v">' + escapeHtml(customer.phone) + '</span></div>' : '') +
        '</div>' +
        '<div class="qt-cs-right" style="text-align:right;">' +
          '<div class="qt-cs-row" style="justify-content:flex-end;"><span class="qt-cs-l">Quotation No:</span><span class="qt-cs-v">#' + quoteId + '</span></div>' +
          '<div class="qt-cs-row" style="justify-content:flex-end;"><span class="qt-cs-l">Date:</span><span class="qt-cs-v">' + escapeHtml(dateStr) + '</span></div>' +
          '<div class="qt-cs-row" style="justify-content:flex-end;"><span class="qt-cs-l">Valid Until:</span><span class="qt-cs-v">' + escapeHtml(validStr) + '</span></div>' +
        '</div>' +
      '</div>';
  }

  /* --- Category change --- */
  catSel.addEventListener("change", function () {
    var ok = !!catSel.value;
    segSel.disabled = !ok;
    if (ok) {
      lastLoadedCategory = ""; // force reload for new category
      allProductsForCategory = [];
      loadProducts(catSel.value, segSel.value || "");
    } else {
      panel.classList.add("qt-hidden");
      currentProductsCache = [];
      allProductsForCategory = [];
    }
  });

  /* --- Segment filter change (instant client-side filter) --- */
  segSel.addEventListener("change", function () {
    if (!catSel.value) return;
    if (isLoadingProducts) return; // will apply when load completes
    applySegmentFilter(segSel.value || "");
  });

  /* --- Search filter --- */
  searchEl.addEventListener("input", renderProductList);

  /* --- Render product list --- */
  function renderProductList() {
    var q = (searchEl.value || "").trim().toLowerCase();
    var items = currentProductsCache.filter(function (p) {
      return !q || (p.description || "").toLowerCase().indexOf(q) !== -1 ||
             (p.sku || "").toLowerCase().indexOf(q) !== -1 ||
             (p.productTitle || "").toLowerCase().indexOf(q) !== -1;
    });

    var catName = catSel.value || "";
    var segName = segSel.value || "All";
    ctxLabel.textContent = "(" + catName + " > " + segName + " - " + items.length + " products)";

    listEl.innerHTML = items.map(function (p) {
      var details = [];
      if (p.segment) details.push(p.segment);
      if (p.licenseType) details.push(p.licenseType);
      var detailStr = details.length ? ' <small class="qt-prod-detail">[' + escapeHtml(details.join(' | ')) + ']</small>' : '';
      return '<label class="qt-prod-item">' +
             '<input type="checkbox" value="' + escapeAttr(p.uid) + '" />' +
             '<span class="qt-prod-desc">' + escapeHtml(p.description || p.productTitle || '') + detailStr + '</span>' +
             '<span class="qt-prod-price">DTP: ' + fmt(p.dtp) + '</span>' +
             '</label>';
    }).join("") || '<div style="padding:14px;color:#888;">No products match.</div>';

    listEl.querySelectorAll("input[type=checkbox]").forEach(function (cb) {
      cb.addEventListener("change", function () {
        addBtn.disabled = !listEl.querySelector("input[type=checkbox]:checked");
      });
    });
    addBtn.disabled = true;
  }

  /* --- Add selected products to cart --- */
  addBtn.addEventListener("click", function () {
    var selected = Array.prototype.slice.call(listEl.querySelectorAll("input[type=checkbox]:checked")).map(function (c) { return c.value; });
    selected.forEach(function (uid) {
      if (cart.some(function (x) { return x.uid === uid; })) return;
      var p = currentProductsCache.find(function (x) { return x.uid === uid; });
      if (p) {
        var desc = p.description || p.productTitle || "";
        var details = [];
        if (p.segment) details.push(p.segment);
        if (p.licenseType) details.push(p.licenseType);
        if (details.length) desc += " [" + details.join(" | ") + "]";

        cart.push({
          uid: p.uid,
          sku: p.sku,
          description: desc,
          dtp: Number(p.dtp || 0),
          margin: CONFIG.defaultMargin || 10,
          qty: 1
        });
      }
    });
    renderTable();
    listEl.querySelectorAll("input[type=checkbox]").forEach(function (c) { c.checked = false; });
    addBtn.disabled = true;
  });

  /* --- Render quotation table --- */
  function renderTable() {
    if (cart.length === 0) {
      tbody.innerHTML = '<tr class="qt-empty"><td colspan="9">No products added yet. Use the selector above.</td></tr>';
      grandEl.textContent = fmt(0);
      return;
    }
    var grand = 0;
    tbody.innerHTML = cart.map(function (it, idx) {
      var custPrice = Math.round(it.dtp * (1 + it.margin / 100) * 100) / 100;
      var gst = custPrice * GST_RATE;
      var custPriceIncl = custPrice + gst;
      var total = custPriceIncl * it.qty;
      grand += total;
      return '<tr data-idx="' + idx + '">' +
             '<td>' + (idx + 1) + '</td>' +
             '<td>' + escapeHtml(it.description) + '</td>' +
             '<td class="num qt-col-hide-print">' + fmt(it.dtp) + '</td>' +
             '<td class="num qt-col-hide-print"><span class="qt-margin-print">' + it.margin + '%</span><input type="number" min="0" step="0.5" value="' + it.margin + '" class="qt-margin" style="width:60px;" /></td>' +
             '<td class="num">' + fmt(custPrice) + '</td>' +
             '<td class="num"><span class="qt-qty-print">' + it.qty + '</span><input type="number" min="1" step="1" value="' + it.qty + '" class="qt-qty" /></td>' +
             '<td class="num">' + fmt(gst) + '</td>' +
             '<td class="num">' + fmt(custPriceIncl) + '</td>' +
             '<td class="num">' + fmt(total) + ' <button class="qt-remove" title="Remove">&times;</button></td>' +
             '</tr>';
    }).join("");
    grandEl.textContent = fmt(grand);

    tbody.querySelectorAll("input.qt-margin").forEach(function (inp) {
      inp.addEventListener("input", function (e) {
        var tr = e.target.closest("tr");
        var idx = Number(tr.dataset.idx);
        cart[idx].margin = Math.max(0, parseFloat(e.target.value) || 0);
        renderTable();
      });
    });
    tbody.querySelectorAll("input.qt-qty").forEach(function (inp) {
      inp.addEventListener("input", function (e) {
        var tr = e.target.closest("tr");
        var idx = Number(tr.dataset.idx);
        var v = Math.max(1, parseInt(e.target.value, 10) || 1);
        cart[idx].qty = v;
        renderTable();
      });
    });
    tbody.querySelectorAll(".qt-remove").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        var idx = Number(e.target.closest("tr").dataset.idx);
        cart.splice(idx, 1);
        renderTable();
      });
    });
  }

  /* Expose a small API so other modules (e.g. server quotation) can push line
     items into the shared cart and reuse the print / email / save pipeline. */
  window.QT_API = {
    hasSku: function (sku) {
      for (var i = 0; i < cart.length; i++) if (cart[i].sku === sku) return true;
      return false;
    },
    addItem: function (item) {
      if (!item || !item.sku) return;
      if (this.hasSku(item.sku)) return;
      cart.push({
        uid: item.uid || item.sku,
        sku: item.sku,
        description: item.description || "",
        dtp: Number(item.dtp || 0),
        margin: item.margin == null ? (CONFIG.defaultMargin || 0) : Number(item.margin),
        qty: item.qty == null ? 1 : Number(item.qty)
      });
      renderTable();
    },
    removeBySku: function (sku) {
      for (var i = cart.length - 1; i >= 0; i--) if (cart[i].sku === sku) cart.splice(i, 1);
      renderTable();
    },
    clear: function () { cart.length = 0; renderTable(); },
    render: renderTable
  };

  /* --- Print --- */
  printBtn.addEventListener("click", function () {
    var selectedCl = clSel ? clSel.value : "";
    if (!selectedCl) {
      window.print();
      return;
    }
    printBtn.disabled = true;
    var origText = printBtn.textContent;
    printBtn.textContent = "Preparing...";
    fetchCoveringLetterHtml(selectedCl).then(function (clHtmlRaw) {
      openPrintPopup(clHtmlRaw);
      printBtn.disabled = false;
      printBtn.textContent = origText;
    });
  });

  function openPrintPopup(clHtmlRaw) {
    var pdfQuoteId = document.querySelector(".qt-customer-summary") ?
      (document.querySelector(".qt-customer-summary").textContent.match(/QT-\d+-\d+/) || ["Quotation"])[0] : "Quotation";
    var logoImg = document.querySelector(".qt-brand-logo");
    var logoSrc = logoImg ? logoImg.src : "";
    var today = new Date();
    var dateStr = customer.quoteDate || (today.getFullYear() + '-' + String(today.getMonth()+1).padStart(2,'0') + '-' + String(today.getDate()).padStart(2,'0'));
    var validDate = new Date(dateStr);
    validDate.setDate(validDate.getDate() + 15);
    var validStr = validDate.getFullYear() + '-' + String(validDate.getMonth()+1).padStart(2,'0') + '-' + String(validDate.getDate()).padStart(2,'0');

    var clHtml = fillCoveringLetter(clHtmlRaw, {
      company: customer.company, contact: customer.contact, address: customer.address,
      email: customer.email, phone: customer.phone,
      date: dateStr, quoteId: '#' + pdfQuoteId, validUntil: validStr
    });

    var tableRows = "";
    var grand = 0;
    cart.forEach(function (it, idx) {
      var custPrice = Math.round(it.dtp * (1 + it.margin / 100) * 100) / 100;
      var gst = custPrice * GST_RATE;
      var custPriceIncl = custPrice + gst;
      var total = custPriceIncl * it.qty;
      grand += total;
      var bg = (idx % 2 === 0) ? '#ffffff' : '#f7f9fb';
      tableRows +=
        '<tr style="background:' + bg + ';">' +
        '<td class="sl">' + (idx + 1) + '</td>' +
        '<td class="desc">' + escapeHtml(it.description) + '</td>' +
        '<td class="num">' + fmt(custPrice) + '</td>' +
        '<td class="sl">' + it.qty + '</td>' +
        '<td class="num">' + fmt(gst) + '</td>' +
        '<td class="num">' + fmt(custPriceIncl) + '</td>' +
        '<td class="num">' + fmt(total) + '</td>' +
        '</tr>';
    });

    var pw = window.open('', '_blank', 'width=850,height=1100');
    if (!pw) { alert("Please allow popups for printing."); return; }
    var d = pw.document;

    var quotationBlock =
      '<div class="brand"><img src="' + escapeAttr(logoSrc) + '" /></div>' +
      '<div class="title">QUOTATION</div>' +
      '<div class="cs-box">' +
        '<div class="cs-left">' +
          '<div class="cs-row" style="margin-bottom:2px;"><span class="cs-label" style="color:#555;">To,</span></div>' +
          '<div class="cs-name">' + escapeHtml(customer.contact || '') + '</div>' +
          '<div class="cs-row"><span class="cs-val">' + escapeHtml(customer.company || '') + '</span></div>' +
          (customer.address ? '<div class="cs-row"><span class="cs-val">' + escapeHtml(customer.address) + '</span></div>' : '') +
          (customer.email ? '<div class="cs-row"><span class="cs-val">' + escapeHtml(customer.email) + '</span></div>' : '') +
          (customer.phone ? '<div class="cs-row"><span class="cs-val">' + escapeHtml(customer.phone) + '</span></div>' : '') +
        '</div>' +
        '<div class="cs-right" style="text-align:right;">' +
          '<div class="cs-row" style="justify-content:flex-end;"><span class="cs-label">Quotation No:</span><span class="cs-val">#' + escapeHtml(pdfQuoteId) + '</span></div>' +
          '<div class="cs-row" style="justify-content:flex-end;"><span class="cs-label">Date:</span><span class="cs-val">' + escapeHtml(dateStr) + '</span></div>' +
          '<div class="cs-row" style="justify-content:flex-end;"><span class="cs-label">Valid Until:</span><span class="cs-val">' + escapeHtml(validStr) + '</span></div>' +
        '</div>' +
      '</div>' +
      '<table><thead><tr>' +
        '<th style="width:5%;">SL<br>No.</th>' +
        '<th style="width:40%;">Product Description</th>' +
        '<th style="width:11%;">Unit Price<br>(\u20B9)</th>' +
        '<th style="width:4%;">Qty.</th>' +
        '<th style="width:11%;">GST<br>(18%)</th>' +
        '<th style="width:15%;">Unit Price<br>Including<br>GST (\u20B9)</th>' +
        '<th style="width:15%;">Total<br>Price<br>(\u20B9)</th>' +
      '</tr></thead><tbody>' + tableRows + '</tbody>' +
      '<tfoot><tr>' +
        '<td colspan="6" class="grand-label">Grand Total (\u20B9)</td>' +
        '<td class="grand-value">' + fmt(grand) + '</td>' +
      '</tr></tfoot></table>' +
      '<div class="footer">' +
        '<p><strong>Terms &amp; Conditions:</strong> Prices are valid for 15 days from the date of this quotation. All prices are in INR. GST @18% is applicable as shown. Payment terms: 100% advance. Delivery as per product availability.</p>' +
        '<p style="margin-top:8px;">This is a system-generated quotation from <strong>Smartsoft</strong>.</p>' +
      '</div>';

    var bodyContent;
    if (clHtml && clHtml.indexOf('<!-- QUOTATION_HERE -->') !== -1) {
      bodyContent = clHtml.replace('<!-- QUOTATION_HERE -->',
        '<div style="page-break-before:always;"></div>' + quotationBlock + '<div style="page-break-after:always;"></div>');
    } else {
      bodyContent = clHtml + (clHtml ? '<div style="page-break-before:always;"></div>' : '') + quotationBlock;
    }

    d.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Quotation ' + escapeHtml(pdfQuoteId) + '</title>' +
      '<style>' +
      '* { margin:0; padding:0; box-sizing:border-box; }' +
      'body { font-family: Segoe UI, system-ui, -apple-system, sans-serif; color:#222; background:#fff; padding:20px; }' +
      '.brand img { height:72px; }' +
      '.title { font-size:22px; font-weight:700; color:#1a2533; margin:16px 0 14px; text-align:center; letter-spacing:.02em; }' +
      '.cs-box { border-top:2px solid #1a2533; border-bottom:1px solid #ddd; padding:14px 0; margin-bottom:18px; display:flex; justify-content:space-between; }' +
      '.cs-left, .cs-right { display:flex; flex-direction:column; gap:4px; }' +
      '.cs-row { font-size:11.5px; line-height:1.6; }' +
      '.cs-label { color:#333; font-weight:600; margin-right:8px; }' +
      '.cs-val { color:#1a2533; font-weight:500; }' +
      '.cs-name { font-size:12.5px; font-weight:700; color:#1a2533; }' +
      'table { width:100%; border-collapse:collapse; border:1px solid #e3e6ea; margin-top:4px; }' +
      'th { border:1px solid #e3e6ea; padding:9px 6px; text-align:center; background:#5a7a8a; color:#fff; font-weight:600; font-size:10px; }' +
      'td { border:1px solid #e3e6ea; padding:7px 6px; font-size:11px; }' +
      'td.sl { text-align:center; }' +
      'td.desc { text-align:left; }' +
      'td.num { text-align:right; white-space:nowrap; }' +
      'tfoot td { background:#f0f2f5; font-weight:700; }' +
      '.grand-label { text-align:right; font-size:10px; font-weight:700; }' +
      '.grand-value { color:#0b5cab; font-size:11px; font-weight:800; text-align:right; }' +
      '.footer { margin-top:18px; padding-top:10px; border-top:1px solid #bbb; font-size:11px; color:#555; line-height:1.5; }' +
      '@page { size: A4; margin: 12mm; }' +
      '</style></head><body>' +
      bodyContent +
      '<script>window.onload = function(){ setTimeout(function(){ window.print(); }, 400); };<\/script>' +
      '</body></html>');
    d.close();
  }

  /* --- Save (Generate PDF & Upload to SharePoint) --- */
  saveBtn.addEventListener("click", function () {
    if (cart.length === 0) { alert("Please add at least one product."); return; }

    var saveUrl = CONFIG.flowUrls.saveQuotation;
    if (!saveUrl || saveUrl.indexOf("PASTE_") === 0) {
      alert("Save flow URL not configured. Please update the saveQuotation URL in the page config.");
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = "Preparing...";

    var selectedCl = clSel ? clSel.value : "";
    fetchCoveringLetterHtml(selectedCl).then(function (clHtmlRaw) {
      saveBtn.textContent = "Generating PDF...";
      buildAndSavePdf(clHtmlRaw);
    });
  });

  function buildAndSavePdf(clHtmlRaw) {
    var saveUrl = CONFIG.flowUrls.saveQuotation;
    /* Gather data */
    var pdfQuoteId = document.querySelector(".qt-customer-summary") ?
      (document.querySelector(".qt-customer-summary").textContent.match(/QT-\d+-\d+/) || ["Quotation"])[0] : "Quotation";
    var companyName = (customer.company || "Customer").replace(/[^a-zA-Z0-9]/g, "_");
    var fileName = pdfQuoteId + "_" + companyName + ".pdf";

    var logoImg = document.querySelector(".qt-brand-logo");
    var logoSrc = logoImg ? logoImg.src : "";

    var today = new Date();
    var dateStr = customer.quoteDate || (today.getFullYear() + '-' + String(today.getMonth()+1).padStart(2,'0') + '-' + String(today.getDate()).padStart(2,'0'));
    var validDate = new Date(dateStr);
    validDate.setDate(validDate.getDate() + 15);
    var validStr = validDate.getFullYear() + '-' + String(validDate.getMonth()+1).padStart(2,'0') + '-' + String(validDate.getDate()).padStart(2,'0');

    /* Build covering letter HTML (if selected) - replace placeholders */
    var clHtml = fillCoveringLetter(clHtmlRaw, {
      company: customer.company, contact: customer.contact, address: customer.address,
      email: customer.email, phone: customer.phone,
      date: dateStr, quoteId: '#' + pdfQuoteId, validUntil: validStr
    });
    var clPageBreak = clHtml ? '<div style="page-break-after:always; height:0;"></div>' : '';

    /* Build table rows */
    var tableRows = "";
    var grand = 0;
    cart.forEach(function (it, idx) {
      var custPrice = Math.round(it.dtp * (1 + it.margin / 100) * 100) / 100;
      var gst = custPrice * GST_RATE;
      var custPriceIncl = custPrice + gst;
      var total = custPriceIncl * it.qty;
      grand += total;
      var bg = (idx % 2 === 0) ? '#ffffff' : '#f7f9fb';
      tableRows +=
        '<tr style="background:' + bg + ';">' +
        '<td class="sl">' + (idx + 1) + '</td>' +
        '<td class="desc">' + escapeHtml(it.description) + '</td>' +
        '<td class="num">' + fmt(custPrice) + '</td>' +
        '<td class="sl">' + it.qty + '</td>' +
        '<td class="num">' + fmt(gst) + '</td>' +
        '<td class="num">' + fmt(custPriceIncl) + '</td>' +
        '<td class="num">' + fmt(total) + '</td>' +
        '</tr>';
    });

    /* Open a new window with the quotation content - completely isolated from portal CSS */
    var pdfWin = window.open('', '_blank', 'width=1120,height=1100');
    if (!pdfWin) {
      alert("Please allow popups for this site to save the quotation.");
      saveBtn.disabled = false;
      saveBtn.textContent = "Save Quotation";
      return;
    }

    var pdfDoc = pdfWin.document;

    /* If user clicked Email, attach recipient fields to the Save POST so the flow emails the PDF. */
    var emailFields = window._pendingEmailFields || null;
    window._pendingEmailFields = null;
    var emailFieldsJson = emailFields ? JSON.stringify(emailFields) : 'null';

    /* Build the quotation block once so it can be injected into a proposal template marker
       OR prepended after the proposal pages as a fallback.
       NOTE: Inline styles are used so the block renders correctly inside ANY proposal template
       (templates have their own CSS that we don't want to fight). */
    var qtTblStyle = 'width:100%;table-layout:fixed;border-collapse:collapse;border:1px solid #bbb;margin-top:6px;font-family:Segoe UI,system-ui,sans-serif;';
    var qtThStyle  = 'border:1px solid #bbb;padding:9px 6px;text-align:center;background:#5a7a8a;color:#fff;font-weight:600;font-size:15px;line-height:1.25;';
    var qtTdBase   = 'border:1px solid #bbb;padding:8px 9px;font-size:15px;line-height:1.4;vertical-align:middle;font-family:Segoe UI,system-ui,sans-serif;color:#222;';
    var qtRows = '';
    cart.forEach(function (it, idx) {
      var custPrice = Math.round(it.dtp * (1 + it.margin / 100) * 100) / 100;
      var gst = custPrice * GST_RATE;
      var custPriceIncl = custPrice + gst;
      var total = custPriceIncl * it.qty;
      var bg = (idx % 2 === 0) ? '#ffffff' : '#f7f9fb';
      qtRows +=
        '<tr style="background:' + bg + ';">' +
        '<td style="' + qtTdBase + 'text-align:center;">' + (idx + 1) + '</td>' +
        '<td style="' + qtTdBase + 'text-align:left;word-wrap:break-word;">' + escapeHtml(it.description) + '</td>' +
        '<td style="' + qtTdBase + 'text-align:right;white-space:nowrap;">' + fmt(custPrice) + '</td>' +
        '<td style="' + qtTdBase + 'text-align:center;">' + it.qty + '</td>' +
        '<td style="' + qtTdBase + 'text-align:right;white-space:nowrap;">' + fmt(gst) + '</td>' +
        '<td style="' + qtTdBase + 'text-align:right;white-space:nowrap;">' + fmt(custPriceIncl) + '</td>' +
        '<td style="' + qtTdBase + 'text-align:right;white-space:nowrap;">' + fmt(total) + '</td>' +
        '</tr>';
    });

    var quotationBlock =
      '<div class="qt-pdf-block" style="font-family:Segoe UI,system-ui,sans-serif;color:#222;padding:12px 36px;background:#fff;box-sizing:border-box;">' +
        (logoSrc ? '<div style="text-align:left;margin-bottom:10px;"><img src="' + escapeAttr(logoSrc) + '" crossorigin="anonymous" style="height:76px;width:auto;" /></div>' : '') +
        '<div style="font-size:30px;font-weight:700;color:#1a2533;margin:12px 0 14px;text-align:center;letter-spacing:.03em;">QUOTATION</div>' +
        '<div style="border-top:1.5px solid #1a2533;border-bottom:1px solid #ddd;padding:12px 0;margin-bottom:14px;display:flex;justify-content:space-between;font-family:Segoe UI,system-ui,sans-serif;">' +
          '<div style="display:flex;flex-direction:column;gap:3px;">' +
            '<div style="font-size:15px;color:#555;font-weight:600;">To,</div>' +
            '<div style="font-size:18px;font-weight:700;color:#1a2533;line-height:1.4;">' + escapeHtml(customer.contact || '') + '</div>' +
            '<div style="font-size:15px;color:#1a2533;line-height:1.4;">' + escapeHtml(customer.company || '') + '</div>' +
            (customer.address ? '<div style="font-size:15px;color:#1a2533;line-height:1.4;">' + escapeHtml(customer.address) + '</div>' : '') +
            (customer.email ? '<div style="font-size:15px;color:#1a2533;line-height:1.4;">' + escapeHtml(customer.email) + '</div>' : '') +
            (customer.phone ? '<div style="font-size:15px;color:#1a2533;line-height:1.4;">' + escapeHtml(customer.phone) + '</div>' : '') +
          '</div>' +
          '<div style="display:flex;flex-direction:column;gap:3px;text-align:right;">' +
            '<div style="font-size:15px;line-height:1.4;"><span style="color:#333;font-weight:600;margin-right:6px;">Quotation No:</span><span style="color:#1a2533;font-weight:500;">#' + escapeHtml(pdfQuoteId) + '</span></div>' +
            '<div style="font-size:15px;line-height:1.4;"><span style="color:#333;font-weight:600;margin-right:6px;">Date:</span><span style="color:#1a2533;font-weight:500;">' + escapeHtml(dateStr) + '</span></div>' +
            '<div style="font-size:15px;line-height:1.4;"><span style="color:#333;font-weight:600;margin-right:6px;">Valid Until:</span><span style="color:#1a2533;font-weight:500;">' + escapeHtml(validStr) + '</span></div>' +
          '</div>' +
        '</div>' +
        '<table style="' + qtTblStyle + '"><thead><tr>' +
          '<th style="' + qtThStyle + 'width:5%;">SL<br>No.</th>' +
          '<th style="' + qtThStyle + 'width:28%;">Product Description</th>' +
          '<th style="' + qtThStyle + 'width:13%;">Unit Price<br>(\u20B9)</th>' +
          '<th style="' + qtThStyle + 'width:6%;">Qty.</th>' +
          '<th style="' + qtThStyle + 'width:13%;">GST<br>(18%)</th>' +
          '<th style="' + qtThStyle + 'width:18%;">Unit Price<br>Including GST (\u20B9)</th>' +
          '<th style="' + qtThStyle + 'width:17%;">Total<br>Price (\u20B9)</th>' +
        '</tr></thead><tbody>' + qtRows + '</tbody>' +
        '<tfoot><tr>' +
          '<td colspan="6" style="' + qtTdBase + 'text-align:right;background:#f0f2f5;font-weight:700;color:#1a2533;font-size:17px;">Grand Total (\u20B9)</td>' +
          '<td style="' + qtTdBase + 'text-align:right;background:#f0f2f5;color:#0b5cab;font-size:18px;font-weight:800;white-space:nowrap;">' + fmt(grand) + '</td>' +
        '</tr></tfoot></table>' +
        '<div style="margin-top:16px;padding-top:10px;border-top:1px solid #bbb;font-size:14px;color:#555;line-height:1.5;font-family:Segoe UI,system-ui,sans-serif;">' +
          '<p style="margin:0;"><strong>Terms &amp; Conditions:</strong> Prices are valid for 15 days from the date of this quotation. All prices are in INR. GST @18% is applicable as shown. Payment terms: 100% advance. Delivery as per product availability.</p>' +
          '<p style="margin:8px 0 0;">This is a system-generated quotation from <strong>Smartsoft</strong>.</p>' +
        '</div>' +
      '</div>';

    /* --- Build the popup that renders proposal + quotation as TWO separate PDFs,
           then merges them with pdf-lib into a single attachment. This avoids the CSS /
           page-break conflicts you get when both documents share one html2canvas pass. --- */
    var html2pdfLib = '<script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.2/html2pdf.bundle.min.js"><\/script>';
    var pdfLibLib   = '<script src="https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js"><\/script>';
    var statusDivHtml =
      '<div id="pdf-status" data-html2canvas-ignore="true" ' +
      'style="position:fixed;top:0;left:0;right:0;z-index:9999;background:#fff;border-bottom:1px solid #ddd;padding:14px;text-align:center;font:14px Segoe UI,system-ui,sans-serif;color:#666;">' +
      'Preparing PDF...</div>';

    /* Extract proposal template's <style>/<link> tags and <body> contents so we can inject them
       into the popup as a normal container (not a whole document). This lets the proposal keep
       its native CSS while still being rendered side-by-side with the quotation container. */
    var proposalHeadStyles = '';
    var proposalBodyHtml = '';
    if (clHtml) {
      var cleanedCl = clHtml
        .replace(/\bpage-break\b/g, '')
        .replace(/page-break-before\s*:\s*[^;"']+;?/gi, '')
        .replace(/page-break-after\s*:\s*[^;"']+;?/gi, '')
        .replace(/break-before\s*:\s*page;?/gi, '')
        .replace(/break-after\s*:\s*page;?/gi, '');
      var styleMatches = cleanedCl.match(/<style[\s\S]*?<\/style>/gi) || [];
      var linkMatches  = cleanedCl.match(/<link[^>]*rel=["']?stylesheet["']?[^>]*>/gi) || [];
      proposalHeadStyles = styleMatches.join('') + linkMatches.join('');
      var bodyMatch = cleanedCl.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
      proposalBodyHtml = bodyMatch ? bodyMatch[1] : cleanedCl;
    }

    /* Override CSS applied AFTER the proposal's own styles so we win on conflicting rules.
       Scope width/page rules to #proposal-root so the quotation container is untouched. */
    var overrideCss = '<style>' +
      '.toolbar{display:none !important;}' +
      'html,body{margin:0 !important;padding:0 !important;background:#fff !important;}' +
      '#proposal-root,#quotation-root{width:1080px !important;margin:0 auto !important;background:#fff !important;}' +
      '#proposal-root .page{width:1080px !important;max-width:1080px !important;box-shadow:none !important;margin:0 !important;}' +
      /* Re-assert horizontal grids regardless of viewport width */
      '#proposal-root .cover .meta-grid{display:grid !important;grid-template-columns:repeat(4,1fr) !important;}' +
      '#proposal-root .about-strip{display:grid !important;grid-template-columns:repeat(4,1fr) !important;}' +
      '#proposal-root .plans-grid{display:grid !important;grid-template-columns:repeat(3,1fr) !important;}' +
      '#proposal-root .tiers{display:grid !important;grid-template-columns:repeat(3,1fr) !important;}' +
      '#proposal-root .services{display:grid !important;grid-template-columns:1fr 1fr !important;}' +
      '#proposal-root .steps{display:grid !important;grid-template-columns:repeat(5,1fr) !important;}' +
      '#proposal-root .accept-grid{display:grid !important;grid-template-columns:1fr 1fr !important;}' +
      '#proposal-root .doc-footer{display:grid !important;grid-template-columns:1fr 1fr 1fr !important;}' +
      /* Keep cards and headings intact across page boundaries */
      '#proposal-root .service-card,#proposal-root .plan-card,#proposal-root .tier,#proposal-root .notes,#proposal-root .accept-grid,#proposal-root .steps,#proposal-root .about-strip{page-break-inside:avoid !important;break-inside:avoid !important;}' +
      '#proposal-root h1,#proposal-root h2,#proposal-root h3,#proposal-root h4{page-break-after:avoid !important;break-after:avoid !important;}' +
      '</style>';

    var hasProposalJs = proposalBodyHtml ? 'true' : 'false';
    var saveUrlEsc    = saveUrl.replace(/"/g, '\\"');
    var fileNameEsc   = fileName.replace(/"/g, '\\"');

    var bootstrapScript =
      '<script>' +
      '(function(){' +
      'function run(){' +
        'var status = document.getElementById("pdf-status");' +
        'var proposalEl  = document.getElementById("proposal-root");' +
        'var quotationEl = document.getElementById("quotation-root");' +
        'var hasProposal = ' + hasProposalJs + ';' +
        'var commonH2C = { scale: 2, useCORS: true, allowTaint: true, logging: false, backgroundColor: "#ffffff", windowWidth: 1080, width: 1080, scrollY: 0, scrollX: 0 };' +
        'var pagebreakAvoid = ["tr","thead","tfoot",".notes",".about-strip",".accept-grid",".steps",".service-card",".plan-card",".tier",".tiers",".plans-grid",".services",".section-eyebrow",".section-title","h1","h2","h3","h4"];' +
        'var proposalOpt = { margin:[0,0,0,0], image:{type:"jpeg",quality:0.92}, html2canvas:commonH2C, jsPDF:{unit:"mm",format:"a4",orientation:"portrait",compress:true}, pagebreak:{mode:["css","legacy"],avoid:pagebreakAvoid} };' +
        'var qtOpt = { margin:[10,10,10,10], image:{type:"jpeg",quality:0.95}, html2canvas:commonH2C, jsPDF:{unit:"mm",format:"legal",orientation:"portrait",compress:true}, pagebreak:{mode:["css","legacy"],avoid:["tr","thead","tfoot"]} };' +

        'function blobToBase64(blob){' +
          'return blob.arrayBuffer().then(function(buf){' +
            'var bytes = new Uint8Array(buf);' +
            'var chunk = 0x8000; var parts = [];' +
            'for (var i = 0; i < bytes.length; i += chunk) {' +
              'parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + chunk)));' +
            '}' +
            'return btoa(parts.join(""));' +
          '});' +
        '}' +

        'function mergePdfs(blobs){' +
          'if (!window.PDFLib) return Promise.reject(new Error("pdf-lib failed to load"));' +
          'return PDFLib.PDFDocument.create().then(function(merged){' +
            'function addOne(i){' +
              'if (i >= blobs.length) return merged.saveAsBase64();' +
              'return blobs[i].arrayBuffer().then(function(buf){' +
                'return PDFLib.PDFDocument.load(new Uint8Array(buf));' +
              '}).then(function(src){' +
                'return merged.copyPages(src, src.getPageIndices());' +
              '}).then(function(pages){' +
                'pages.forEach(function(p){ merged.addPage(p); });' +
                'return addOne(i + 1);' +
              '});' +
            '}' +
            'return addOne(0);' +
          '});' +
        '}' +

        'function upload(base64){' +
          'status.textContent = "Uploading to SharePoint...";' +
          'return new Promise(function(resolve, reject){' +
            'var xhr = new XMLHttpRequest();' +
            'xhr.open("POST", "' + saveUrlEsc + '", true);' +
            'xhr.setRequestHeader("Content-Type", "application/json");' +
            'xhr.onreadystatechange = function(){' +
              'if (xhr.readyState !== 4) return;' +
              'if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.responseText);' +
              'else reject(new Error(xhr.responseText || ("HTTP " + xhr.status)));' +
            '};' +
            'var body = { fileName: "' + fileNameEsc + '", fileContent: base64 };' +
            'var ef = ' + emailFieldsJson + ';' +
            'if (ef) { body.recipientEmail = ef.recipientEmail || ""; body.recipientName = ef.recipientName || ""; body.ccEmail = ef.ccEmail || ""; body.emailSubject = ef.emailSubject || ""; body.emailBody = ef.emailBody || ""; }' +
            'xhr.send(JSON.stringify(body));' +
          '});' +
        '}' +

        'var pipeline;' +
        'if (hasProposal) {' +
          'status.textContent = "Rendering proposal (1/2)...";' +
          'pipeline = html2pdf().set(proposalOpt).from(proposalEl).outputPdf("blob").then(function(propBlob){' +
            'proposalEl.style.display = "none";' +
            'quotationEl.style.display = "block";' +
            'status.textContent = "Rendering quotation (2/2)...";' +
            'return html2pdf().set(qtOpt).from(quotationEl).outputPdf("blob").then(function(qtBlob){' +
              'return mergePdfs([propBlob, qtBlob]);' +
            '});' +
          '});' +
        '} else {' +
          'status.textContent = "Rendering quotation...";' +
          'pipeline = html2pdf().set(qtOpt).from(quotationEl).outputPdf("blob").then(blobToBase64);' +
        '}' +

        'pipeline.then(upload).then(function(){' +
          'status.innerHTML = "<strong style=\\"color:green\\">\\u2713 Quotation saved successfully!</strong> File: ' + fileName.replace(/'/g, "\\'").replace(/"/g, '\\"') + '. You can close this window.";' +
          'window.opener && window.opener.postMessage({qtSaved: true}, "*");' +
        '}).catch(function(err){' +
          'console.error("[QT-PDF] failed", err);' +
          'status.innerHTML = "<strong style=\\"color:red\\">Failed:</strong> " + (err && err.message ? err.message : String(err));' +
          'window.opener && window.opener.postMessage({qtSaved: false}, "*");' +
        '});' +
      '}' +
      'function start(){ setTimeout(run, 500); }' +
      'if (document.readyState === "complete") start();' +
      'else window.addEventListener("load", start);' +
      '})();' +
      '<\/script>';

    /* Initial display: if there's a proposal, hide the quotation container until proposal is rendered;
       otherwise show only the quotation container. */
    var initialQuotationDisplay = proposalBodyHtml ? 'none' : 'block';
    var initialProposalDisplay  = proposalBodyHtml ? 'block' : 'none';

    var headHtml =
      '<meta charset="utf-8">' +
      '<title>Generating ' + escapeHtml(pdfQuoteId) + '</title>' +
      /* Proposal styles first, then our overrides so we win on conflicts. */
      proposalHeadStyles +
      overrideCss +
      html2pdfLib +
      pdfLibLib;

    var bodyHtml =
      statusDivHtml +
      '<div id="proposal-root" style="display:' + initialProposalDisplay + ';">' + proposalBodyHtml + '</div>' +
      '<div id="quotation-root" style="display:' + initialQuotationDisplay + ';">' + quotationBlock + '</div>' +
      bootstrapScript;

    pdfDoc.write(
      '<!DOCTYPE html><html><head>' + headHtml + '</head>' +
      '<body style="margin:0;padding:0;background:#fff;">' + bodyHtml + '</body></html>'
    );
    pdfDoc.close();

    /* Listen for result from popup */
    var msgHandler = function(e) {
      if (e.data && typeof e.data.qtSaved !== 'undefined') {
        window.removeEventListener("message", msgHandler);
        saveBtn.disabled = false;
        saveBtn.textContent = "Save Quotation";
        var emailedTo = window._lastEmailedTo;
        window._lastEmailedTo = null;
        if (e.data.qtSaved) {
          if (emailedTo) {
            alert("Quotation saved to SharePoint and emailed to " + emailedTo + ".\nFile: " + fileName);
          } else {
            alert("Quotation saved to SharePoint successfully!\nFile: " + fileName);
          }
        }
      }
    };
    window.addEventListener("message", msgHandler);

    /* Fallback: re-enable button after 30s if no response */
    setTimeout(function () {
      saveBtn.disabled = false;
      saveBtn.textContent = "Save Quotation";
    }, 30000);
  }

  /* --- Email (saves to SharePoint + emails PDF as attachment via Flow 3) ---
     Asks user to confirm/edit To and CC, then triggers the Save flow with extra fields
     so Power Automate also sends the PDF via Office 365 Outlook. */
  if (emailBtn) {
    emailBtn.addEventListener("click", function () {
      if (cart.length === 0) { alert("Please add at least one product."); return; }
      var saveUrl = CONFIG.flowUrls.saveQuotation;
      if (!saveUrl || saveUrl.indexOf("PASTE_") === 0) {
        alert("Save flow URL not configured. Cannot email without saving.");
        return;
      }
      var toEmail = window.prompt("Send quotation to (email):", customer.email || "");
      if (toEmail === null) return; // cancelled
      toEmail = (toEmail || "").trim();
      if (!toEmail || toEmail.indexOf("@") === -1) { alert("A valid recipient email is required."); return; }
      var ccEmail = window.prompt("CC (optional, comma-separated):", "");
      if (ccEmail === null) return;
      ccEmail = (ccEmail || "").trim();

      var pdfQuoteId = document.querySelector(".qt-customer-summary") ?
        (document.querySelector(".qt-customer-summary").textContent.match(/QT-\d+-\d+/) || ["Quotation"])[0] : "Quotation";
      var subject = "Proposal & Quotation - " + pdfQuoteId + " - Smartsoft";
      var bodyHtml =
        "<p>Dear " + escapeHtml(customer.contact || "Sir/Madam") + ",</p>" +
        "<p>Please find attached our proposal and quotation (Ref: <b>" + escapeHtml(pdfQuoteId) + "</b>) for your kind consideration.</p>" +
        "<p>Should you need any clarifications, feel free to reach out.</p>" +
        "<p>Warm regards,<br/>Smartsoft Team<br/>29 years of trusted IT solutions<br/>sales@smartsoft.co.in</p>";

      window._pendingEmailFields = {
        recipientEmail: toEmail,
        recipientName: customer.contact || "",
        ccEmail: ccEmail,
        emailSubject: subject,
        emailBody: bodyHtml
      };
      window._lastEmailedTo = toEmail;
      // Reuse the existing Save flow â€” popup will POST with the email fields included.
      saveBtn.click();
    });
  }

  /* --- Utility --- */
  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function escapeAttr(s) { return escapeHtml(s); }

  /* =====================================================================
     Hardware Quotation module (Workstation / Server / Storage / Laptop)
     - Tab toggle between "software" (existing) and "workstation" (hardware) modes.
     - Single flow QuoteSite-GetWorkstationData reads SharePoint folder
         Documents/MOQ Prices/
       which contains one .xlsx per (brand x product x month), e.g.
         "HP Desktop Workstation June 2025.xlsx"
         "Dell PowerEdge Server May 2026.xlsx"
         "Lenovo ThinkPad Laptop April 2026.xlsx"
       Each file has a named Table1; column schemas vary per product type.
     - Flow contract:
         POST {}                       -> { lists: ["HP Desktop Workstation June 2025", ...] }
         POST {list: "HP Desktop ..."} -> { skus: [ {<row>}, {<row>}, ... ] }
     - The renderer is COLUMN-AGNOSTIC: it picks a price column from a known
       set (FTP / Price / DTP / ERP / MOQ) and shows every other non-empty
       cell as a labelled spec. So a laptop file with columns
       (SKU, Screen, Battery, Weight, Price) just works without code changes.
     - Reuses the SAME cart, renderTable, PDF/email pipeline.
     ===================================================================== */
  (function () {
    var modeBtnSw  = $("qt-mode-software");
    var modeBtnWs  = $("qt-mode-workstation");
    var modeBtnSv  = $("qt-mode-server");
    var modeBtnDl  = $("qt-mode-dell");
    var builderSw  = $("qt-builder-software");
    var builderWs  = $("qt-builder-workstation");
    var builderSv  = $("qt-builder-server");
    var builderDl  = $("qt-builder-dell");
    var sharedArea = $("qt-shared-area");
    var wsModelSel = $("qt-ws-model");
    var wsModelFilterSel = $("qt-ws-modelfilter");
    var wsModelFilterRow = $("qt-ws-modelfilter-row");
    var wsLoading  = $("qt-ws-loading");
    var wsPanel    = $("qt-ws-panel");
    var wsCtx      = $("qt-ws-context");
    var wsList     = $("qt-ws-list");
    var wsSearch   = $("qt-ws-search");
    var wsAdd      = $("qt-ws-add");
    var wsEmpty    = $("qt-ws-empty");

    if (!modeBtnSw || !modeBtnWs || !builderWs) return;

    /* Columns we treat specially. Everything else becomes a labelled spec row. */
    var PRICE_KEYS = ["FTP", "Price", "DTP", "ERP", "MOQ"];
    var SKU_KEYS   = ["SKU", "Sku", "ProductId", "ProductCode", "PartNumber", "Part No", "PartNo"];
    var MODEL_KEYS = ["Model", "ModelFamily", "Family", "Series", "TableName", "_table"];
    var META_KEYS  = ["Plant", "Brand"]; // shown as small badges
    /* Keys that Power Automate / Excel sometimes adds and we want to hide. */
    var HIDDEN_KEYS = ["__PowerAppsId__", "ItemInternalId"];

    var wsListsLoaded   = false;
    var wsAllSkus       = [];      // SKUs for the currently selected price list
    var wsSkuCache      = {};      // { "<listName>": [ {sku objects} ] }  â€” instant on revisit
    var wsCurrentList   = "";
    var wsCurrentModel  = "";      // selected model filter ("" = none picked yet)
    var wsLoadingSkus   = false;

    function setMode(mode) {
      var isWs = (mode === "workstation");
      var isSv = (mode === "server");
      var isDl = (mode === "dell");
      var isSw = !isWs && !isSv && !isDl;
      builderSw.classList.toggle("qt-hidden", !isSw);
      builderWs.classList.toggle("qt-hidden", !isWs);
      if (builderSv) {
        builderSv.classList.toggle("qt-hidden", !isSv);
        builderSv.style.display = isSv ? "block" : "";
      }
      if (builderDl) builderDl.classList.toggle("qt-hidden", !isDl);
      /* qt-shared-area (quotation items table + proposal template + actions)
         is reused by ALL modes â€” keep it visible. */
      if (sharedArea) sharedArea.style.display = "";
      console.log("[QT] setMode", mode, "builderSv=", builderSv, "hasHidden=", builderSv && builderSv.classList.contains("qt-hidden"));

      modeBtnSw.classList.toggle("qt-mode-active", isSw);
      modeBtnWs.classList.toggle("qt-mode-active", isWs);
      if (modeBtnSv) modeBtnSv.classList.toggle("qt-mode-active", isSv);
      if (modeBtnDl) modeBtnDl.classList.toggle("qt-mode-active", isDl);
      modeBtnSw.setAttribute("aria-selected", isSw ? "true" : "false");
      modeBtnWs.setAttribute("aria-selected", isWs ? "true" : "false");
      if (modeBtnSv) modeBtnSv.setAttribute("aria-selected", isSv ? "true" : "false");
      if (modeBtnDl) modeBtnDl.setAttribute("aria-selected", isDl ? "true" : "false");
      function paint(btn, on) {
        if (!btn) return;
        btn.style.background = on ? "#0b5cab" : "transparent";
        btn.style.color      = on ? "#fff"    : "#1a2533";
      }
      paint(modeBtnSw, isSw);
      paint(modeBtnWs, isWs);
      paint(modeBtnSv, isSv);
      paint(modeBtnDl, isDl);

      if (isWs && !wsListsLoaded) loadPriceLists();
      if (isSv && window.QT_SERVER && !window.QT_SERVER.inited) window.QT_SERVER.init();
      if (isDl && window.QT_DELL && !window.QT_DELL.inited) window.QT_DELL.init();
    }
    modeBtnSw.addEventListener("click", function () { setMode("software"); });
    modeBtnWs.addEventListener("click", function () { setMode("workstation"); });
    if (modeBtnSv) modeBtnSv.addEventListener("click", function () { setMode("server"); });
    if (modeBtnDl) modeBtnDl.addEventListener("click", function () { setMode("dell"); });

    function pickFirst(row, keys) {
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        if (row[k] != null && String(row[k]).trim() !== "") return row[k];
      }
      return "";
    }
    function pickPrice(row) {
      for (var i = 0; i < PRICE_KEYS.length; i++) {
        var raw = row[PRICE_KEYS[i]];
        if (raw == null) continue;
        // Strip currency symbols, commas, spaces, etc. â€” keep digits, dot, minus.
        var cleaned = String(raw).replace(/[^0-9.\-]/g, "");
        if (!cleaned) continue;
        var v = Number(cleaned);
        if (v && !isNaN(v)) return v;
      }
      return 0;
    }
    function extraSpecs(row) {
      /* Everything that isn't SKU / price / meta / model / hidden, in original order. */
      var skip = {};
      [].concat(PRICE_KEYS, SKU_KEYS, MODEL_KEYS, META_KEYS, HIDDEN_KEYS).forEach(function (k) { skip[k] = true; });
      var out = [];
      for (var k in row) {
        if (!row.hasOwnProperty(k)) continue;
        if (skip[k]) continue;
        var v = row[k];
        if (v == null || String(v).trim() === "" || String(v).trim() === "-") continue;
        out.push({ label: k, value: String(v) });
      }
      return out;
    }

    function prettifyModel(name) {
      /* Excel table names can't contain spaces â€” convert underscores back. */
      return String(name || "").replace(/_/g, " ").trim();
    }

    function loadPriceLists() {
      var url = CONFIG.flowUrls.getWorkstationData;
      if (!url || url.indexOf("PASTE_") === 0) {
        wsModelSel.innerHTML = '<option value="">-- Flow not configured --</option>';
        wsEmpty.innerHTML = '<span style="color:#c00;">QuoteSite-GetWorkstationData flow URL is not configured. See PowerAutomate-Flow-Steps.md \u2192 Flow 5.</span>';
        return;
      }
      wsModelSel.innerHTML = '<option value="">-- Loading price lists... --</option>';
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          wsListsLoaded = true;
          /* Accept either { lists: [...] } (new) or { models: [...] } (legacy) for backwards compat. */
          var lists = data.lists || data.models || [];
          wsModelSel.innerHTML = '<option value="">-- Select Price List --</option>';
          lists.forEach(function (name) {
            var o = document.createElement("option");
            o.value = name; o.textContent = name;
            wsModelSel.appendChild(o);
          });
          if (!lists.length) {
            wsEmpty.textContent = "No price lists found. Add .xlsx files under SharePoint Documents/MOQ Prices/.";
          }
        })
        .catch(function (err) {
          console.error("[QT-HW] Failed to load price lists", err);
          wsModelSel.innerHTML = '<option value="">-- Error loading --</option>';
          wsEmpty.innerHTML = '<span style="color:#c00;">Failed to load price lists. Check the flow.</span>';
        });
    }

    function loadSkus(listName) {
      var url = CONFIG.flowUrls.getWorkstationData;
      if (!url || url.indexOf("PASTE_") === 0) return;

      // Cache hit â€” skip the network entirely.
      if (wsSkuCache[listName]) {
        wsAllSkus = wsSkuCache[listName];
        populateModelFilter();
        return;
      }

      wsLoadingSkus = true;
      wsLoading.classList.remove("qt-hidden");
      wsPanel.classList.add("qt-hidden");
      wsEmpty.style.display = "none";

      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        /* Send both keys so the flow can use whichever it expects. */
        body: JSON.stringify({ list: listName, model: listName })
      })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          var rows = data.skus || data.rows || [];
          /* Flow may return nested arrays (one per Excel table) when its outer
             Apply-to-each runs in concurrent mode. Flatten one level if so. */
          if (rows.length && Array.isArray(rows[0])) {
            rows = [].concat.apply([], rows);
          }
          wsAllSkus = rows.map(function (row, idx) {
            var sku   = pickFirst(row, SKU_KEYS);
            var price = pickPrice(row);
            var model = prettifyModel(pickFirst(row, MODEL_KEYS));
            return {
              uid:    "hw::" + listName + "::" + idx + "::" + sku,
              list:   listName,
              model:  model,
              sku:    String(sku || ""),
              plant:  String(row.Plant || ""),
              brand:  String(row.Brand || ""),
              price:  price,
              specs:  extraSpecs(row),
              raw:    row
            };
          });
          wsSkuCache[listName] = wsAllSkus;     // cache for the rest of the session
          wsLoadingSkus = false;
          wsLoading.classList.add("qt-hidden");
          populateModelFilter();
        })
        .catch(function (err) {
          console.error("[QT-HW] Failed to load SKUs", err);
          wsLoadingSkus = false;
          wsLoading.classList.add("qt-hidden");
          wsList.innerHTML = '<div style="padding:14px;color:#c00;">Failed to load SKUs. Please try again.</div>';
          wsPanel.classList.remove("qt-hidden");
        });
    }

    wsModelSel.addEventListener("change", function () {
      wsCurrentList = wsModelSel.value || "";
      wsCurrentModel = "";
      if (wsModelFilterRow) wsModelFilterRow.classList.add("qt-hidden");
      if (wsModelFilterSel) wsModelFilterSel.innerHTML = '<option value="">-- Select Model --</option>';
      if (!wsCurrentList) {
        wsPanel.classList.add("qt-hidden");
        wsEmpty.style.display = "";
        wsAllSkus = [];
        return;
      }
      loadSkus(wsCurrentList);
    });

    if (wsModelFilterSel) {
      wsModelFilterSel.addEventListener("change", function () {
        wsCurrentModel = wsModelFilterSel.value || "";
        if (!wsCurrentModel) {
          wsPanel.classList.add("qt-hidden");
          wsEmpty.style.display = "";
          wsEmpty.textContent = "Choose a model above to view available SKUs.";
          return;
        }
        wsEmpty.style.display = "none";
        wsPanel.classList.remove("qt-hidden");
        renderWsList();
      });
    }

    function populateModelFilter() {
      var seen = {};
      var models = [];
      wsAllSkus.forEach(function (s) {
        var m = s.model || "";
        if (m && !seen[m]) { seen[m] = true; models.push(m); }
      });
      models.sort();

      if (!wsModelFilterSel) {
        // No filter dropdown in DOM â€” fall back to showing all SKUs grouped.
        wsPanel.classList.remove("qt-hidden");
        renderWsList();
        return;
      }

      wsModelFilterSel.innerHTML = '<option value="">-- Select Model --</option>';
      models.forEach(function (m) {
        var o = document.createElement("option");
        o.value = m; o.textContent = m;
        wsModelFilterSel.appendChild(o);
      });
      wsModelFilterRow.classList.remove("qt-hidden");

      if (!models.length) {
        wsEmpty.style.display = "";
        wsEmpty.textContent = "This price list has no models. Check that the Excel file has named tables.";
        wsPanel.classList.add("qt-hidden");
      } else if (models.length === 1) {
        // Auto-pick the only model.
        wsModelFilterSel.value = models[0];
        wsCurrentModel = models[0];
        wsEmpty.style.display = "none";
        wsPanel.classList.remove("qt-hidden");
        renderWsList();
      } else {
        wsEmpty.style.display = "";
        wsEmpty.textContent = "Choose a model above to view available SKUs.";
        wsPanel.classList.add("qt-hidden");
      }
    }

    if (wsSearch) wsSearch.addEventListener("input", renderWsList);

    function renderWsList() {
      var q = (wsSearch && wsSearch.value || "").trim().toLowerCase();
      var items = wsAllSkus.filter(function (s) {
        if (wsCurrentModel && s.model !== wsCurrentModel) return false;
        if (!q) return true;
        var blob = s.sku + " " + s.plant + " " + s.brand + " " + s.model + " " + s.specs.map(function (sp) { return sp.value; }).join(" ");
        return blob.toLowerCase().indexOf(q) !== -1;
      });

      /* Count distinct models in the filtered set to decide whether to group. */
      var modelOrder = [];
      var byModel = {};
      items.forEach(function (s) {
        var m = s.model || "";
        if (!byModel[m]) { byModel[m] = []; modelOrder.push(m); }
        byModel[m].push(s);
      });
      var showGroups = modelOrder.length > 1 || (modelOrder.length === 1 && modelOrder[0] !== "");

      wsCtx.textContent = "(" + wsCurrentList + " - " + items.length + " SKUs" +
        (modelOrder.length > 1 ? ", " + modelOrder.length + " models" : "") + ")";

      function cardHtml(s) {
        var specsHtml = s.specs.map(function (sp) {
          return '<span><b>' + escapeHtml(sp.label) + ':</b>' + escapeHtml(sp.value) + '</span>';
        }).join("");
        return '<label class="qt-ws-card">' +
          '<input type="checkbox" value="' + escapeAttr(s.uid) + '" />' +
          '<div class="qt-ws-body">' +
            '<div class="qt-ws-head">' +
              '<span class="qt-ws-sku">' + escapeHtml(s.sku || "(no SKU)") + '</span>' +
              (s.brand ? '<span class="qt-ws-plant">' + escapeHtml(s.brand) + '</span>' : '') +
              (s.plant ? '<span class="qt-ws-plant">' + escapeHtml(s.plant) + '</span>' : '') +
              '<span class="qt-ws-price">' + fmt(s.price) + '</span>' +
            '</div>' +
            (specsHtml ? '<div class="qt-ws-specs">' + specsHtml + '</div>' : '') +
          '</div>' +
        '</label>';
      }

      if (!items.length) {
        wsList.innerHTML = '<div style="padding:14px;color:#888;">No SKUs match.</div>';
      } else if (showGroups) {
        wsList.innerHTML = modelOrder.map(function (m) {
          var label = m || "(unspecified model)";
          var header = '<div class="qt-ws-section">' + escapeHtml(label) +
            ' <span class="qt-ws-section-count">' + byModel[m].length + '</span></div>';
          return header + byModel[m].map(cardHtml).join("");
        }).join("");
      } else {
        wsList.innerHTML = items.map(cardHtml).join("");
      }

      wsList.querySelectorAll("input[type=checkbox]").forEach(function (cb) {
        cb.addEventListener("change", function () {
          wsAdd.disabled = !wsList.querySelector("input[type=checkbox]:checked");
        });
      });
      wsAdd.disabled = true;
    }

    function buildDescription(s) {
      /* "<model> - SKU <sku> | <Label>: <value> | ..."; falls back to <list> if no model. */
      var bits = [];
      var head = (s.model || s.list) + (s.sku ? " - SKU " + s.sku : "");
      bits.push(head);
      if (s.brand) bits.push("Brand: " + s.brand);
      if (s.plant) bits.push("Plant: " + s.plant);
      s.specs.forEach(function (sp) { bits.push(sp.label + ": " + sp.value); });
      return bits.join(" | ");
    }

    wsAdd.addEventListener("click", function () {
      var selected = Array.prototype.slice.call(wsList.querySelectorAll("input[type=checkbox]:checked")).map(function (c) { return c.value; });
      selected.forEach(function (uid) {
        if (cart.some(function (x) { return x.uid === uid; })) return;
        var s = wsAllSkus.find(function (x) { return x.uid === uid; });
        if (!s) return;
        cart.push({
          uid: s.uid,
          sku: s.sku,
          description: buildDescription(s),
          dtp: Number(s.price || 0),
          margin: CONFIG.defaultMargin || 10,
          qty: 1
        });
      });
      renderTable();
      wsList.querySelectorAll("input[type=checkbox]").forEach(function (c) { c.checked = false; });
      wsAdd.disabled = true;
    });
  })();
})();

/* ========================================================================
   Server Quotation mode â€” embedded inline as third tab in this page.
   Self-contained IIFE; exposes window.QT_SERVER.init() which is called by
   setMode("server") the first time the Server tab is activated.
   ======================================================================== */
(function () {
  "use strict";
  var BUILD = "qt-server-inline-4";
  console.log("[" + BUILD + "] module loaded; sq-data present?", !!document.getElementById("sq-data"), "qt-builder-server present?", !!document.getElementById("qt-builder-server"));
  var DATA = null, OPTIONS = {}, BASES = [], COMPAT = {};
  var selectedBasePartNo = null;
  var lineItems = [];
  var addedOptionSkus = {};

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
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function uniqSorted(arr) {
    var s = {}, out = [];
    for (var i = 0; i < arr.length; i++) if (arr[i] && !s[arr[i]]) { s[arr[i]] = 1; out.push(arr[i]); }
    return out.sort();
  }
  function findBase(pn) {
    for (var i = 0; i < BASES.length; i++) if (BASES[i].partNo === pn) return BASES[i];
    return null;
  }

  function setupBasePicker() {
    var fGen = $("sq-f-gen"), fFf = $("sq-f-ff"), fFam = $("sq-f-family"), fS = $("sq-f-search");
    if (!fGen) return;
    var ffOpts = uniqSorted(BASES.map(function (b) { return b.formFactor; }));
    for (var i = 0; i < ffOpts.length; i++) fFf.appendChild(el("option", { value: ffOpts[i] }, [ffOpts[i]]));
    var famOpts = uniqSorted(BASES.map(function (b) { return b.family; }));
    for (var j = 0; j < famOpts.length; j++) fFam.appendChild(el("option", { value: famOpts[j] }, [famOpts[j]]));
    [fGen, fFf, fFam, fS].forEach(function (e) { e.addEventListener("input", renderBaseList); });
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
        el("div", null, [
          el("div", { class: "sq-bp-fam" }, [b.family + " (" + b.generation + ")"]),
          el("div", null, [b.partNo])
        ]),
        el("div", null, [
          el("div", null, [b.processor + (b.ghz ? " @ " + b.ghz : "")]),
          el("div", { style: "color:#666;font-size:11.5px" }, [
            [b.formFactor, b.memory, b.hdd, b.warranty].filter(Boolean).join(" \u2022 ")
          ])
        ]),
        el("div", { class: "sq-bp-price" }, ["INR " + fmt(b.eeup)])
      ]);
      row.addEventListener("click", function () {
        selectedBasePartNo = b.partNo;
        initQuoteFromBase();
        renderBaseList();
      });
      list.appendChild(row);
    });
  }

  function initQuoteFromBase() {
    var base = findBase(selectedBasePartNo);
    if (!base) return;
    var baseDesc = base.family + " (" + base.generation + ") \u2014 " + base.processor
      + (base.ghz ? " @ " + base.ghz : "")
      + " | " + base.memory + " | " + base.hdd + " | " + base.warranty;
    /* Reset shared cart and seed it with the base. */
    if (window.QT_API) {
      window.QT_API.clear();
      window.QT_API.addItem({ sku: base.partNo, description: baseDesc, dtp: base.eeup, margin: 0, qty: 1 });
    }
    /* Track which option SKUs we added so we can remove them on toggle. */
    addedOptionSkus = {};
    addedOptionSkus[base.partNo] = "base";
    renderBaseDetail(base);
    $("sq-base-detail").style.display = "";
    var st = document.querySelector(".sq-section-tools");
    if (st) st.style.display = "";
    $("sq-options-list").style.display = "";
    setupOptionsToolbar();
    renderOptionsList();
  }

  function renderBaseDetail(b) {
    var dl = ""
      + "<dt>Part No</dt><dd>" + escapeHtml(b.partNo) + "</dd>"
      + "<dt>Family</dt><dd>" + escapeHtml(b.family) + " (" + escapeHtml(b.generation) + ")</dd>"
      + "<dt>Form Factor</dt><dd>" + escapeHtml(b.formFactor) + (b.socket ? " &middot; " + escapeHtml(b.socket) : "") + "</dd>"
      + "<dt>Processor</dt><dd>" + escapeHtml(b.processor) + (b.ghz ? " @ " + escapeHtml(b.ghz) : "") + (b.cache ? " &middot; " + escapeHtml(b.cache) : "") + "</dd>"
      + "<dt>Memory</dt><dd>" + escapeHtml(b.memory) + "</dd>"
      + "<dt>Storage</dt><dd>" + escapeHtml(b.hdd) + (b.backplane ? " &middot; " + escapeHtml(b.backplane) : "") + "</dd>"
      + "<dt>RAID</dt><dd>" + escapeHtml(b.raid || "") + "</dd>"
      + "<dt>Management</dt><dd>" + escapeHtml(b.mgmt || "") + "</dd>"
      + "<dt>Other</dt><dd>" + escapeHtml(b.others || "") + "</dd>"
      + "<dt>Warranty</dt><dd>" + escapeHtml(b.warranty || "") + "</dd>"
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
    $("sq-opt-all").onchange = function () { setupOptionsToolbar(); renderOptionsList(); };
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
        "\u26A0 No compatibility matrix exists for this base in the price list \u2014 tick 'Show all options' to add line items manually. Verify compatibility before quoting."
      ]));
      return;
    }
    if (!opts.length) {
      list.appendChild(el("div", { class: "sq-empty" }, ["No options."]));
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
    var capped = opts.slice(0, 400);
    capped.forEach(function (o) {
      var inQuote = !!addedOptionSkus[o.partNo];
      var row = el("div", { class: "sq-opt-row" }, [
        el("div", null, [el("input", { type: "checkbox", "data-pn": o.partNo, checked: inQuote ? "checked" : null })]),
        el("div", { class: "sq-opt-type" }, [o.type || ""]),
        el("div", null, [
          el("div", null, [o.description]),
          el("div", { class: "sq-opt-pn" }, [o.partNo])
        ]),
        el("div", { class: "sq-opt-price" }, ["INR " + fmt(o.eeup)])
      ]);
      row.querySelector('input[type=checkbox]').addEventListener("change", function (ev) {
        if (!window.QT_API) return;
        if (ev.target.checked) {
          if (!addedOptionSkus[o.partNo]) {
            window.QT_API.addItem({ sku: o.partNo, description: o.description, dtp: o.eeup, margin: 0, qty: 1 });
            addedOptionSkus[o.partNo] = "option";
          }
        } else {
          window.QT_API.removeBySku(o.partNo);
          delete addedOptionSkus[o.partNo];
        }
      });
      list.appendChild(row);
    });
    if (opts.length > capped.length) {
      list.appendChild(el("div", { class: "sq-empty" }, ["Showing first " + capped.length + " of " + opts.length + " \u2014 narrow the search to see more."]));
    }
  }
  function renderQuoteTable() {
    /* Obsolete: server quotation now pushes line items into the shared
       qt-shared-area cart via window.QT_API. Kept as a no-op to avoid
       breaking any stale references. */
  }

  window.QT_SERVER = {
    inited: false,
    init: function () {
      if (this.inited) return;
      var node = document.getElementById("sq-data");
      if (!node) { console.warn("[" + BUILD + "] sq-data missing"); return; }
      try { DATA = JSON.parse(node.textContent); }
      catch (e) { console.error("[" + BUILD + "] failed to parse sq-data", e); return; }
      OPTIONS = DATA.options || {};
      BASES = DATA.bases || [];
      COMPAT = DATA.compat || {};
      console.log("[" + BUILD + "] loaded", BASES.length, "bases,", Object.keys(OPTIONS).length, "options,", Object.keys(COMPAT).length, "compat");
      setupBasePicker();
      this.inited = true;
    }
  };
})();

/* ============================================================================
   Dell Quote Pricelist module (tab "Dell Quote")
   ----------------------------------------------------------------------------
   Treats each Dell quotation email as a reusable mini-pricelist.
   Power Automate ingests each Dell quote email into a single Excel file
   under SharePoint Documents/Pricelist/Dell/<QuoteNo>.xlsx, built from
   Documents/Templates/Dell-template.xlsx. Each file contains a named
   Table1 with columns: SKU, Description, Qty, UnitPrice, TotalPrice
   (or similar; the renderer is column-tolerant).

   Single flow QuoteSite-GetDellPricelist:
     POST {}                 -> { lists: ["3700023958518.3", "3700024080237.2", ...] }
     POST { list: "<file>" } -> { skus: [ {SKU, Description, Qty, UnitPrice, ...}, ... ] }

   Same contract as QuoteSite-GetWorkstationData so the implementation
   mirrors that module.
   ============================================================================ */
(function () {
  "use strict";
  function $(id) { return document.getElementById(id); }

  var CONFIG = { flowUrls: {}, defaultMargin: 10 };
  try {
    var raw = document.getElementById("productData");
    if (raw) CONFIG = JSON.parse(raw.textContent);
  } catch (e) { console.error("[QT-DELL] productData parse", e); }

  var DELL_PRICE_KEYS = ["UnitPrice", "Unit Price", "Price", "DTP", "ERP", "Rate", "UnitPriceInr", "UnitCost"];
  var DELL_SKU_KEYS   = ["SKU", "Sku", "PartNumber", "Part No", "PartNo", "ProductId", "ProductCode"];
  var DELL_DESC_KEYS  = ["Description", "ProductTitle", "ProductDescription", "Title", "Item"];
  var DELL_QTY_KEYS   = ["Qty", "Quantity"];
  var DELL_HIDDEN     = { "__PowerAppsId__": 1, "ItemInternalId": 1, "TotalPrice": 1, "Total": 1, "LineTotal": 1 };

  var listSel, loadingEl, panelEl, ctxEl, listEl, searchEl, addBtn, emptyEl;
  var listsLoaded = false;
  var allSkus = [];
  var skuCache = {};
  var currentList = "";

  function pickFirst(row, keys) {
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (row[k] != null && String(row[k]).trim() !== "") return row[k];
    }
    return "";
  }
  function pickPrice(row) {
    for (var i = 0; i < DELL_PRICE_KEYS.length; i++) {
      var raw = row[DELL_PRICE_KEYS[i]];
      if (raw == null) continue;
      var cleaned = String(raw).replace(/[^0-9.\-]/g, "");
      if (!cleaned) continue;
      var v = Number(cleaned);
      if (v && !isNaN(v)) return v;
    }
    return 0;
  }
  function pickQty(row) {
    for (var i = 0; i < DELL_QTY_KEYS.length; i++) {
      var raw = row[DELL_QTY_KEYS[i]];
      if (raw == null) continue;
      var v = Number(String(raw).replace(/[^0-9.\-]/g, ""));
      if (v && !isNaN(v)) return v;
    }
    return 1;
  }
  function extraSpecs(row) {
    var skip = {};
    [].concat(DELL_PRICE_KEYS, DELL_SKU_KEYS, DELL_DESC_KEYS, DELL_QTY_KEYS).forEach(function (k) { skip[k] = true; });
    for (var k in DELL_HIDDEN) skip[k] = true;
    var out = [];
    for (var k2 in row) {
      if (!row.hasOwnProperty(k2)) continue;
      if (skip[k2]) continue;
      var v = row[k2];
      if (v == null || String(v).trim() === "" || String(v).trim() === "-") continue;
      out.push({ label: k2, value: String(v) });
    }
    return out;
  }
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmt(n) {
    return Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function loadQuotes() {
    var url = CONFIG.flowUrls && CONFIG.flowUrls.getDellPricelist;
    if (!url || url.indexOf("PASTE_") === 0) {
      listSel.innerHTML = '<option value="">-- Flow not configured --</option>';
      emptyEl.innerHTML = '<span style="color:#c00;">QuoteSite-GetDellPricelist flow URL is not configured. See PowerAutomate-Flow-Steps.md \u2192 Dell pricelist flows.</span>';
      return;
    }
    listSel.innerHTML = '<option value="">-- Loading Dell quotes... --</option>';
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        listsLoaded = true;
        var lists = data.lists || data.quotes || [];
        listSel.innerHTML = '<option value="">-- Select Dell Quote --</option>';
        lists.forEach(function (name) {
          var o = document.createElement("option");
          o.value = name; o.textContent = name;
          listSel.appendChild(o);
        });
        if (!lists.length) {
          emptyEl.textContent = "No Dell quotes found. Forward a Dell quote email to the ingestion mailbox, or add an .xlsx file under SharePoint Documents/Pricelist/Dell/.";
        }
      })
      .catch(function (err) {
        console.error("[QT-DELL] Failed to load Dell quotes", err);
        listSel.innerHTML = '<option value="">-- Error loading --</option>';
        emptyEl.innerHTML = '<span style="color:#c00;">Failed to load Dell quotes. Check the flow.</span>';
      });
  }

  function loadSkus(listName) {
    var url = CONFIG.flowUrls && CONFIG.flowUrls.getDellPricelist;
    if (!url || url.indexOf("PASTE_") === 0) return;

    if (skuCache[listName]) {
      allSkus = skuCache[listName];
      showPanel();
      return;
    }

    loadingEl.classList.remove("qt-hidden");
    panelEl.classList.add("qt-hidden");
    emptyEl.style.display = "none";

    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ list: listName, file: listName })
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var rows = data.skus || data.rows || data.lines || [];
        if (rows.length && Array.isArray(rows[0])) {
          rows = [].concat.apply([], rows);
        }
        allSkus = rows.map(function (row, idx) {
          var sku   = pickFirst(row, DELL_SKU_KEYS);
          var desc  = pickFirst(row, DELL_DESC_KEYS);
          var price = pickPrice(row);
          var qty   = pickQty(row);
          return {
            uid:   "dell::" + listName + "::" + idx + "::" + sku,
            list:  listName,
            sku:   String(sku || ""),
            desc:  String(desc || ""),
            qty:   qty,
            price: price,
            specs: extraSpecs(row),
            raw:   row
          };
        });
        skuCache[listName] = allSkus;
        loadingEl.classList.add("qt-hidden");
        showPanel();
      })
      .catch(function (err) {
        console.error("[QT-DELL] Failed to load SKUs", err);
        loadingEl.classList.add("qt-hidden");
        listEl.innerHTML = '<div style="padding:14px;color:#c00;">Failed to load SKUs. Please try again.</div>';
        panelEl.classList.remove("qt-hidden");
      });
  }

  function showPanel() {
    emptyEl.style.display = "none";
    panelEl.classList.remove("qt-hidden");
    renderList();
  }

  function renderList() {
    var q = (searchEl && searchEl.value || "").trim().toLowerCase();
    var items = allSkus.filter(function (s) {
      if (!q) return true;
      var blob = s.sku + " " + s.desc + " " + s.specs.map(function (sp) { return sp.value; }).join(" ");
      return blob.toLowerCase().indexOf(q) !== -1;
    });

    ctxEl.textContent = "(" + currentList + " - " + items.length + " line" + (items.length === 1 ? "" : "s") + ")";

    function cardHtml(s) {
      var specsHtml = s.specs.map(function (sp) {
        return '<span><b>' + escapeHtml(sp.label) + ':</b>' + escapeHtml(sp.value) + '</span>';
      }).join("");
      return '<label class="qt-ws-card">' +
        '<input type="checkbox" value="' + escapeHtml(s.uid) + '" />' +
        '<div class="qt-ws-body">' +
          '<div class="qt-ws-head">' +
            '<span class="qt-ws-sku">' + escapeHtml(s.sku || "(no SKU)") + '</span>' +
            (s.qty > 1 ? '<span class="qt-ws-plant">Qty ' + s.qty + '</span>' : '') +
            '<span class="qt-ws-price">' + fmt(s.price) + '</span>' +
          '</div>' +
          (s.desc ? '<div style="font-size:12.5px;color:#333;margin-bottom:4px;">' + escapeHtml(s.desc) + '</div>' : '') +
          (specsHtml ? '<div class="qt-ws-specs">' + specsHtml + '</div>' : '') +
        '</div>' +
      '</label>';
    }

    if (!items.length) {
      listEl.innerHTML = '<div style="padding:14px;color:#888;">No line items match.</div>';
    } else {
      listEl.innerHTML = items.map(cardHtml).join("");
    }

    listEl.querySelectorAll("input[type=checkbox]").forEach(function (cb) {
      cb.addEventListener("change", function () {
        addBtn.disabled = !listEl.querySelector("input[type=checkbox]:checked");
      });
    });
    addBtn.disabled = true;
  }

  function buildDescription(s) {
    var bits = [];
    var head = "Dell Quote " + s.list + (s.sku ? " - SKU " + s.sku : "");
    bits.push(head);
    if (s.desc) bits.push(s.desc);
    s.specs.forEach(function (sp) { bits.push(sp.label + ": " + sp.value); });
    return bits.join(" | ");
  }

  function bind() {
    listSel    = $("qt-dl-list");
    loadingEl  = $("qt-dl-loading");
    panelEl    = $("qt-dl-panel");
    ctxEl      = $("qt-dl-context");
    listEl     = $("qt-dl-list-skus");
    searchEl   = $("qt-dl-search");
    addBtn     = $("qt-dl-add");
    emptyEl    = $("qt-dl-empty");
    if (!listSel || !panelEl || !listEl || !addBtn) return false;

    listSel.addEventListener("change", function () {
      currentList = listSel.value || "";
      if (!currentList) {
        panelEl.classList.add("qt-hidden");
        emptyEl.style.display = "";
        allSkus = [];
        return;
      }
      loadSkus(currentList);
    });

    if (searchEl) searchEl.addEventListener("input", renderList);

    addBtn.addEventListener("click", function () {
      if (!window.QT_API) return;
      var selected = Array.prototype.slice.call(listEl.querySelectorAll("input[type=checkbox]:checked")).map(function (c) { return c.value; });
      selected.forEach(function (uid) {
        var s = allSkus.filter(function (x) { return x.uid === uid; })[0];
        if (!s) return;
        window.QT_API.addItem({
          sku: s.sku,
          description: buildDescription(s),
          dtp: Number(s.price || 0),
          margin: CONFIG.defaultMargin || 10,
          qty: Number(s.qty || 1)
        });
      });
      listEl.querySelectorAll("input[type=checkbox]").forEach(function (c) { c.checked = false; });
      addBtn.disabled = true;
    });

    return true;
  }

  window.QT_DELL = {
    inited: false,
    init: function () {
      if (this.inited) return;
      if (!bind()) { console.warn("[QT-DELL] DOM not ready, init aborted"); return; }
      loadQuotes();
      this.inited = true;
    }
  };
})();
