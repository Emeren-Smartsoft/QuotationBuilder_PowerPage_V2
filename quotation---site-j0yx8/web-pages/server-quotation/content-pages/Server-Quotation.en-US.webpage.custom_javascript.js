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
  });
})();
