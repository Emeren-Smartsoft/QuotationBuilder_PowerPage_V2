# Power Automate Flows – Step-by-Step

**SharePoint Site:** `https://z2bm1.sharepoint.com/s/SmartBox`  
**Folder:** Shared Documents/Pricelist/  
**Subfolders:** CheckPoint, CrowdStrike, Microsoft Defender, Paloalto, Softwares

---

## Flow 1: QuoteSite-GetCategories

### Action 1: Trigger – "When an HTTP request is received"
- **Who can trigger the flow?** → `Anyone`
- **Request Body JSON Schema** → Leave empty
- **Advanced parameters** → Show all → **Method** = `GET`

---

### Action 2: "Send an HTTP request to SharePoint"
Search: `Send an HTTP request to SharePoint`

| Field | Value |
|-------|-------|
| Site Address | `Smartsoft - https://z2bm1.sharepoint.com/sites/SmartBox` (select from dropdown) |
| Method | `GET` |
| Uri | `_api/web/GetFolderByServerRelativeUrl('/sites/SmartBox/Shared Documents/Pricelist')/Folders?$select=Name` |
| Headers – Key | `Accept` |
| Headers – Value | `application/json;odata=nometadata` (type as plain text, do NOT click fx) |

---

### Action 3: "Select" (Data Operations)
Search: `Select`

| Field | How to fill |
|-------|-------------|
| From | Click in field → **Expression** tab → type: `body('Send_an_HTTP_request_to_SharePoint')?['value']` → click **Add** |
| Map | Click the **T** toggle (top-right of Map) to switch to text mode → **Expression** tab → type: `item()?['Name']` → click **Add** |

---

### Action 4: "Filter array" (Data Operations)
Search: `Filter array`

| Field | How to fill |
|-------|-------------|
| From | Click → **Expression** tab → type: `body('Select')` → click **Add** |
| Condition (left) | **Expression** tab → type: `item()` → click **Add** |
| Operator | `is not equal to` |
| Condition (right) | Type plain text: `Forms` |

---

### Action 5: "Response" (Request connector)
Search: `Response`

| Field | Value |
|-------|-------|
| Status Code | `200` |
| Headers – Key 1 | `Content-Type` |
| Headers – Value 1 | `application/json` |
| Headers – Key 2 | `Access-Control-Allow-Origin` |
| Headers – Value 2 | `*` |
| Body | See below |

**Body** – click in the field, switch to **Expression** tab, type:
```
json(concat('{"categories":', string(body('Filter_array')), '}'))
```
Click **Add**.

**OR** simpler: type this directly in the Body field (plain text mode):
```
{"categories": @{body('Filter_array')}}
```

---

### Save & Get URL
1. Click **Save**
2. Go back to the trigger step → the **HTTP URL** field now has a URL → **Copy** it
3. This is your `getCategories` URL

---
---

## Flow 2: QuoteSite-GetProducts

### Action 1: Trigger – "When an HTTP request is received"
- **Who can trigger the flow?** → `Anyone`
- **Request Body JSON Schema** → Paste this:
```json
{
  "type": "object",
  "properties": {
    "category": { "type": "string" },
    "segment": { "type": "string" }
  },
  "required": ["category"]
}
```
- **Advanced parameters** → Show all → **Method** = `POST`

---

### Action 2: "Initialize variable"
Search: `Initialize variable`

| Field | Value |
|-------|-------|
| Name | `allProducts` |
| Type | `Array` |
| Value | `[]` |

---

### Action 3: "Get files (properties only)" (SharePoint)
Search: `Get files (properties only)` (SharePoint connector)

| Field | How to fill |
|-------|-------------|
| Site Address | `Smartsoft - https://z2bm1.sharepoint.com/sites/SmartBox` (select from dropdown) |
| Library Name | `Documents` (select from dropdown) |
| **Advanced parameters** → Show all: | |
| Limit Entries to Folder | Click in field → **Expression** tab → type: `concat('/Pricelist/', triggerBody()?['category'])` → **Add** |

Leave all other advanced fields empty.

---

### Action 4: "Apply to each"
Search: `Apply to each`

| Field | How to fill |
|-------|-------------|
| Select An Output From Previous Steps | Click → **Dynamic content** tab → select **"value"** from "Get files (properties only)" |

OR if dynamic content doesn't show: **Expression** tab → type: `body('Get_files_(properties_only)')?['value']` → **Add**

**Everything below (Actions 4a–4c) goes INSIDE this loop:**

