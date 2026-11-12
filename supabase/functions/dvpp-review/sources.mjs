export const catalogUrl = 'https://www.kcv.cz/dvpp/vzdelavaci-programy/';
export const formats = ['Konference', 'Přednáška', 'Seminář', 'Workshop', 'Metodické setkání', 'On-line zdroj', 'E-learning', 'Publikace'];
const hosts = new Set([
  'kcv.cz', 'www.kcv.cz', 'edu.gov.cz', 'www.edu.gov.cz', 'msmt.gov.cz', 'www.msmt.gov.cz',
  'digitalizace.rvp.cz', 'vzdelavame.aidetem.cz', 'educaweek.cz', 'www.educaweek.cz',
  'nakopnetesvojiskolu.cz', 'www.nakopnetesvojiskolu.cz', 'ucitel-in.cz', 'www.ucitel-in.cz',
  'zsheureka.cz', 'www.zsheureka.cz', 'npi.cz', 'www.npi.cz',
]);

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

function isoDate(value) {
  const input = String(value ?? '').trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:T|$)/.exec(input);
  const czech = /^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})(?=\s|$)/.exec(input);
  const date = iso ? iso[0].slice(0, 10) : czech && [czech[3], czech[2].padStart(2, '0'), czech[1].padStart(2, '0')].join('-');
  if (!date) return null;
  const parsed = new Date(date + 'T00:00:00Z');
  return Number.isFinite(+parsed) && parsed.toISOString().slice(0, 10) === date ? date : null;
}

export function catalogEntries(html) {
  const entries = new Map();
  for (const card of html.split(/<div\b[^>]*\bdata-elementor-type=["']loop-item["'][^>]*>/i).slice(1)) {
    const match = /<a\b[^>]*\bhref=["']([^"']+\/dvpp\/program\/[^"']+)["']/i.exec(card);
    const url = match && allowedUrl(match[1], catalogUrl);
    const title = plain(card.match(/<h5\b[^>]*>([\s\S]*?)<\/h5>/i)?.[1]);
    const rawFormat = plain(card.match(/<span\b[^>]*class=["']forma_akce_vypis[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1]);
    const format = formats.includes(rawFormat) ? rawFormat : ({Webinář: 'On-line zdroj', Kurz: 'Seminář'})[rawFormat];
    const event_date = isoDate(plain(card.match(/fa-calendar-alt[^>]*><\/i>\s*<\/span>\s*<span[^>]*>([^<]+)/i)?.[1]));
    if (url && title && format && event_date) entries.set(urlKey(url.href), {url: url.href, title, format, event_date});
  }
  return [...entries.values()];
}

export function sourceFields(html, source) {
  const nodes = [];
  function collect(node) {
    if (Array.isArray(node)) node.forEach(collect);
    else if (node && typeof node === 'object') {
      nodes.push(node);
      if (node['@graph']) collect(node['@graph']);
    }
  }
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { collect(JSON.parse(match[1])); } catch { /* invalid source metadata */ }
  }
  const types = node => [node['@type']].flat().map(x => String(x).split('/').pop());
  const events = nodes.filter(n => types(n).some(type => /Event$/.test(type)) && n.name);
  if (events.length > 1) return {ambiguous: true};
  const event = events[0];
  const article = nodes.find(n => types(n).some(type => /(?:Article|BlogPosting)$/.test(type)));
  const head = html.split(/<\/head>/i, 1)[0];
  function meta(name) {
    for (const match of head.matchAll(/<meta\b[^>]*>/gi)) {
      const attrs = Object.fromEntries([...match[0].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)]
        .map(([, key, double, single]) => [key.toLowerCase(), double ?? single]));
      if ((attrs.property ?? attrs.name) === name) return attrs.content;
    }
  }
  const program = new URL(source).hostname.endsWith('kcv.cz') && new URL(source).pathname.startsWith('/dvpp/program/');
  const title = plain(event?.name ?? article?.headline ?? meta('og:title')).replace(program ? /\s*\|\s*KCV DVPP$/i : /$^/, '');
  const description = plain(event?.description ?? article?.description ?? meta('og:description') ?? meta('description'));
  return {
    title: title && title.length <= 200 ? title : null,
    description: description.length >= 40 ? description.slice(0, 1000) : null,
    event_date: isoDate(event?.startDate),
    ambiguous: Boolean(event?.eventStatus && /(?:Cancelled|Postponed|Rescheduled)$/.test(event.eventStatus)),
  };
}
