const npiUrl = 'https://mojeedu.npi.cz/cela-nabidka?orderby_sec=rdate';
const ministryUrl = 'https://edu.gov.cz/feed/';
const aiUrl = 'https://vzdelavame.aidetem.cz/akce/';
const hosts = new Set([new URL(npiUrl).hostname, new URL(ministryUrl).hostname, 'www.edu.gov.cz', new URL(aiUrl).hostname]);
const czechMonths = ['ledna', 'února', 'března', 'dubna', 'května', 'června', 'července', 'srpna', 'září', 'října', 'listopadu', 'prosince'];
const monthPattern = czechMonths.join('|');
const eventTypes = [
  [/konferenc|festival|summit/i, 'Konference', 'Konference'],
  [/webinář/i, 'Webinář', 'On-line zdroj'],
  [/workshop/i, 'Workshop', 'Workshop'],
  [/e-learning|samostudi/i, 'E-learning', 'E-learning'],
  [/kurz|vzdělávací program/i, 'Kurz', 'Seminář'],
  [/seminář/i, 'Seminář', 'Seminář'],
  [/přednášk/i, 'Přednáška', 'Přednáška'],
];

export function allowedUrl(value, base) {
  try {
    const url = new URL(value, base);
    if (url.protocol === 'https:' && !url.port && !url.username && !url.password && hosts.has(url.hostname)) return url;
  } catch { /* invalid URL */ }
  return null;
}

export function urlKey(value) {
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return url.hostname.replace(/^www\./, '') + url.pathname.replace(/\/$/, '') + url.search;
  } catch { return ''; }
}

const entities = {amp: '&', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', lt: '<', gt: '>'};
function plain(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/<[^>]*>/g, ' ').replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, key) => {
    if (key[0] !== '#') return entities[key] ?? match;
    const n = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : match;
  }).replace(/\s+/gu, ' ').trim();
}

function eventDate(value) {
  const numeric = /^(\d{1,2})\.\s*(\d{1,2})\.\s*(?:[–—-]\s*\d{1,2}\.\s*\d{1,2}\.\s*)?(\d{4})\b/.exec(value);
  const named = new RegExp('^(\\d{1,2})\\.\\s*(' + monthPattern + ')\\s+(\\d{4})\\b', 'i').exec(value);
  if (!numeric && !named) return null;
  const [day, month, year] = numeric ? numeric.slice(1) : [named[1], czechMonths.indexOf(named[2].toLowerCase()) + 1, named[3]];
  const iso = [year, String(month).padStart(2, '0'), day.padStart(2, '0')].join('-');
  const date = new Date(iso + 'T00:00:00Z');
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === iso ? iso : null;
}

function entry(base, link, heading, rawType, rawDate, description = '') {
  const url = allowedUrl(plain(link), base);
  const title = plain(heading);
  const type = eventTypes.find(([pattern]) => pattern.test(rawType));
  if (!url || !title || title.length > 200 || !type) return null;
  return {url: url.href, title, type: type[1], format: type[2], event_date: eventDate(rawDate), description};
}

function npiEntries(html) {
  return [...html.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)].map(([, card]) => {
    const link = card.match(/href="(\/produkt\/[^"]+)"/)?.[1];
    const title = card.match(/<span class="sr-only">([^<]+)/)?.[1];
    const type = card.match(/class="text-nadpisek[^"]*">([^<]+)/)?.[1];
    const date = plain(card.match(/<li\b[^>]*>([\s\S]*?)<\/li>/i)?.[1]);
    return link && entry(npiUrl, link, title, type, date);
  }).filter(Boolean);
}

function ministryEntries(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map(([, item]) => {
    const read = tag => item.match(new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>', 'i'))?.[1]
      ?.trim().replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1') ?? '';
    const title = read('title');
    const content = plain(read('content:encoded'));
    // Use dates stated as event dates, not publication dates or registration deadlines.
    const dates = [...content.matchAll(/(?:se koná|se uskuteční|se bude konat|proběhne|termín konání\s*:)[^.!?\d]{0,70}(\d{1,2}\.\s*(?:\d{1,2}\.\s*|[a-zá-ž]+\s+)\d{4})/gi)]
      .map(match => match[1]);
    const distinctDates = new Set(dates.map(eventDate).filter(Boolean));
    return distinctDates.size === 1 && entry(ministryUrl, read('link'), title, plain(title), dates[0], plain(read('description')));
  }).filter(Boolean);
}

function aiEntries(html) {
  return [...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*class="product-card\b[^"]*"[^>]*>([\s\S]*?)<\/a>/gi)].map(([, link, card]) => {
    const title = plain(card.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i)?.[1]);
    const date = plain(card.match(/class="product-card__date">([^<]+)/i)?.[1]);
    const audience = /class="tags__item">Pro dospělé</.test(card);
    if (!audience) return null;
    const type = /AI svačinka|AI jednohubky/i.test(title) || link.includes('/webinare/') ? 'Webinář' : title + ' ' + link;
    return entry(aiUrl, link, title, type, date);
  }).filter(Boolean);
}

export const sources = [
  {name: 'MŠMT / Edu.cz', url: ministryUrl, read: ministryEntries},
  {name: 'NPI / MojeEdu', url: npiUrl, read: npiEntries},
  {name: 'AI dětem', url: aiUrl, read: aiEntries},
];

export function sourceDescription(html, source) {
  if (new URL(source).hostname === 'mojeedu.npi.cz') {
    const body = html.match(/<div class="prose max-w-none">([\s\S]*?)<\/div>/i)?.[1];
    if (body) return plain(body);
  }
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = Object.fromEntries([...match[0].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)]
      .map(([, key, double, single]) => [key.toLowerCase(), double ?? single]));
    if (['og:description', 'description'].includes(attrs.property ?? attrs.name) && attrs.content) return plain(attrs.content);
  }
  return '';
}

export function titleKey(title) {
  return title.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

export function knownTitle(title, titles) {
  const key = titleKey(title);
  return [...titles].some(previous => key === previous ||
    (Math.min(key.length, previous.length) >= 20 && (key.startsWith(previous + ' ') || previous.startsWith(key + ' '))));
}