---

### Action 4a (inside loop): "Condition"
Search: `Condition`

| Field | How to fill |
|-------|-------------|
| Left side | **Expression** tab → `endsWith(item()?['{FilenameWithExtension}'], '.xlsx')` → **Add** |
| Operator | `is equal to` |
| Right side | Type: `true` |

---

### Action 4b (inside If Yes): "List rows present in a table"
Search: `List rows present in a table` (Excel Online Business)

| Field | How to fill |
|-------|-------|
| Location | `Smartsoft - https://z2bm1.sharepoint.com/sites/SmartBox` (select from dropdown) |
| Document Library | `Documents` (select from dropdown) |
| File | Click in field → **Expression** tab → type: `item()?['{Identifier}']` → **Add** |
| Table | Click in field → **Expression** tab → type: `'Table1'` → **Add** |

> ⚠️ Each Excel file MUST have a named Table called `Table1`. Open in Excel → select all data → Insert → Table → ensure "My table has headers" is checked.

---

### Action 4c (inside If Yes, after List rows): "Apply to each" (nested loop)
Search: `Apply to each`

| Field | How to fill |
|-------|-------------|
| Select An Output From Previous Steps | **Expression** tab → `body('List_rows_present_in_a_table')?['value']` → **Add** |

### Action 4d (inside nested Apply to each): "Append to array variable"
Search: `Append to array variable`

| Field | How to fill |
|-------|-------------|
| Name | `allProducts` |
| Value | **Expression** tab → `item()` → **Add** |

> This appends each Excel row individually (objects are supported, arrays are not).

---

### Action 5 (after the loop): "Condition" – Filter by Segment
Search: `Condition`

| Field | How to fill |
|-------|-------------|
| Left side | **Expression** tab → `length(coalesce(triggerBody()?['segment'], ''))` → **Add** |
| Operator | `is greater than` |
| Right side | Type: `0` |

> The `coalesce(..., '')` guards against the `segment` field being missing or null in the request, which would otherwise throw `InvalidTemplate` (length() of null).

---

### Action 5a (If Yes): "Filter array"
Search: `Filter array`

| Field | How to fill |
|-------|-------------|
| From | **Expression** tab → `variables('allProducts')` → **Add** |
| Condition (left) | **Expression** tab → `item()?['Segment']` → **Add** |
| Operator | `is equal to` |
| Condition (right) | **Expression** tab → `triggerBody()?['segment']` → **Add** |

---

### Action 5b (If Yes): "Response"
Search: `Response`

| Field | Value |
|-------|-------|
| Status Code | `200` |
| Headers – Key 1 | `Content-Type` |
| Headers – Value 1 | `application/json` |
| Headers – Key 2 | `Access-Control-Allow-Origin` |
| Headers – Value 2 | `*` |
| Body | `{"products": @{body('Filter_array')}}` |

---

### Action 5c (If No / Else branch): "Response"
Search: `Response`

| Field | Value |
|-------|-------|
| Status Code | `200` |
| Headers – Key 1 | `Content-Type` |
| Headers – Value 1 | `application/json` |
| Headers – Key 2 | `Access-Control-Allow-Origin` |
| Headers – Value 2 | `*` |
| Body | `{"products": @{variables('allProducts')}}` |

---

### Save & Get URL
1. Click **Save**
2. Go back to trigger step → copy the **HTTP URL**
3. This is your `getProducts` URL

---
---

## After Getting Both URLs

Paste both URLs into `Quotation.en-US.webpage.copy.html`:
```json
{
  "flowUrls": {
    "getCategories": "PASTE_URL_HERE",
    "getProducts": "PASTE_URL_HERE"
  },
  "defaultMargin": 10
}
```

> All four flow URLs (Flows 1–4) are collected together in the **Final Config** section at the bottom of this document. You can skip ahead and fill them all in one place after building each flow.

---

## Excel File Requirements

Each Excel file in a Pricelist subfolder must have:
1. A **named Table** (select data → Insert → Table → check "My table has headers")
2. These exact column headers: `ProductId`, `SkuTitle`, `DTP`, `ERP`, `Segment`, `ProductTitle`
3. File extension: `.xlsx`

---
---

## Flow 3: QuoteSite-SaveQuotation

This flow receives a PDF (base64-encoded) and a filename from the quotation page, then saves the file to SharePoint.

---

