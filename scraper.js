const fetch = require('node-fetch');
const cheerio = require('cheerio');

function findPrices(text) {
  const prices = [];
  const regex = /(?:AUD|USD|AU|NZD)?\s*\$\s*([\d,]+(?:\.\d{2})?)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const num = parseFloat(match[1].replace(/,/g, ''));
    if (num >= 300 && num <= 100000) {
      prices.push({ raw: `$${match[1]}`, num });
    }
  }
  return prices.sort((a, b) => a.num - b.num);
}

function extractPrices(text, $) {
  // Try structured price elements first
  const priceSelectors = [
    '[class*="price"]', '[class*="cost"]', '[data-testid*="price"]',
    '.from-price', '.tour-price', '.product-price', '[class*="amount"]',
    '[class*="fare"]', '[class*="rate"]'
  ];

  let priceNums = [];
  for (const sel of priceSelectors) {
    $(sel).each((_, el) => {
      const t = $(el).text().trim();
      const found = findPrices(t);
      priceNums.push(...found);
    });
  }

  // Also scan full body
  const bodyPrices = findPrices(text);
  priceNums.push(...bodyPrices);

  // Deduplicate
  const seen = new Set();
  priceNums = priceNums.filter(p => {
    if (seen.has(p.num)) return false;
    seen.add(p.num);
    return true;
  }).sort((a, b) => a.num - b.num);

  if (!priceNums.length) return { low: null, high: null };

  // Low = smallest realistic price, High = largest
  return {
    low: priceNums[0].raw,
    high: priceNums[priceNums.length - 1].raw !== priceNums[0].raw
      ? priceNums[priceNums.length - 1].raw
      : null
  };
}

function extractDuration(text) {
  const patterns = [
    /\b(\d+)\s*-?\s*day\s*(?:tour|trip|journey|itinerary)?/i,
    /\b(\d+)\s*days?\s*[&\/]\s*\d+\s*nights?/i,
    /\b(\d+)\s*nights?\b/i,
    /duration\s*:?\s*(\d+)\s*days?/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const num = parseInt(match[1]);
      if (num >= 2 && num <= 60) return num;
    }
  }
  return null;
}

function extractGroupSize($, bodyText) {
  let min = null;
  let max = null;

  const patterns = [
    { regex: /max(?:imum)?\s*(?:group\s*size)?\s*:?\s*(\d+)/i, type: 'max' },
    { regex: /up\s*to\s*(\d+)\s*(?:people|pax|guests|travelers)/i, type: 'max' },
    { regex: /limited\s*to\s*(\d+)/i, type: 'max' },
    { regex: /group\s*size\s*:?\s*(\d+)/i, type: 'max' },
    { regex: /min(?:imum)?\s*(?:group\s*size)?\s*:?\s*(\d+)/i, type: 'min' },
    { regex: /from\s*(\d+)\s*(?:people|pax|guests)/i, type: 'min' },
    { regex: /(\d+)\s*-\s*(\d+)\s*(?:people|pax|guests|travelers)/i, type: 'range' },
  ];

  for (const { regex, type } of patterns) {
    const match = bodyText.match(regex);
    if (match) {
      if (type === 'max') {
        const num = parseInt(match[1]);
        if (num >= 2 && num <= 200) max = num;
      } else if (type === 'min') {
        const num = parseInt(match[1]);
        if (num >= 1 && num <= 50) min = num;
      } else if (type === 'range') {
        const n1 = parseInt(match[1]);
        const n2 = parseInt(match[2]);
        if (n1 >= 1 && n1 <= 50) min = n1;
        if (n2 >= 2 && n2 <= 200) max = n2;
      }
    }
  }

  if (min && max) return `${min}–${max}`;
  if (max) return `Max ${max}`;
  if (min) return `Min ${min}`;
  return null;
}

function extractStarRating(text) {
  const patterns = [
    /(\d)\s*-?\s*star\s*(?:hotel|accommodation|property|room|resort)/i,
    /(\d)\s*★\s*(?:hotel|accommodation)?/i,
    /accommodation\s*:?\s*(\d)\s*star/i,
    /staying\s*in\s*(\d)\s*star/i,
    /(\d)\s*star\s*(?:standard|rated|level)/i,
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
    'small group', 'private', 'luxury', 'premium',
    'deluxe', 'budget', 'adventure', 'cultural',
    'family', 'escorted', 'self-guided',
  ];
  const found = styles.filter(s => new RegExp('\\b' + s + '\\b', 'i').test(text));
  return found.length ? found.slice(0, 3).join(', ') : null;
}

