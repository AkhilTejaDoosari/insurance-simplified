# V2 design demo (reference for the web cut-over, WP11)

`insurance-simplified-v2-demo.html` is the owner-approved interactive demo
(D-038). Open it in a browser; it is self-contained. Every plan, value and PDF
in it is **invented** for the demo; no real insurance document is included.

Rebuild after editing `data.py` or `template.html`:

```sh
pip install reportlab
python make_pdfs.py   # writes pdfs/*.pdf and bundle.json (both git-ignored)
python -c "import base64;s=open('template.html').read();b=open('bundle.json').read();i='data:image/png;base64,'+base64.b64encode(open('../../../web/public/insurance-simplified-icon.png','rb').read()).decode();open('insurance-simplified-v2-demo.html','w').write(s.replace('__BUNDLE__',b).replace('__ICON__',i))"
```