### Action 1: Trigger – "When an HTTP request is received"
- **Who can trigger the flow?** → `Anyone`
- **Request Body JSON Schema** → Paste this:
```json
{
  "type": "object",
  "properties": {
    "fileName": { "type": "string" },
    "fileContent": { "type": "string" },
    "recipientEmail": { "type": "string" },
    "recipientName": { "type": "string" },
    "ccEmail": { "type": "string" },
    "emailSubject": { "type": "string" },
    "emailBody": { "type": "string" }
  },
  "required": ["fileName", "fileContent"]
}
```
- **Advanced parameters** → Show all → **Method** = `POST`

> The five new fields (`recipientEmail`, `recipientName`, `ccEmail`, `emailSubject`, `emailBody`) are **optional**. If `recipientEmail` is supplied, the flow also emails the PDF as an attachment after saving to SharePoint.

---

### Action 2: "Create file" (SharePoint)
Search: `Create file` (SharePoint connector)

| Field | How to fill |
|-------|-------------|
| Site Address | `Smartsoft - https://z2bm1.sharepoint.com/sites/SmartBox` (select from dropdown) |
| Folder Path | `/Shared Documents/Quotations` |
| File Name | Click in field → **Dynamic content** tab → select **fileName** from trigger |
| File Content | Click in field → **Expression** tab → type: `base64ToBinary(triggerBody()?['fileContent'])` → **Add** |

> ⚠️ Make sure the folder `/Shared Documents/Quotations` exists in your SharePoint site. If not, create it manually in SharePoint before running the flow.

---

### Action 3: "Condition" – Send email if recipient provided
Search: `Condition`

| Field | How to fill |
|-------|-------------|
| Left side | **Expression** tab → `length(coalesce(triggerBody()?['recipientEmail'], ''))` → **Add** |
| Operator | `is greater than` |
| Right side | Type: `0` |

---

### Action 3a (inside "If Yes"): "Send an email (V2)" (Office 365 Outlook)
Search: `Send an email (V2)` (Office 365 Outlook connector)

> Sign in with the mailbox that should appear as the sender (e.g. `sales@smartsoft.co.in`). The email comes FROM whichever account this connection uses.

> 💡 **Tip:** Use the **Expression** (`fx`) tab for every field below — dynamic content from the trigger sometimes doesn't appear in the picker even after saving the schema. Expressions always work.

| Field | How to fill |
|-------|-------------|
| To | Click in field → **Expression** tab → paste `triggerBody()?['recipientEmail']` → **Add** |
| Subject | **Expression** tab → `coalesce(triggerBody()?['emailSubject'], concat('Proposal & Quotation - ', triggerBody()?['fileName']))` → **Add** |
| Body | **Expression** tab → `coalesce(triggerBody()?['emailBody'], 'Please find the attached quotation.')` → **Add** |
| **Advanced parameters → Show all:** | |
| CC | **Expression** tab → `coalesce(triggerBody()?['ccEmail'], '')` → **Add** |
| Attachments Name - 1 | **Expression** tab → `triggerBody()?['fileName']` → **Add** |
| Attachments Content - 1 | **Expression** tab → `base64ToBinary(triggerBody()?['fileContent'])` → **Add** |
| Is HTML | `Yes` |
| Importance | `Normal` |

> If you don't see the "Attachments" rows, click **Add new item** under the Attachments section.



### Action 4: "Response" (Request connector) — after the Condition block (NOT inside it)
Search: `Response`

| Field | Value |
|-------|-------|
| Status Code | `200` |
| Headers – Key 1 | `Content-Type` |
| Headers – Value 1 | `application/json` |
| Headers – Key 2 | `Access-Control-Allow-Origin` |
| Headers – Value 2 | `*` |
| Body | See below |

**Body** – type this in the Body field:
```json
{
  "status": "success",
  "fileName": "@{triggerBody()?['fileName']}",
  "sharepointPath": "/Shared Documents/Quotations/@{triggerBody()?['fileName']}",
  "emailed": "@{greater(length(coalesce(triggerBody()?['recipientEmail'], '')), 0)}"
}
```

---

### Save & Get URL
1. Click **Save**
2. Go back to the trigger step → the **HTTP URL** field now has a URL → **Copy** it
3. Paste the URL into the quotation page HTML config (replace `PASTE_SAVE_QUOTATION_FLOW_URL_HERE`):

In `Quotation.en-US.webpage.copy.html`, update the `productData` JSON:
```json
{
  "flowUrls": {
    "getCategories": "...",
    "getProducts": "...",
    "saveQuotation": "PASTE_YOUR_FLOW_3_URL_HERE"
  },
  "defaultMargin": 10
}
```

