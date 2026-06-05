const fetch = require('node-fetch');
const cheerio = require('cheerio');

function extractPrices(text) {
  const matches = text.match(/(?:USD?|AUD?|\$|£|€)\s?[\d,]+(?:\.\d{1,2})?/gi) || [];
  return [...new Set(matches.map(p => p.trim()))];
}

function extractDuration(text) {
  const dayMatch = text.match(/(\d+)\s*(?:-?\s*(\d+))?\s*days?/i);
  const nightMatch = text.match(/(\d+)\s*(?:-?\s*(\d+))?\s*nights?/i);
  if (dayMatch) return dayMatch[0].trim();
  if (nightMatch) return nightMatch[0].trim();
  return null;
}

function extractGroupSize(text) {
  const match = text.match(/(?:max(?:imum)?|up to|min(?:imum)?|group(?:\s+size)?)\s*:?\s*(\d+)/i)
    || text.match(/(\d+)\s*(?:to|-)\s*(\d+)\s*(?:pax|people|passengers|guests)/i);
  return match ? match[0].trim() : null;
}

function extractStarRating(text) {
  const match = text.match(/(\d(?:\.\d)?)\s*\*?\s*star/i);
  return match ? match[1] : null;
}

function extractTourStyle(text) {
  const styles = ['luxury', 'premium', 'deluxe', 'budget', 'adventure', 'cultural',
    'family', 'solo', 'small group', 'private', 'escorted', 'self-guided'];
  const found = styles.filter(s => new RegExp(s, 'i').test(text));
  return found.length ? found.join(', ') : null;
}

function extractMeals(text) {
  const keywords = ['breakfast', 'lunch', 'dinner', 'all meals', 'half board', 'full board'];
  const found = keywords.filter(k => new RegExp(k, 'i').test(text));
  return found.length ? found.join(', ') : null;
}

function extractTransport(text) {
  const types = ['coach', 'bus', 'train', 'flight', 'ferry', 'cruise', 'shinkansen', 'rail'];
  const found = types.filter(t => new RegExp(t, 'i').test(text));
  return found.length ? found.join(', ') : null;
}

async function scrapeUrl(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    timeout: 8000,
  });

  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);

  const html = await response.text();
  const $ = cheerio.load(html);

  // Remove scripts and styles from text extraction
  $('script, style, noscript').remove();

  const getMeta = (name) =>
    $(`meta[name="${name}"], meta[property="${name}"]`).attr('content') || null;

  const bodyText = $('body').text().replace(/\s+/g, ' ').trim();

  // Identity
  const pageTitle = $('title').text().trim() || getMeta('og:title');
  const metaDescription = getMeta('description') || getMeta('og:description');
  const operatorName = getMeta('og:site_name') || null;
  const tourTitle = $('h1').first().text().trim() || pageTitle;

  // Prices
  const priceEls = [];
  $('[class*="price"], [class*="cost"], [data-testid*="price"]').each((_, el) => {
    const t = $(el).text().trim();
    if (t) priceEls.push(t);
  });

  const allPriceText = [...priceEls, bodyText].join(' ');
  const bodyPrices = extractPrices(allPriceText);
  const numericPrices = bodyPrices
    .map(p => ({ raw: p, num: parseFloat(p.replace(/[^0-9.]/g, '')) }))
    .filter(p => !isNaN(p.num) && p.num > 100)
    .sort((a, b) => a.num - b.num);

  const lowPrice = numericPrices[0]?.raw || null;
  const highPrice = numericPrices[numericPrices.length - 1]?.raw || null;

  // Duration
  const durationEl = $('[class*="duration"], [class*="days"], [class*="nights"]').first().text().trim();
  const duration = durationEl || extractDuration(bodyText);

  // Price per day
  let pricePerDay = null;
  if (lowPrice && duration) {
    const days = parseInt(duration);
    const price = parseFloat(lowPrice.replace(/[^0-9.]/g, ''));
    if (!isNaN(days) && !isNaN(price) && days > 0) {
      pricePerDay = `$${(price / days).toFixed(0)}`;
    }
  }

  // Inclusions list
  const inclusions = [];
  $('[class*="inclusions"] li, [class*="included"] li, [class*="whats-included"] li').each((_, el) => {
    const t = $(el).text().trim();
    if (t) inclusions.push(t);
  });

  // Destinations
  const destinations = [];
  $('[class*="destination"], [class*="itinerary"] h3, [class*="day-title"]').each((_, el) => {
    const t = $(el).text().trim();
    if (t) destinations.push(t);
  });

  // JSON-LD structured data
  let ldPrice = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).html());
      ldPrice = data?.offers?.price || data?.offers?.[0]?.price || ldPrice;
    } catch {}
  });

  return {
    url,
    scrapedAt: new Date().toISOString(),
    pageTitle,
    tourTitle,
    operatorName,
    metaDescription,
    lowSeasonPrice: lowPrice,
    highSeasonPrice: highPrice !== lowPrice ? highPrice : null,
    ldJsonPrice: ldPrice ? `$${ldPrice}` : null,
    pricePerDay,
    allPrices: numericPrices.slice(0, 5).map(p => p.raw),
    duration,
    tourStyle: extractTourStyle(bodyText),
    groupSize: extractGroupSize(bodyText),
    starRating: extractStarRating(bodyText),
    meals: extractMeals(bodyText),
    transport: extractTransport(bodyText),
    hasFlightsIncluded: /flight(s)?\s*included|international\s*flight/i.test(bodyText),
    hasFreeDay: /free\s*day|leisure\s*day/i.test(bodyText),
    hasWelcomeDinner: /welcome\s*dinner/i.test(bodyText),
    hasSingleSupplement: /single\s*supplement/i.test(bodyText),
    inclusions: inclusions.slice(0, 8),
    destinations: destinations.slice(0, 10),
  };
}

module.exports = { scrapeUrl };