function extractMeals(text) {
  const results = [];

  // Try to find specific counts first
  const breakfastMatch = text.match(/(\d+)\s*x?\s*breakfasts?/i);
  const lunchMatch = text.match(/(\d+)\s*x?\s*lunches?/i);
  const dinnerMatch = text.match(/(\d+)\s*x?\s*dinners?/i);

  if (breakfastMatch) results.push(`${breakfastMatch[1]}B`);
  if (lunchMatch) results.push(`${lunchMatch[1]}L`);
  if (dinnerMatch) results.push(`${dinnerMatch[1]}D`);

  if (results.length) return results.join(', ');

  // Check for "all meals included"
  if (/all\s*meals\s*(?:included|provided)/i.test(text)) return 'All meals';

  // Fall back to simple mentions
  const mentions = [];
  if (/\bbreakfast\b/i.test(text)) mentions.push('B');
  if (/\blunch\b/i.test(text)) mentions.push('L');
  if (/\bdinner\b/i.test(text)) mentions.push('D');

  return mentions.length ? mentions.join(', ') + ' (counts not listed)' : null;
}

function extractTransport(text) {
  const types = [
    { key: 'coach', label: 'Coach' },
    { key: 'train', label: 'Train' },
    { key: 'flight', label: 'Flight' },
    { key: 'ferry', label: 'Ferry' },
    { key: 'cruise', label: 'Cruise' },
    { key: 'shinkansen', label: 'Shinkansen' },
    { key: 'cable car', label: 'Cable Car' },
    { key: 'boat', label: 'Boat' },
  ];
  const found = types.filter(t => new RegExp('\\b' + t.key + '\\b', 'i').test(text));
  return found.length ? found.map(t => t.label).join(', ') : null;
}

function extractOperator($, url) {
  const selectors = [
    'meta[property="og:site_name"]',
    '.operator-name', '.brand-name', '.company-name',
    'header .logo img[alt]', '.site-logo img[alt]',
    '[class*="logo"] img[alt]',
  ];

  for (const sel of selectors) {
    const el = $(sel);
    if (el.length) {
      const val = el.attr('content') || el.attr('alt') || el.text().trim();
      if (val && val.length > 1 && val.length < 60) return val.trim();
    }
  }

  // Extract from page title "Tour Name | Operator"
  const title = $('title').text();
  const parts = title.split(/[|\-–]/);
  if (parts.length > 1) {
    const last = parts[parts.length - 1].trim();
    if (last.length > 1 && last.length < 60) return last;
  }

  // Fall back to domain name
  try {
    const hostname = new URL(url).hostname.replace('www.', '');
    const domain = hostname.split('.')[0];
    return domain.charAt(0).toUpperCase() + domain.slice(1);
  } catch { return null; }
}

function extractDepartures(text) {
  // Look for number of departures mentioned
  const patterns = [
    /(\d+)\s*departures?/i,
    /(\d+)\s*departure\s*dates?/i,
    /departs?\s*(\d+)\s*times?/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const num = parseInt(match[1]);
      if (num >= 1 && num <= 365) return `${num} departures`;
    }
  }
  return null;
}

function extractTransfers(text) {
  if (/(?:private|airport)\s*(?:arrival|departure|return)?\s*transfers?\s*(?:included|provided)/i.test(text)) return true;
  if (/transfers?\s*(?:to\/from|to and from)\s*(?:airport|hotel)/i.test(text)) return true;
  if (/(?:arrival|departure)\s*transfers?\s*(?:included|provided)/i.test(text)) return true;
  return false;
}