Then upload:
```
pac pages upload --path "D:\VS_CopilotStudio_Agents\Quote Site\quotation---site-j0yx8" --modelVersion 2
```

---
---

## Flow 4: QuoteSite-GetProposalTemplates

Returns either the **list of available proposal templates** OR the **HTML content of one template**, depending on whether `templateName` is supplied in the request.

### SharePoint Setup (one-time)

1. In your SharePoint site, open the **Documents** library.
2. Create a folder named **`Proposal Templates`** (with a space).
3. Upload the template files:
   - `Software.html`
   - `Server.html`
   - (Add more as needed — e.g. `Networking.html`, `Security.html`)
4. The file name (without `.html`) becomes the display name in the dropdown on the quotation page.

> Template files are in: `D:\VS_CopilotStudio_Agents\Quote Site\Proposal-Templates\`

---

### Action 1: Trigger – "When an HTTP request is received"
- **Who can trigger the flow?** → `Anyone`
- **Request Body JSON Schema** → Paste this:
```json
{
  "type": "object",
  "properties": {
    "templateName": { "type": "string" }
  }
}
```
- **Advanced parameters** → Show all → **Method** = `POST`

> If `templateName` is empty → returns the list of templates.
> If `templateName` = `"Software"` → returns the HTML content of `Software.html`.

---

### Action 2: "Initialize variable" – `templateName`

| Field | Value |
|-------|-------|
| Name | `templateName` |
| Type | `String` |
| Value | **Expression** tab → `coalesce(triggerBody()?['templateName'], '')` → **Add** |

---

### Action 3: "Condition" – Has templateName?

| Field | How to fill |
|-------|-------------|
| Left side | **Expression** tab → `length(variables('templateName'))` → **Add** |
| Operator | `is greater than` |
| Right side | Type: `0` |

---

### Action 3a (If Yes branch): "Get file content using path" (SharePoint)
Search: `Get file content using path`

| Field | How to fill |
|-------|-------------|
| Site Address | `Smartsoft - https://z2bm1.sharepoint.com/sites/SmartBox` (select from dropdown) |
| File Path | **Expression** tab → `concat('/Shared Documents/Proposal Templates/', variables('templateName'), '.html')` → **Add** |

### Action 3b (If Yes branch): "Response"

| Field | Value |
|-------|-------|
| Status Code | `200` |
| Headers – Key 1 | `Content-Type` |
| Headers – Value 1 | `application/json` |
| Headers – Key 2 | `Access-Control-Allow-Origin` |
| Headers – Value 2 | `*` |
| Body | See below |

**Body** – type this in the Body field:
```json
{
  "templateName": "@{variables('templateName')}",
  "html": "@{body('Get_file_content_using_path')}"
}
```

> If the file content comes back as a binary object instead of a string, replace the `html` value with the expression `base64ToString(body('Get_file_content_using_path')?['$content'])`.

---

### Action 3c (If No / Else branch): "List folder" (SharePoint)
Search: `List folder`

| Field | How to fill |
|-------|-------------|
| Site Address | `Smartsoft - https://z2bm1.sharepoint.com/sites/SmartBox` (select from dropdown) |
| File identifier | `/Shared Documents/Proposal Templates` |

### Action 3d (If No branch): "Filter array" – keep only `.html` files
Search: `Filter array`

| Field | How to fill |
|-------|-------------|
| From | **Expression** tab → `body('List_folder')` → **Add** |
| Condition (left) | **Expression** tab → `endsWith(toLower(item()?['Name']), '.html')` → **Add** |
| Operator | `is equal to` |
| Condition (right) | Type: `true` |

### Action 3e (If No branch): "Select" – build template list
Search: `Select`

| Field | How to fill |
|-------|-------------|
| From | **Expression** tab → `body('Filter_array')` → **Add** |
| Map | Leave in object mode and add two key-value rows: |
| Key 1 | `name` → Value: **Expression** → `replace(item()?['Name'], '.html', '')` |
| Key 2 | `displayName` → Value: **Expression** → `replace(item()?['Name'], '.html', '')` |

### Action 3f (If No branch): "Response"

| Field | Value |
|-------|-------|
| Status Code | `200` |
| Headers – Key 1 | `Content-Type` |
| Headers – Value 1 | `application/json` |
| Headers – Key 2 | `Access-Control-Allow-Origin` |
| Headers – Value 2 | `*` |
| Body | `{"templates": @{body('Select')}}` |

