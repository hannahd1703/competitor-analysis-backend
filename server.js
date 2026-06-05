const express = require('express');
const cors = require('cors');
const { scrapeUrl } = require('./scraper');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.post('/api/scrape', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });
  try {
    const result = await scrapeUrl(url);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message, url });
  }
});

app.post('/api/scrape/batch', async (req, res) => {
  const { urls } = req.body;
  if (!urls || !Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: 'URLs array is required' });
  }
  if (urls.length > 20) {
    return res.status(400).json({ error: 'Maximum 20 URLs per batch' });
  }
  const results = [];
  for (const url of urls) {
    try {
      const data = await Promise.race([
        scrapeUrl(url),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Scrape timed out after 8s')), 8000))
      ]);
      results.push({ success: true, url, data });
    } catch (err) {
      results.push({ success: false, url, error: err.message, data: null });
    }
  }
  res.json({ results });
});

app.get('/api/health', (_, res) => res.json({ status: 'ok' }));

// Serve the frontend
app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>CompEdge</title>
<link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet"/>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0d0d14;color:#e8e8f0;font-family:'DM Sans',sans-serif;font-size:14px}
input:focus{outline:none;border-color:#e8ff3c!important}
input::placeholder{color:#4a4a68}
::-webkit-scrollbar{width:6px;height:6px}
::-webkit-scrollbar-track{background:#13131f}
::-webkit-scrollbar-thumb{background:#2a2a44;border-radius:3px}
button:hover{opacity:0.85}
table{border-collapse:collapse}
.null{color:#4a4a68}
.price{color:#e8ff3c;font-family:monospace;font-weight:700}
.badge-yes{background:rgba(46,213,115,0.15);color:#2ed573;padding:2px 8px;border-radius:3px;font-size:11px;font-family:monospace}
.badge-no{background:rgba(255,71,87,0.1);color:#ff4757;padding:2px 8px;border-radius:3px;font-size:11px;font-family:monospace}
.cell-list{list-style:none;padding:0;margin:0}
.cell-list li{font-size:11px;background:#20203a;border-radius:3px;padding:2px 6px;margin-bottom:2px;color:#7878a0}
</style>
</head>
<body>
<div id="app"></div>
<script>
const FIELDS = [
  {key:'operatorName',label:'Operator'},
  {key:'tourTitle',label:'Tour Title'},
  {key:'metaDescription',label:'Meta Description'},
  {key:'lowSeasonPrice',label:'Low Season Price'},
  {key:'highSeasonPrice',label:'High Season Price'},
  {key:'pricePerDay',label:'Price / Day'},
  {key:'duration',label:'Duration'},
  {key:'tourStyle',label:'Tour Style'},
  {key:'groupSize',label:'Group Size'},
  {key:'starRating',label:'Star Rating'},
  {key:'meals',label:'Meals'},
  {key:'transport',label:'Transport'},
  {key:'hasFlightsIncluded',label:'Flights Included'},
  {key:'hasFreeDay',label:'Free Day'},
  {key:'hasWelcomeDinner',label:'Welcome Dinner'},
  {key:'hasSingleSupplement',label:'Single Supplement'},
  {key:'inclusions',label:'Inclusions'},
  {key:'destinations',label:'Destinations'},
];

let results = [];
let urls = [''];

function cellHtml(value, key) {
  if (value === null || value === undefined || value === '') return '<span class="null">—</span>';
  if (typeof value === 'boolean') return value ? '<span class="badge-yes">Yes</span>' : '<span class="badge-no">No</span>';
  if (Array.isArray(value)) {
    if (!value.length) return '<span class="null">—</span>';
    return '<ul class="cell-list">' + value.map(v => '<li>'+escHtml(v)+'</li>').join('') + '</ul>';
  }
  if (['lowSeasonPrice','highSeasonPrice','pricePerDay'].includes(key)) return '<span class="price">'+escHtml(String(value))+'</span>';
  if (key === 'metaDescription') {
    const s = String(value);
    return escHtml(s.length > 80 ? s.slice(0,80)+'…' : s);
  }
  return escHtml(String(value));
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function exportExcel() {
  const rows = [FIELDS.map(f => f.label)];
  results.forEach(r => {
    rows.push(FIELDS.map(f => {
      const v = r[f.key];
      if (v === null || v === undefined) return '';
      if (typeof v === 'boolean') return v ? 'Yes' : 'No';
      if (Array.isArray(v)) return v.join(', ');
      return String(v);
    }));
  });
  let csv = rows.map(r => r.map(c => '"'+String(c).replace(/"/g,'""')+'"').join(',')).join('\\n');
  const blob = new Blob([csv], {type:'text/csv'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'competitor-analysis.csv';
  a.click();
}

function render() {
  document.getElementById('app').innerHTML = \`
  <div style="min-height:100vh;background:#0d0d14">
    <div style="background:#13131f;border-bottom:1px solid #2a2a44;padding:16px 24px;display:flex;align-items:center;justify-content:space-between">
      <div style="display:flex;align-items:center;gap:12px">
        <span style="font-size:28px;color:#e8ff3c">⬡</span>
        <div>
          <div style="font-family:monospace;font-size:22px;font-weight:700;color:#e8ff3c">CompEdge</div>
          <div style="font-size:11px;color:#7878a0;text-transform:uppercase;letter-spacing:0.08em">Tour Competitor Intelligence</div>
        </div>
      </div>
      \${results.length > 0 ? \`
      <div style="display:flex;gap:10px">
        <button onclick="results=[];render()" style="background:transparent;border:1px solid #2a2a44;color:#7878a0;padding:8px 16px;border-radius:6px;cursor:pointer;font-size:13px">Clear All</button>
        <button onclick="exportExcel()" style="background:rgba(79,110,247,0.15);border:1px solid #4f6ef7;color:#4f6ef7;padding:8px 16px;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600">↓ Export CSV</button>
      </div>\` : ''}
    </div>
    <div style="max-width:1400px;margin:0 auto;padding:28px 24px">
      <div style="background:#13131f;border:1px solid #2a2a44;border-radius:10px;padding:24px;margin-bottom:24px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px">
          <div>
            <div style="font-family:monospace;font-size:15px;font-weight:700">Competitor URLs</div>
            <div style="font-size:12px;color:#7878a0;margin-top:3px">Paste tour listing URLs from any operator</div>
          </div>
          <button onclick="window.addUrl()" style="background:transparent;border:1px solid #2a2a44;color:#7878a0;padding:5px 12px;border-radius:6px;cursor:pointer;font-size:12px">+ Add URL</button>
        </div>
        <div id="url-list" style="display:flex;flex-direction:column;gap:8px;margin-bottom:18px">
          \${urls.map((u,i) => \`
          <div style="display:flex;align-items:center;gap:10px">
            <span style="font-family:monospace;font-size:11px;color:#4a4a68;width:18px;text-align:right">\${i+1}</span>
            <input type="url" placeholder="https://www.intrepidtravel.com/..." value="\${escHtml(u)}"
              oninput="urls[\${i}]=this.value"
              style="flex:1;background:#0d0d14;border:1px solid #2a2a44;color:#e8e8f0;font-family:monospace;font-size:12px;padding:8px 12px;border-radius:6px"/>
            \${urls.length > 1 ? \`<button onclick="urls.splice(\${i},1);render()" style="background:none;border:none;color:#4a4a68;font-size:18px;cursor:pointer">×</button>\` : ''}
          </div>\`).join('')}
        </div>
        <button onclick="window.doScrape()" id="scrape-btn"
          style="background:#e8ff3c;color:#0d0d14;border:none;padding:8px 24px;border-radius:6px;cursor:pointer;font-size:13px;font-weight:700;min-width:160px">
          ⚡ Scrape \${urls.filter(u=>u.trim()).length} URL(s)
        </button>
      </div>
      <div id="error-box"></div>
      <div id="results-box">
        \${results.length === 0 ? \`
        <div style="text-align:center;padding:80px 24px;color:#7878a0">
          <div style="font-size:48px;margin-bottom:16px">🔍</div>
          <h2 style="font-family:monospace;font-size:18px;color:#e8e8f0;margin-bottom:8px">Add competitor URLs to begin</h2>
          <p style="font-size:14px;line-height:1.7;max-width:520px;margin:0 auto">Paste tour listing URLs from Intrepid, G Adventures, On the Go, Inspiring Vacations and others.</p>
        </div>\` : \`
        <div style="background:#13131f;border:1px solid #2a2a44;border-radius:10px;overflow:hidden">
          <div style="padding:18px 24px;border-bottom:1px solid #2a2a44">
            <span style="font-family:monospace;font-size:15px;font-weight:700">Results</span>
            <span style="background:#1a1a2e;color:#7878a0;font-size:11px;padding:2px 8px;border-radius:10px;margin-left:8px">\${results.length}</span>
          </div>
          <div style="overflow-x:auto">
            <table style="width:100%;font-size:13px">
              <thead>
                <tr>\${FIELDS.map(f=>\`<th style="background:#1a1a2e;padding:10px 14px;text-align:left;font-family:monospace;font-size:11px;color:#7878a0;white-space:nowrap;border-bottom:1px solid #2a2a44">\${f.label}</th>\`).join('')}<th style="background:#1a1a2e;border-bottom:1px solid #2a2a44"></th></tr>
              </thead>
              <tbody>
                \${results.map((row,i)=>\`
                <tr style="background:\${i%2===0?'#13131f':'#1a1a2e'}">
                  \${FIELDS.map(f=>\`<td style="padding:10px 14px;border-bottom:1px solid #2a2a44;vertical-align:top;max-width:280px">\${cellHtml(row[f.key],f.key)}</td>\`).join('')}
                  <td style="padding:10px 14px;border-bottom:1px solid #2a2a44"><button onclick="results.splice(\${i},1);render()" style="background:none;border:none;color:#4a4a68;font-size:16px;cursor:pointer">×</button></td>
                </tr>\`).join('')}
              </tbody>
            </table>
          </div>
        </div>\`}
      </div>
    </div>
  </div>\`;
}

async function doScrape() {
  const validUrls = urls.filter(u => u.trim());
  if (!validUrls.length) return;
  const btn = document.getElementById('scrape-btn');
  btn.textContent = 'Scraping...';
  btn.disabled = true;
  document.getElementById('error-box').innerHTML = '';
  try {
    const res = await fetch('/api/scrape/batch', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({urls: validUrls})
    });
    const json = await res.json();
    const newErrors = [];
    json.results.forEach(r => {
      if (r.success && r.data) {
        const idx = results.findIndex(x => x.url === r.url);
        if (idx >= 0) results[idx] = r.data;
        else results.push(r.data);
      } else {
        newErrors.push(r);
      }
    });
    if (newErrors.length) {
      document.getElementById('error-box').innerHTML = \`
      <div style="background:rgba(255,71,87,0.1);border:1px solid rgba(255,71,87,0.3);color:#ff8a94;border-radius:6px;padding:14px 18px;margin-bottom:20px;font-size:13px">
        <strong>⚠ \${newErrors.length} URL(s) failed:</strong>
        <ul style="margin-top:8px;padding-left:18px">
          \${newErrors.map(e=>\`<li><code>\${escHtml(e.url)}</code> — \${escHtml(e.error||'Unknown error')}</li>\`).join('')}
        </ul>
      </div>\`;
    }
  } catch(err) {
    document.getElementById('error-box').innerHTML = \`<div style="background:rgba(255,71,87,0.1);border:1px solid rgba(255,71,87,0.3);color:#ff8a94;border-radius:6px;padding:14px 18px;margin-bottom:20px;font-size:13px">⚠ \${escHtml(err.message)}</div>\`;
  }
  render();
}
window.doScrape = doScrape;
window.addUrl = function() { urls.push(''); render(); };
render();
</script>
</body>
</html>`);
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));