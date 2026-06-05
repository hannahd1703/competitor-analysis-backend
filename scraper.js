const fetch = require('node-fetch');
const cheerio = require('cheerio');

function extractBestPrice(text) {
  // Look for "from $X,XXX" or "AUD $X,XXX" patterns first - these are most reliable
  const fromMatch = text.match(/(?:from|price|cost|starts?\s+at|per\s+person)\s*:?\s*(?:AUD|USD|AU)?\s*\$\s*([\d,]+(?:\.\d{2})?)/i);
  if (fromMatch) return '$' + fromMatch[1];

  // Fall back to any price over $500 (filters out small incidental numbers)
  const allPrices = [];
  const regex = /(?:AUD|USD|AU)?\s*\$\s*([\d,]+(?:\.\d{2})?)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const num = parseFloat(match[1].replace(/,/g, ''));
    if (num >= 500 && num <= 50000) {
      allPrices.push({ raw: '$' + match[1], num });
    }
  }
  if (!allPrices.length) return null;
  allPrices.sort((a, b) => a.num - b.num);
  return allPrices[0].raw;
}

function extractDuration(text) {
  // Look for "X days" or "X nights" as a standalone fact, not in itinerary context
  // Prioritise patterns like "14-day", "14 days", "14D/13N"
  const patterns = [
    /(\d+)\s*[-–]\s*(?:day|night)s?\b/i,
    /\b(\d+)\s*days?\s*(?:\/|and|\&)?\s*(?:\d+\s*nights?)?/i,
    /\b(\d+)\s*nights?\b/i,
    /\b(\d+)[Dd]\s*[\/\\]\s*\d+[Nn]\b/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const num = parseInt(match[1]);
      // Sanity check - tour duration should be between 2 and 60 days
      if (num >= 2 && num <= 60) return `${num} days`;
    }
  }
  return null;
}

function extractGroupSize(text) {
  const patterns = [
    /max(?:imum)?\s*(?:group\s*size\s*(?:of)?)?\s*:?\s*(\d+)\s*(?:people|pax|passengers|guests|travelers)?/i,
    /(?:up\s*to|limited\s*to)\s*(\d+)\s*(?:people|pax|passengers|guests|travelers)/i,
    /group\s*size\s*:?\s*(\d+)/i,
    /(\d+)\s*(?:people|pax|passengers)\s*(?:max|maximum)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const num = parseInt(match[1]);
      if (num >= 2 && num <= 200) return `Max ${num}`;
    }
  }
  return null;
}

function extractStarRating(text) {
  // Look for explicit hotel star ratings
  const patterns = [
    /(\d)\s*-?\s*star\s*(?:hotel|accommodation|property|room)/i,
    /(\d)\s*★/,
    /accommodation\s*:?\s*(\d)\s*star/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const num = parseInt(match[1]);
      if (num >= 2 && num <= 5) return `${num}★`;
    }
  }
  return null;
}

function extractTourStyle(text) {
  const styles = [
    'small group',
    'private',
    'luxury',
    'premium',
    'deluxe',
    'budget',
    'adventure',
    'cultural',
    'family',
    'escorted',
    'self-guided',
  ];
  const found = styles.filter(s => new RegExp('\\b' + s + '\\b', 'i').test(text));
  return found.length ? found.slice(0, 3).join(', ') : null;
}

function extractMealCounts(text) {
  const results = [];

  const patterns = [
    { label: 'breakfasts', regex: /(\d+)\s*breakfasts?/i },
    { label: 'lunches', regex: /(\d+)\s*lunches?/i },
    { label: 'dinners', regex: /(\d+)\s*dinners?/i },
  ];

  for (const { label, regex } of patterns) {
    const match = text.match(regex);
    if (match) results.push(`${match[1]} ${label}`);
  }

  // If no counts found, check for general mentions
  if (!results.length) {
    const mentions = [];
    if (/breakfast/i.test(text)) mentions.push('breakfast');
    if (/lunch/i.test(text)) mentions.push('lunch');
    if (/dinner/i.test(text)) mentions.push('dinner');
    if (/all meals/i.test(text)) return 'All meals included';
    return mentions.length ? mentions.join(', ') : null;
  }

  return results.join(', ');
}