---

### Save & Get URL
1. Click **Save**
2. Go back to the trigger step → copy the **HTTP URL**
3. This is your `getProposalTemplates` URL

---
---

## Final Config: All 4 Flow URLs

After all four flows are built, paste their URLs into `productData` in `Quotation.en-US.webpage.copy.html`:

```json
{
  "flowUrls": {
    "getCategories":         "PASTE_FLOW_1_URL_HERE",
    "getProducts":           "PASTE_FLOW_2_URL_HERE",
    "saveQuotation":         "PASTE_FLOW_3_URL_HERE",
    "getProposalTemplates":  "PASTE_FLOW_4_URL_HERE",
    "getWorkstationData":    "PASTE_FLOW_5_URL_HERE"
  },
  "defaultMargin": 10
}
```

Then upload:
```
pac pages upload --path "D:\VS_CopilotStudio_Agents\Quote Site\quotation---site-j0yx8" --modelVersion 2
```

---

## Required SharePoint Folders (checklist)

All under `Documents` (i.e. `/Shared Documents/`) in the SmartBox site:

- [ ] `Pricelist/` — with subfolders per category, each containing `.xlsx` files with `Table1`
- [ ] `Quotations/` — destination for saved PDFs (Flow 3)
- [ ] `Proposal Templates/` — holds `Software.html`, `Server.html`, etc. (Flow 4)
- [ ] `MOQ Prices/` — flat folder with one `.xlsx` per `<Brand> <Product Type> <Month Year>` (Flow 5). See Flow 5 for the schema.





---

### ✉️ Email-Not-Sending Troubleshooting Checklist

If the PDF saves to SharePoint but **no email arrives**, verify each of the following in the live `QuoteSite-SaveQuotation` flow:

1. **Trigger schema includes the 5 email properties**
   Open the trigger → confirm `recipientEmail`, `recipientName`, `ccEmail`, `emailSubject`, `emailBody` are listed in the Request Body JSON Schema (re-paste the full schema from Action 1 above if any are missing). Save the flow after editing.
2. **Condition exists AFTER `Create file` and uses the correct expression**
   - Left: `length(coalesce(triggerBody()?['recipientEmail'], ''))`
   - Operator: `is greater than`
   - Right: `0`
   Common mistake: using `triggerBody()?['recipientEmail']` directly with `is not equal to null` — this fails when the field is an empty string. Use the `length(coalesce(...))` form.
3. **"Send an email (V2)" is inside the `If yes` branch** (not after the Condition, not in `If no`).
4. **Outlook connection is signed in to a valid mailbox** (click the action's `...` → **My connections** → reconnect if it shows "Invalid connection").
5. **`Is HTML` is set to `Yes`** under Advanced parameters — otherwise the HTML body is rendered as plain text and some tenants flag/block it.
6. **Attachment Content uses `base64ToBinary(triggerBody()?['fileContent'])`**, not the raw `fileContent` string.
7. **Run history check**: trigger the flow once from the site (Email via Outlook), then open Power Automate → My flows → `QuoteSite-SaveQuotation` → **28-day run history** → click the latest run:
   - Expand the **Condition** — does it show `true`? If `false`, the email field isn't reaching the flow (check the trigger output's `Body` for `recipientEmail`).
   - Expand **Send an email (V2)** — if it shows red ❌, read the error (most common: `InvalidAuthenticationToken` → reconnect Outlook; `MailboxNotEnabledForRESTAPI` → the connection account has no Exchange license).
8. **Spam/Junk** — first run sometimes lands in Junk because the mailbox hasn't sent to that recipient before. Check Junk and add the sender to safe-senders.
9. **External recipient policies** — if your tenant blocks external email from this mailbox, the action will succeed but the email never leaves. Ask your M365 admin to check the message trace in the Exchange admin center.

After fixing any of the above, click **Save** on the flow and re-test from the site.

---

## Flow 5: QuoteSite-GetWorkstationData

Backs the **Hardware Quotation** tab. ONE flow handles two cases based on the request body:

| Request body | Behaviour |
|--------------|-----------|
| `{}` | Returns the list of price-list filenames (every `.xlsx`, sans extension, under `Documents/MOQ Prices/`). |
| `{ "list": "HP Desktop Workstation June 2025" }` | Reads `Documents/MOQ Prices/HP Desktop Workstation June 2025.xlsx` → `Table1`, returns each row as a SKU object. |

