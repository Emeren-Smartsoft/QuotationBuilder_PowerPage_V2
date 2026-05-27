(function () {
  "use strict";

  var GST_RATE = 0.18;
  function fmt(n) { return "\u20B9 " + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

  var DATA = { categories: {} };
  try {
    var raw = document.getElementById("productData");
    if (raw) DATA = JSON.parse(raw.textContent);
  } catch (e) { console.error("Failed to parse productData", e); }
  if (window.QT_PRODUCTS) DATA = window.QT_PRODUCTS;

  function $(id) { return document.getElementById(id); }
  var step1    = $("qt-step-1");
  var step2    = $("qt-step-2");
  var stepDots = document.querySelectorAll(".qt-step");
  var form     = $("qt-customer-form");
  var summary  = $("qt-customer-summary");
  var catSel   = $("qt-category");
  var typeSel  = $("qt-type");
  var panel    = $("qt-products-panel");
  var ctxLabel = $("qt-panel-context");
  var listEl   = $("qt-products-list");
  var searchEl = $("qt-search");
  var addBtn   = $("qt-add-selected");
  var tbody    = $("qt-table-body");
  var grandEl  = $("qt-grand-total");
  var backBtn  = $("qt-back");
  var printBtn = $("qt-print");
  var saveBtn  = $("qt-save");

  if (!form) return; /* not on quotation page */

  var customer = {};
  var cart = [];

  Object.keys(DATA.categories || {}).forEach(function (cat) {
    var o = document.createElement("option");
    o.value = cat; o.textContent = cat;
    catSel.appendChild(o);
  });

  function setStep(n) {
    step1.classList.toggle("qt-hidden", n !== 1);
    step2.classList.toggle("qt-hidden", n !== 2);
    stepDots.forEach(function (el) { el.classList.toggle("active", Number(el.dataset.step) <= n); });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (!form.reportValidity()) return;
    var fd = new FormData(form);
    customer = Object.fromEntries(fd.entries());
    renderCustomerSummary();
    setStep(2);
  });

  backBtn.addEventListener("click", function () { setStep(1); });

  function renderCustomerSummary() {
    function row(label, val) {
      return val ? '<div class="qt-cs-row"><span class="qt-cs-l">' + label + '</span><span class="qt-cs-v">' + escapeHtml(val) + '</span></div>' : '';
    }
    var today = new Date();
    var dateStr = customer.quoteDate || (today.getFullYear() + '-' + String(today.getMonth()+1).padStart(2,'0') + '-' + String(today.getDate()).padStart(2,'0'));
    summary.innerHTML =
      '<div class="qt-cs-title">Quotation for</div>' +
      '<div class="qt-cs-company">' + escapeHtml(customer.company || '') + '</div>' +
      '<div class="qt-cs-grid">' +
        row('Contact', customer.contact) +
        row('Email', customer.email) +
        row('Phone', customer.phone) +
        row('GSTIN', customer.gstin) +
        row('Date', dateStr) +
        row('Address', customer.address) +
        row('Notes', customer.notes) +
      '</div>';
  }

  catSel.addEventListener("change", function () {
    var ok = !!catSel.value;
    typeSel.disabled = !ok;
    typeSel.value = "";
    panel.classList.add("qt-hidden");
  });

  typeSel.addEventListener("change", function () {
    if (!catSel.value || !typeSel.value) { panel.classList.add("qt-hidden"); return; }
    renderProductList();
    panel.classList.remove("qt-hidden");
  });

  searchEl.addEventListener("input", renderProductList);

  function currentProducts() {
    var cat = DATA.categories[catSel.value] || {};
    return cat[typeSel.value] || [];
  }

  function renderProductList() {
    var q = (searchEl.value || "").trim().toLowerCase();
    var items = currentProducts().filter(function (p) {
      return !q || p.description.toLowerCase().indexOf(q) !== -1 || (p.sku || "").toLowerCase().indexOf(q) !== -1;
    });
    ctxLabel.textContent = "(" + catSel.value + " > " + typeSel.value + " - " + items.length + ")";
    listEl.innerHTML = items.map(function (p) {
      return '<label class="qt-prod-item">' +
             '<input type="checkbox" value="' + escapeAttr(p.sku) + '" />' +
             '<span class="qt-prod-desc">' + escapeHtml(p.description) + '</span>' +
             '<span class="qt-prod-price">' + fmt(p.unitPrice) + '</span>' +
             '</label>';
    }).join("") || '<div style="padding:14px;color:#888;">No products match.</div>';

    listEl.querySelectorAll("input[type=checkbox]").forEach(function (cb) {
      cb.addEventListener("change", function () {
        addBtn.disabled = !listEl.querySelector("input[type=checkbox]:checked");
      });
    });
    addBtn.disabled = true;
  }

  addBtn.addEventListener("click", function () {
    var selected = Array.prototype.slice.call(listEl.querySelectorAll("input[type=checkbox]:checked")).map(function (c) { return c.value; });
    var pool = currentProducts();
    selected.forEach(function (sku) {
      if (cart.some(function (x) { return x.sku === sku; })) return;
      var p = pool.find(function (x) { return x.sku === sku; });
      if (p) cart.push({ sku: p.sku, description: p.description, unitPrice: Number(p.unitPrice), qty: 1 });
    });
    renderTable();
    listEl.querySelectorAll("input[type=checkbox]").forEach(function (c) { c.checked = false; });
    addBtn.disabled = true;
  });

  function renderTable() {
    if (cart.length === 0) {
      tbody.innerHTML = '<tr class="qt-empty"><td colspan="8">No products added yet. Use the selector above.</td></tr>';
      grandEl.textContent = fmt(0);
      return;
    }
    var grand = 0;
    tbody.innerHTML = cart.map(function (it, idx) {
      var gst = it.unitPrice * GST_RATE;
      var unitIncl = it.unitPrice + gst;
      var total = unitIncl * it.qty;
      grand += total;
      return '<tr data-idx="' + idx + '">' +
             '<td>' + (idx + 1) + '</td>' +
             '<td>' + escapeHtml(it.description) + '</td>' +
             '<td class="num">' + fmt(it.unitPrice) + '</td>' +
             '<td class="num"><span class="qt-qty-print">' + it.qty + '</span><input type="number" min="1" step="1" value="' + it.qty + '" class="qt-qty" /></td>' +
             '<td class="num">' + fmt(gst) + '</td>' +
             '<td class="num">' + fmt(unitIncl) + '</td>' +
             '<td class="num">' + fmt(total) + '</td>' +
             '<td><button class="qt-remove" title="Remove">&times;</button></td>' +
             '</tr>';
    }).join("");
    grandEl.textContent = fmt(grand);

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

  printBtn.addEventListener("click", function () { window.print(); });

  saveBtn.addEventListener("click", function () {
    if (cart.length === 0) { alert("Please add at least one product."); return; }
    var payload = {
      customer: customer,
      items: cart.map(function (it) {
        var gst = it.unitPrice * GST_RATE;
        return {
          sku: it.sku, description: it.description, unitPrice: it.unitPrice, qty: it.qty,
          gst: gst, unitPriceInclGst: it.unitPrice + gst, total: (it.unitPrice + gst) * it.qty
        };
      }),
      grandTotal: cart.reduce(function (s, it) { return s + (it.unitPrice * (1 + GST_RATE)) * it.qty; }, 0),
      createdOn: new Date().toISOString()
    };
    console.log("Quotation payload:", payload);
    alert("Quotation prepared. (See browser console for payload. Wire up the Web API call in custom_javascript to persist into Dataverse.)");
  });

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function escapeAttr(s) { return escapeHtml(s); }
})();