function extractHighlights($, bodyText) {
  const highlights = [];

  // Try structured highlights/USP sections first
  const selectors = [
    '[class*="highlight"] li',
    '[class*="feature"] li',
    '[class*="usp"] li',
    '[class*="key-point"] li',
    '[class*="selling-point"] li',
    '.trip-highlights li',
    '.tour-highlights li',
  ];

  for (const sel of selectors) {
    $(sel).each((_, el) => {
      const t = $(el).text().trim();
      if (t && t.length > 5 && t.length < 150) highlights.push(t);
    });
    if (highlights.length >= 5) break;
  }

  // If nothing found, look for bold/strong text as likely highlights
  if (!highlights.length) {
    $('strong, b').each((_, el) => {
      const t = $(el).text().trim();
      if (t.length > 10 && t.length < 100 && !/cookie|privacy|terms/i.test(t)) {
        highlights.push(t);
      }
    });
  }

  return highlights.slice(0, 5);
}

function extractFlightsIncluded(text) {
  // Only YES if international airfares explicitly included
  if (/international\s*(?:flights?|airfares?)\s*(?:included|provided)/i.test(text)) return true;
  if (/(?:includes?|including)\s*international\s*(?:flights?|airfares?)/i.test(text)) return true;
  if (/return\s*(?:international)?\s*(?:flights?|airfares?)\s*(?:ex|from)\s*(?:australia|sydney|melbourne|brisbane|perth|auckland)/i.test(text)) return true;
  return false;
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

  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const html = await response.text();
  const $ = cheerio.load(html);

  $('script, style, noscript').remove();

  const getMeta = (name) =>
    $(`meta[name="${name}"], meta[property="${name}"]`).attr('content') || null;

  const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
  const headingText = $('h1, h2, h3').text().replace(/\s+/g, ' ');

  // Identity
  const pageTitle = $('title').text().trim() || getMeta('og:title');
  const metaDescription = getMeta('description') || getMeta('og:description');
  const operatorName = extractOperator($, url);
  const tourTitle = $('h1').first().text().trim() || pageTitle;

  // Prices
  const { low: lowSeasonPrice, high: highSeasonPrice } = extractPrices(bodyText, $);

  // Duration
  const durationDays = extractDuration(headingText) || extractDuration(bodyText);
  const duration = durationDays ? `${durationDays} days` : null;

  // Price per day (low and high)
  let pricePerDayLow = null;
  let pricePerDayHigh = null;
  if (durationDays) {
    if (lowSeasonPrice) {
      const p = parseFloat(lowSeasonPrice.replace(/[^0-9.]/g, ''));
      if (!isNaN(p)) pricePerDayLow = `$${Math.round(p / durationDays).toLocaleString()}`;
    }
    if (highSeasonPrice) {
      const p = parseFloat(highSeasonPrice.replace(/[^0-9.]/g, ''));
      if (!isNaN(p)) pricePerDayHigh = `$${Math.round(p / durationDays).toLocaleString()}`;
    }
  }

  // Inclusions
  const inclusions = [];
  $('[class*="inclusions"] li, [class*="included"] li, [class*="whats-included"] li').each((_, el) => {
    const t = $(el).text().trim();
    if (t) inclusions.push(t);
  });

  // Destinations
  const destinations = [];
  $('[class*="destination"], [class*="itinerary"] h3, [class*="day-title"]').each((_, el) => {
    const t = $(el).text().trim();
    if (t && t.length < 50) destinations.push(t);
  });

  return {
    url,
    scrapedAt: new Date().toISOString(),
    pageTitle,
    tourTitle,
    operatorName,
    metaDescription,

    // Pricing
    lowSeasonPrice,
    highSeasonPrice,
    pricePerDayLow,
    pricePerDayHigh,

    // Tour details
    duration,
    tourStyle: extractTourStyle(bodyText),
    groupSize: extractGroupSize($, bodyText),
    starRating: extractStarRating(bodyText),

    // Inclusions
    meals: extractMeals(bodyText),
    transport: extractTransport(bodyText),
    hasFlightsIncluded: extractFlightsIncluded(bodyText),
    hasTransfers: extractTransfers(bodyText),
    hasFreeDay: /free\s*day|leisure\s*day|day\s*at\s*leisure/i.test(bodyText),
    hasWelcomeDinner: /welcome\s*dinner/i.test(bodyText),
    hasSingleSupplement: /single\s*supplement/i.test(bodyText),

    // New fields
    departures: extractDepartures(bodyText),
    highlights: extractHighlights($, bodyText),
    inclusions: inclusions.slice(0, 8),
    destinations: destinations.slice(0, 10),
  };
}

module.exports = { scrapeUrl };