> The legacy property name `model` is also accepted by the page (sent alongside `list`), so the flow can use either. New flows should standardise on `list`.

### Flow layout at a glance

```
Trigger: When an HTTP request is received  (POST, schema = {list, model})
│
├── 1. Compose            → name: "ListName"
│                            Inputs (fx): coalesce(triggerBody()?['list'], triggerBody()?['model'], '')
│
├── 2. Initialize variable → Name: AllSkus | Type: Array | Value: []
│                            (MUST be at root — not inside Condition/loop)
│
└── 3. Condition           length(outputs('ListName'))  is equal to  0
    │
    ├── If yes  (no list specified → return filenames)
    │   ├── 3a. Send an HTTP request to SharePoint
    │   │       Uri: _api/web/GetFolderByServerRelativeUrl('/sites/SmartBox/Shared Documents/MOQ Prices')/Files?$select=Name
    │   ├── 3b. Select
    │   │       From (fx): body('Send_an_HTTP_request_to_SharePoint')?['value']
    │   │       Map  (T mode, fx): replace(item()?['Name'], '.xlsx', '')
    │   └── 3c. Response
    │           Body (plain text):  {"lists": @{body('Select')}}
    │
    └── If no   (list specified → return SKU rows from every table)
        │
        ├── 3d. Get tables  (Excel Online Business)
        │       File (fx): concat('/MOQ Prices/', outputs('ListName'), '.xlsx')
        │
        ├── 3f. Apply to each   over   body('Get_tables')?['value']
        │   │
        │   ├── 3f.i.   List rows present in a table
        │   │           File  (fx): concat('/MOQ Prices/', outputs('ListName'), '.xlsx')
        │   │           Table (fx, custom value): items('Apply_to_each')?['id']
        │   │
        │   ├── 3f.ii.  Select   (internal name often becomes Select1)
        │   │           From (fx): body('List_rows_present_in_a_table')?['value']
        │   │           Map  (T mode, fx): addProperty(item(), 'Model', items('Apply_to_each')?['name'])
        │   │
        │   └── 3f.iii. Apply to each  (nested)   over   body('Select_1')
        │           └── 3f.iii.a. Append to array variable
        │                       Name: AllSkus
        │                       Value (fx): item()        ← single object, keeps AllSkus flat
        │
        └── 3h. Response
                Body (plain text):  {"skus": @{variables('AllSkus')}}
```

### SharePoint layout

```
Shared Documents/
└── MOQ Prices/
    ├── HP Desktop Workstation June 2025.xlsx
    ├── HP PowerEdge Server May 2026.xlsx
    ├── Dell PowerEdge Server May 2026.xlsx
    ├── Lenovo ThinkPad Laptop April 2026.xlsx
    └── ...
```

> Filename convention: **`<Brand> <Product Type> <Month Year>.xlsx`** — e.g. `HP Desktop Workstation June 2025.xlsx`. The whole filename (sans `.xlsx`) becomes the dropdown label shown on the page.

### Required Excel schema (per file)

A workbook can hold **one or more named tables** — typically one table per model family, mirroring the printed price book (e.g. a single `HP Desktop Workstation November 2025.xlsx` with separate tables for `Z1_G9_14th_Gen`, `Z2_Tower_G1i`, `Z2_G9_Tower_14th_Gen`, etc.). The flow returns rows from **all** tables in the file, each tagged with its source table name so the page can group by model.

- Each section is a real Excel **Named Table** (Insert → Table → "My table has headers" → Table Design → Table Name).
- **Table name = model family.** Excel disallows spaces in table names → use underscores (e.g. `Z2_G9_Tower_14th_Gen`). The page converts underscores back to spaces for display.
- Column schema can differ between tables in the same workbook — the renderer is column-agnostic.

**Reserved column names** (treated specially):

| Column                                     | Role                                                                          |
|--------------------------------------------|-------------------------------------------------------------------------------|
| `SKU` (or `ProductId`, `PartNumber`)       | Identifier shown bold on the card. At least one is required.                  |
| `Brand`                                    | Optional badge on the card (useful when a file mixes brands).                 |
| `Plant`                                    | Optional badge on the card (e.g. `IDS`, `RCTO`).                              |
| `FTP` (or `Price`, `DTP`, `ERP`, `MOQ`)    | **Unit price in INR, GST exclusive.** First non-zero numeric one wins.        |