function extractTransport(text) {
  const types = [
    { key: 'coach', label: 'Coach' },
    { key: 'train', label: 'Train' },
    { key: 'flight', label: 'Flight' },
    { key: 'ferry', label: 'Ferry' },
    { key: 'cruise', label: 'Cruise' },
    { key: 'shinkansen', label: 'Shinkansen' },
  ];
  const found = types.filter(t => new RegExp('\\b' + t.key + '\\b', 'i').test(text));
  return found.length ? found.map(t => t.label).join(', ') : null;
}

function extractOperator($) {
  // Try common operator/brand selectors
  const selectors = [
    'meta[property="og:site_name"]',
    '.operator-name',
    '.brand-name',
    '.company-name',
    'header .logo img[alt]',
    'header a[class*="logo"]',
    '.site-logo',
  ];

  for (const sel of selectors) {
    const el = $(sel);
    if (el.length) {
      const val = el.attr('content') || el.attr('alt') || el.text().trim();
      if (val && val.length < 50) return val;
    }
  }

  // Try to get from page title (usually "Tour Name | Operator Name")
  const title = $('title').text();
  const parts = title.split(/[|\-–]/);
  if (parts.length > 1) return parts[parts.length - 1].trim();

  return null;
}

async function scrapeUrl(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-AU,en;q=0.9',
    },
    timeout: 8000,
  });

  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);

  const html = await response.text();
  const $ = cheerio.load(html);

  $('script, style, noscript, nav, footer, header').remove();

  const getMeta = (name) =>
    $(`meta[name="${name}"], meta[property="${name}"]`).attr('content') || null;

  const bodyText = $('body').text().replace(/\s+/g, ' ').trim();

  // Identity
  const pageTitle = $('title').text().trim() || getMeta('og:title');
  const metaDescription = getMeta('description') || getMeta('og:description');
  const operatorName = extractOperator($);
  const tourTitle = $('h1').first().text().trim() || pageTitle;

  // Prices — focus on the most prominent price on the page
  const priceText = $('[class*="price"], [class*="cost"], [data-testid*="price"], .from-price, .tour-price').first().text().trim();
  const lowSeasonPrice = extractBestPrice(priceText || bodyText);

  // Look for high season price separately
  const highPriceText = bodyText.match(/(?:high\s*season|peak\s*season|from)\s*:?\s*(?:AUD|USD|AU)?\s*\$([\d,]+)/i);
  const highSeasonPrice = highPriceText ? '$' + highPriceText[1] : null;

  // Duration - look in title/heading first, then body
  const headingText = $('h1, h2, .tour-title, .product-title').text();
  const duration = extractDuration(headingText) || extractDuration(bodyText);

  // Price per day
  let pricePerDay = null;
  if (lowSeasonPrice && duration) {
    const days = parseInt(duration);
    const price = parseFloat(lowSeasonPrice.replace(/[^0-9.]/g, ''));
    if (!isNaN(days) && !isNaN(price) && days > 0) {
      pricePerDay = `$${Math.round(price / days).toLocaleString()}`;
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
  $('[class*="destination"], [class*="itinerary"] h3, [class*="day-title"], .stop-name').each((_, el) => {
    const t = $(el).text().trim();
    if (t && t.length < 50) destinations.push(t);
  });

  // JSON-LD
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
    lowSeasonPrice: ldPrice ? `$${ldPrice}` : lowSeasonPrice,
    highSeasonPrice,
    pricePerDay,
    allPrices: [],
    duration,
    tourStyle: extractTourStyle(bodyText),
    groupSize: extractGroupSize(bodyText),
    starRating: extractStarRating(bodyText),
    meals: extractMealCounts(bodyText),
    transport: extractTransport(bodyText),
    hasFlightsIncluded: /flight(s)?\s*included|international\s*flight|includes?\s*flights?/i.test(bodyText),
    hasFreeDay: /free\s*day|leisure\s*day|day\s*at\s*leisure/i.test(bodyText),
    hasWelcomeDinner: /welcome\s*dinner/i.test(bodyText),
    hasSingleSupplement: /single\s*supplement/i.test(bodyText),
    inclusions: inclusions.slice(0, 8),
    destinations: destinations.slice(0, 10),
  };
}

module.exports = { scrapeUrl };