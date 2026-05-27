import json
with open(r'd:\VS_CopilotStudio_Agents\Quote Site\_tmp\serverData.json', encoding='utf-8') as f:
    payload = f.read().replace('</', '<\\/')
html_path = r'd:\VS_CopilotStudio_Agents\Quote Site\quotation---site-j0yx8\web-pages\quotation\content-pages\Quotation.en-US.webpage.copy.html'
with open(html_path, encoding='utf-8') as f:
    txt = f.read()
marker = '<script id="productData" type="application/json">'
if 'id="sq-data"' in txt:
    # Replace existing block
    import re
    txt = re.sub(r'<script id="sq-data"[^>]*>[\s\S]*?</script>',
                 '<script id="sq-data" type="application/json">' + payload + '</script>', txt)
else:
    # Append before the productData script (or at end)
    inject = '\n<script id="sq-data" type="application/json">' + payload + '</script>\n\n'
    idx = txt.find(marker)
    if idx == -1:
        txt = txt + inject
    else:
        txt = txt[:idx] + inject + txt[idx:]
with open(html_path, 'w', encoding='utf-8') as f:
    f.write(txt)
print('injected, file size', len(txt))