**Everything else** (e.g. `Chassis`, `Processor`, `RAM`, `HDD`, `GFX`, `ODD`, `OS`, `Cable`, `Wifi/BT`, `Warranty`, `Screen`, `Battery`, `Capacity`, `RAID`, …) is rendered automatically as `<column>: <value>` on the SKU card and included in the cart description. Empty cells and `-` are ignored.

### Action 1: Trigger – "When an HTTP request is received"
- **Who can trigger the flow?** → `Anyone`
- **Request Body JSON Schema**:
```json
{
  "type": "object",
  "properties": {
    "list":  { "type": "string" },
    "model": { "type": "string" }
  }
}
```

### Action 2: "Compose" – normalise the list name
- Name: `ListName`
- Inputs (expression):
  ```
  coalesce(triggerBody()?['list'], triggerBody()?['model'], '')
  ```

### Action 2b: "Initialize variable" — **must be at root level, NOT inside the Condition**
- Name: `AllSkus`
- Type: `Array`
- Value: `[]`

> ⚠️ Power Automate forbids `Initialize variable` inside a Condition / Scope / loop. Place this action between the `ListName` Compose and the Condition, at the top level of the flow. The variable is still usable from inside the "If no" branch via `variables('AllSkus')`.

### Action 3: "Condition" – Is `ListName` empty?
- Left: `length(outputs('ListName'))`
- Operator: `is equal to`
- Right: `0`

### If yes → list price lists

**Action 3a: "Send an HTTP request to SharePoint"**

| Field | Value |
|-------|-------|
| Site Address | `Smartsoft - https://z2bm1.sharepoint.com/sites/SmartBox` |
| Method | `GET` |
| Uri | `_api/web/GetFolderByServerRelativeUrl('/sites/SmartBox/Shared Documents/MOQ Prices')/Files?$select=Name` |
| Headers `Accept` | `application/json;odata=nometadata` |

**Action 3b: "Select"** (Data Operations)
- **From** (expression): `body('Send_an_HTTP_request_to_SharePoint')?['value']`
- **Map** (text mode, expression): `replace(item()?['Name'], '.xlsx', '')`

**Action 3c: "Response"**
- Status: `200`
- Headers: `Content-Type: application/json`, `Access-Control-Allow-Origin: *`
- Body — **type directly into the Body box as plain text** (do NOT click fx):
  ```
  {"lists": @{body('Select')}}
  ```
  Or, equivalently via **fx → Expression** tab (no `@{}`):
  ```
  json(concat('{"lists":', string(body('Select')), '}'))
  ```

### If no → return SKU rows for that price list (ALL tables in the workbook)

A single `.xlsx` typically contains **multiple named tables** (one per model family). We list every table in the file, fetch its rows, and tag each row with the table name so the page can group them.

**Action 3d: "Get tables"** (Excel Online (Business))

| Field | Value |
|-------|-------|
| Location | `Smartsoft - https://z2bm1.sharepoint.com/sites/SmartBox` (the SharePoint site — the connector mislabels the field as "Location", but pick your SharePoint site, NOT OneDrive) |
| Document Library | `Documents` |
| File | Click **fx** → **Expression** tab → paste `concat('/MOQ Prices/', outputs('ListName'), '.xlsx')` → **Add** |

> ⚠️ Don't paste `/MOQ Prices/@{outputs('ListName')}.xlsx` into the Expression tab — the `@{...}` wrapping is invalid there. Use the `concat(...)` form above, or type the path as plain text and insert `outputs('ListName')` via the **fx** token picker (not the Expression tab).

**Action 3e:** *(removed — `Initialize variable AllSkus` is now Action 2b at the root level, since Initialize variable cannot be nested inside a Condition.)*

**Action 3f: "Apply to each"** — input `body('Get_tables')?['value']`

  Inside the loop:

  **Action 3f.i: "List rows present in a table"** (Excel Online (Business))

  | Field | Value |
  |-------|-------|
  | Location | `Smartsoft - https://z2bm1.sharepoint.com/sites/SmartBox` (same SharePoint site as 3d) |
  | Document Library | `Documents` |
  | File | **fx** → **Expression** tab → `concat('/MOQ Prices/', outputs('ListName'), '.xlsx')` → **Add** |
  | Table | Click in field  **Enter custom value**  **Expression** tab  paste `items('Apply_to_each')?['id']`  **Add** |

