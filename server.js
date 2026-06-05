const express = require('express');
const cors = require('cors');
const path = require('path');
const { scrapeUrl } = require('./scraper');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

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
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out')), 8000))
      ]);
      results.push({ success: true, url, data });
    } catch (err) {
      results.push({ success: false, url, error: err.message, data: null });
    }
  }
  res.json({ results });
});

app.get('/api/health', (_, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));