# Quote Site — Agent Instructions

A **Microsoft Power Pages** site (exported via `pac pages download`) plus a custom **Quotation Builder** page backed by four **Power Automate** flows and **SharePoint** (price lists, saved quotations, proposal templates).

## Repository Layout

| Path | What it is |
|------|------------|
| [quotation---site-j0yx8/](quotation---site-j0yx8/) | Power Pages site source. Folder name = Power Platform site identifier — **do not rename**. |
| [quotation---site-j0yx8/web-pages/quotation/content-pages/](quotation---site-j0yx8/web-pages/quotation/content-pages/) | The custom Quotation Builder page (HTML / CSS / JS). All product/business logic lives here. |
| [quotation---site-j0yx8/web-templates/](quotation---site-j0yx8/web-templates/) | Liquid templates used by the site framework. Avoid editing unless changing site chrome. |
| [Proposal-Templates/](Proposal-Templates/) | Source HTML annexures (Microsoft 365, Server, Sophos…) uploaded to SharePoint `Documents/Proposal Templates/` for Flow 4. Filename (sans `.html`) becomes the dropdown label. |
| [PowerAutomate-Flow-Steps.md](PowerAutomate-Flow-Steps.md) | **Source of truth** for the 4 flows, their request/response contracts, and SharePoint folder structure. Read before changing anything flow-related. |

## Architecture in One Picture

```
Browser (Quotation page)
  ├─ GET  getCategories         → lists subfolders of Documents/Pricelist/
  ├─ POST getProducts           → reads .xlsx (Table1) under Pricelist/<category>/
  ├─ POST getProposalTemplates  → lists or fetches HTML from Documents/Proposal Templates/
  └─ POST saveQuotation         → writes PDF to Documents/Quotations/ + optional Outlook email
```

All four endpoints are **HTTP-triggered Power Automate flows**. URLs live in the `productData` JSON `<script>` block inside [Quotation.en-US.webpage.copy.html](quotation---site-j0yx8/web-pages/quotation/content-pages/Quotation.en-US.webpage.copy.html) under `CONFIG.flowUrls`. The browser JS reads them via `JSON.parse(document.getElementById("productData").textContent)`.

## Conventions That Matter

- **Two copies of every quotation page file.** `Quotation.webpage.*` (default language) and `Quotation.en-US.webpage.*` (localized) exist side-by-side. **Edit the `en-US` copy** — that is the one served. Keep the default in sync only if behaviour visibly drifts.
- **No build step, no bundler, no framework.** Vanilla ES5-style JS (IIFE, `var`, no `const`/`let`), inline `<style>` blocks, no npm. PDF generation uses `html2pdf.js` (loaded via CDN at runtime) producing `jsPDF` + `html2canvas` output.
- **Flow contracts are fixed.** Request/response shapes are documented in [PowerAutomate-Flow-Steps.md](PowerAutomate-Flow-Steps.md). If you change a field name in the JS, update the flow's trigger schema (and vice versa) — there is no shared type definition.
- **Excel price lists must have a named table `Table1`** with exact headers: `ProductId`, `SkuTitle`, `DTP`, `ERP`, `Segment`, `ProductTitle`. Flow 2 fails silently for files missing this.
- **CORS:** every flow `Response` action must set `Access-Control-Allow-Origin: *` and `Content-Type: application/json`. Without these the browser fetch fails with an opaque error.
- **Empty/null guards in flows** use `length(coalesce(triggerBody()?['x'], '')) > 0` — never `is not equal to null`. See the email-troubleshooting checklist in [PowerAutomate-Flow-Steps.md](PowerAutomate-Flow-Steps.md).
- **Print/PDF styling:** the quotation HTML uses paired `qt-screen-only` / `qt-print-only` spans and a `@media print` block at the top of [Quotation.en-US.webpage.copy.html](quotation---site-j0yx8/web-pages/quotation/content-pages/Quotation.en-US.webpage.copy.html). Any new column or total must respect both views.
- **CSS class prefix `qt-`** is reserved for the Quotation Builder. Don't reuse it elsewhere and don't strip it.
- **Debug marker:** the JS logs `[QT] script loaded build=<tag>` on load. Bump the build tag string when shipping a non-trivial JS change so the user can confirm a fresh upload landed.

## Deploying Changes

Local edits are pushed to the live Power Pages site with the **Power Platform CLI**:

```powershell
pac pages upload --path "D:\VS_CopilotStudio_Agents\Quote Site\quotation---site-j0yx8" --modelVersion 2
```

- Requires an authenticated `pac auth` profile pointed at the correct environment. Do **not** run this without asking — it mutates the live site.
- After upload, the user hard-refreshes the page (`Ctrl+F5`) and checks the `[QT] script loaded build=…` console line to confirm the new JS shipped.
- There are no automated tests. Validation is manual: open the Quotation page, walk through Step 1 → Step 2 → Save / Email.

## Power Automate Flows — Do's and Don'ts

- Flow definitions live **in the cloud**, not in this repo. The `.md` file is the spec; treat it as authoritative when reasoning about request/response shapes.
- When editing the spec, also update any JS code that builds the request body or reads the response.
- The four flow names are fixed: `QuoteSite-GetCategories`, `QuoteSite-GetProducts`, `QuoteSite-SaveQuotation`, `QuoteSite-GetProposalTemplates`.
- Required SharePoint folders under `Documents/`: `Pricelist/`, `Quotations/`, `Proposal Templates/`.

## Things to Avoid

- Don't introduce build tooling (webpack, TypeScript, npm) — Power Pages serves the files as-is.
- Don't rename `quotation---site-j0yx8/` or any `*.webpage.yml` GUIDs — they bind to records in Dataverse.
- Don't delete the non-`en-US` `Quotation.webpage.*` siblings; the site expects both.
- Don't commit flow URLs to a public location — they contain SAS-style `sig=` tokens that grant invoke access.
- Don't add server-side logic to the page; all dynamic behaviour goes through one of the four flows.