> \u26a0\ufe0f In the Expression tab the `@{...}` wrapping is implicit \u2014 typing `@{items('Apply_to_each')?['id']}` produces the "This expression has a problem" error. If your loop is named `Apply_to_each_2` (i.e. you already have other Apply-to-each actions), substitute that name.

  **Action 3f.ii: "Select"** (Data Operations) — adds the source-table name as a `Model` field on each row.

  - **From** (expression): `body('List_rows_present_in_a_table')?['value']`
  - **Map** (text mode, expression):
    ```
    addProperty(item(), 'Model', items('Apply_to_each')?['name'])
    ```

  **Action 3f.iii: "Apply to each"** (nested loop, inside the outer Apply to each, after the Select)
  - **Select an output from previous steps** (fx → Expression): `body('Select1')`

    Inside this nested loop:

    **Action 3f.iii.a: "Append to array variable"**
    - Name: `AllSkus`
    - Value (fx → Expression): `item()`

> ⚠️ **Why nested Apply to each + Append single `item()`?**
>
> - `Set variable AllSkus = union(variables('AllSkus'), body('Select1'))` looks cleaner but Power Automate rejects it with **"Self reference is not supported when updating the value of variable"** — you cannot reference a variable inside its own `Set variable` value.
> - `Append to array variable AllSkus = body('Select1')` appends each table's rows as a **nested array** → `AllSkus` becomes `[[row,row],[row,row]]` and you then need a fragile Flatten Compose (whose `createArray()`/`flatten()` expressions fail with `InvalidTemplate` on some tenants).
> - **Nested Apply to each + Append `item()`** appends each row individually as a single object → `AllSkus` stays flat: `[row, row, row, ...]` — no flatten step required.
>
> Use `body('Select_1')` (or `body('Select1')` — whatever your inner Select's **internal name** is, since it usually collides with the outer Select in the True branch).

*(Action 3g "Compose Flatten" is no longer needed — delete it if you previously added it.)*

**Action 3h: "Response"**
- Status: `200`
- Headers: `Content-Type: application/json`, `Access-Control-Allow-Origin: *`
- Body — **type directly into the Body box as plain text** (do NOT click fx):
  ```
  {"skus": @{variables('AllSkus')}}
  ```
  Or, equivalently via **fx → Expression** tab (no `@{}`):
  ```
  json(concat('{"skus":', string(variables('AllSkus')), '}'))
  ```

### Save & Get URL
1. Click **Save**
2. Copy the trigger's **HTTP URL**
3. Paste it into `productData.flowUrls.getWorkstationData` in `Quotation.en-US.webpage.copy.html`
4. Run: `pac pages upload --path "D:\VS_CopilotStudio_Agents\Quote Site\quotation---site-j0yx8" --modelVersion 2`

### Sanity test (from a browser console)

```js
// List price lists
fetch(URL, {method:"POST",headers:{"Content-Type":"application/json"},body:"{}"}).then(r=>r.json()).then(console.log);
// SKUs from one list (returns rows from EVERY table in that file, each tagged with Model)
fetch(URL, {method:"POST",headers:{"Content-Type":"application/json"},
  body:JSON.stringify({list:"HP Desktop Workstation November 2025"})}).then(r=>r.json()).then(console.log);
```

Expected shapes:
```json
{"lists": ["HP Desktop Workstation November 2025","Dell PowerEdge Server May 2026","Lenovo ThinkPad Laptop April 2026"]}
```
```json
{"skus": [
  {"Model":"Z1_G9_14th_Gen","Plant":"DS","SKU":"A1WP1PT","Chassis":"550W","Processor":"Intel Core i5-14500 5.00G 24MB 14C","RAM":"8GB (1x8GB) DDR5 4800","HDD":"512GB PCIe NVMe SSD","GFX":"UMA","ODD":"DVDRW","OS":"FreeDOS","Cable":"VGA","Wifi/BT":"NA","Warranty":"3/3/2003","FTP":89000},
  {"Model":"Z2_Tower_G1i","Plant":"DS","SKU":"C1PT8PT","Chassis":"500W","Processor":"Intel Core U7-265","RAM":"8GB (1x8GB)","HDD":"512GB PCIe M.2 SSD","GFX":"UMA","ODD":"DVDRW","OS":"HP Linux-ready","Warranty":"1/1/2001","FTP":89000}
]}
```

The page converts `Z1_G9_14th_Gen` → `Z1 G9 14th Gen` for the section header. Underscores in Excel table names are required because Excel disallows spaces.
