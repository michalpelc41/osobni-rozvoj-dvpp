const npiUrl = 'https://mojeedu.npi.cz/cela-nabidka?orderby_sec=rdate';
const recordingsUrl = 'https://mojeedu.npi.cz/zaznamy-webinaru';
const ministryUrl = 'https://edu.gov.cz/feed/';
const aiUrl = 'https://vzdelavame.aidetem.cz/akce/';
const rvpUrl = 'https://revize.rvp.cz/zv/vse-o-revizi-zv/aktuality-a-udalosti';
const inspectionUrl = 'https://www.csicr.cz/cz/Aktuality';
const hosts = new Set(['revize.rvp.cz', 'csicr.cz', 'www.csicr.cz', new URL(npiUrl).hostname, new URL(ministryUrl).hostname, 'www.edu.gov.cz', new URL(aiUrl).hostname]);
const czechMonths = ['ledna', 'února', 'března', 'dubna', 'května', 'června', 'července', 'srpna', 'září', 'října', 'listopadu', 'prosince'];
const monthPattern = czechMonths.join('|');
const eventTypes = [
  [/konferenc|festival|summit/i, 'Konference', 'Konference'],
  [/webinář/i, 'Webinář', 'On-line zdroj'],
  [/workshop/i, 'Workshop', 'Workshop'],
  [/e-learning|samostudi/i, 'E-learning', 'E-learning'],
  [/kurz|vzdělávací program/i, 'Kurz', 'Seminář'],
  [/metodické setkání|kolegiální sdílení/i, 'Metodické setkání', 'Metodické setkání'],
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
  return {url: url.href, title, type: type[1], format: type[2], event_date: eventDate(rawDate), description, group: 'Akce'};
}

function npiEntries(html, recordings = false) {
  return [...html.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)].map(([, card]) => {
    const link = card.match(/href="(\/produkt\/[^"]+)"/)?.[1];
    const title = card.match(/<span class="sr-only">([^<]+)/)?.[1];
    const type = card.match(/class="text-nadpisek[^"]*">([^<]+)/)?.[1];
    const date = plain(card.match(/<li\b[^>]*>([\s\S]*?)<\/li>/i)?.[1]);
    if (!link) return null;
    return recordings
      ? resource(recordingsUrl, link, title, 'Záznam webináře', eventDate(date), '')
      : entry(npiUrl, link, title, type, date);
  }).filter(Boolean);
}

function ministryEntries(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map(([, item]) => {
    const read = tag => item.match(new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>', 'i'))?.[1]
      ?.trim().replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1') ?? '';
    const title = plain(read('title'));
    const description = plain(read('description'));
    const published = new Date(read('pubDate'));
    const referenceDate = Number.isFinite(+published) ? published.toISOString().slice(0, 10) : null;
    const content = plain(read('content:encoded'));
    // Use dates stated as event dates, not publication dates or registration deadlines.
    const dates = [...content.matchAll(/(?:se koná|se uskuteční|se bude konat|proběhne|termín konání\s*:)[^.!?\d]{0,70}(\d{1,2}\.\s*(?:\d{1,2}\.\s*|[a-zá-ž]+\s+)\d{4})/gi)]
      .map(match => match[1]);
    const distinctDates = new Set(dates.map(eventDate).filter(Boolean));
    if (/záznam|ze záznamu/i.test(title) && /webinář|online seminář/i.test(title + ' ' + description)) {
      if (distinctDates.size !== 1) return null;
      return resource(ministryUrl, read('link'), title, 'Záznam webináře', [...distinctDates][0], description);
    }
    if (eventTypes.some(([pattern]) => pattern.test(title)) || /pozvánka/i.test(title)) {
      return distinctDates.size === 1 && entry(ministryUrl, read('link'), title, title, dates[0], description);
    }
    if (!/rvp|kurikul|pedagog|učitel|ředitel|metodik|podpor[a-zá-ž]* škol|výzkum|šetření/i.test(title + ' ' + description)) return null;
    const type = /metodik|metodické pokyny/i.test(title) ? 'Metodika' :
      /výzkum|šetření|studie/i.test(title) ? 'Výzkum' : 'Novinka MŠMT';
    return resource(ministryUrl, read('link'), title, type, referenceDate, description);
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

function resource(base, link, heading, type, referenceDate, description) {
  const url = allowedUrl(plain(link), base);
  const title = plain(heading);
  if (!url || !title || title.length > 200) return null;
  const group = type.startsWith('Novinka') ? 'Novinky' : type;
  return {url: url.href, title, type, format: type === 'Výzkum' ? 'Publikace' : 'On-line zdroj',
    event_date: null, referenceDate, group, description};
}

function rvpEntries(html) {
  return [...html.matchAll(/<h3\s+class\s*=\s*"entry-title">\s*<a\s+href\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h3>([\s\S]*?)(?=<h3|$)/gi)]
    .map(([, link, heading, metadata]) => {
      if (!link.includes('/blog/')) return null;
      const title = plain(heading);
      const description = plain(metadata.match(/<p\s+class\s*=\s*"entry-body__text">([\s\S]*?)<\/p>/i)?.[1]);
      if (/záznam|ze záznamu/i.test(title + ' ' + description)) {
        const date = (title + ' ' + description).match(/(?:konal[a-z]* se|proběhl[a-z]*|ze dne)\s+(\d{1,2}\.\s*(?:\d{1,2}\.\s*|[a-zá-ž]+\s+)\d{4})/i)?.[1];
        return date && resource(rvpUrl, link, title, 'Záznam webináře', eventDate(date), description);
      }
      if (/pozvánka|přihlaste se/i.test(title)) return null;
      return resource(rvpUrl, link, title, /plán[ůyu]|materiál|zdroj|metodik/i.test(title) ? 'Metodika' : 'Novinka k RVP', null, description);
    }).filter(Boolean);
}

function inspectionEntries(html) {
  return [...html.matchAll(/<h2 class="h5"><a href="([^"]+)">([\s\S]*?)<\/a><\/h2>\s*<div class="news-item-date">([^<]+)<\/div>\s*<div class="news-item-perex">([\s\S]*?)<\/div>/gi)]
    .map(([, link, title, date, description]) => {
      if (!/šetření|zpráva|výzkum|analýz|kvalit.*vzděláván/i.test(plain(title))) return null;
      return resource(inspectionUrl, link, title, 'Výzkum', eventDate(date.trim()), plain(description));
    }).filter(Boolean);
}

export function monthsBefore(today, count) {
  const [year, month, day] = today.split('-').map(Number);
  const end = new Date(Date.UTC(year, month - count, 0));
  end.setUTCDate(Math.min(day, end.getUTCDate()));
  return end.toISOString().slice(0, 10);
}

export function isTimely(entry, today) {
  if (entry.group === 'Akce') return Boolean(entry.event_date && entry.event_date >= today);
  if (entry.group === 'Záznam webináře') {
    return Boolean(entry.referenceDate && entry.referenceDate <= today && entry.referenceDate >= monthsBefore(today, 6));
  }
  return !entry.referenceDate || (entry.referenceDate <= today && entry.referenceDate >= monthsBefore(today, 6));
}

const topics = [
  [/\b(?:rvp|švp)\b|kurikul/i, 'Téma se hodí při plánování podpory škol při práci s RVP a ŠVP.'],
  [/profesní rozvoj|vedení škol|ředitel|pedagogick[áé] vedení/i, 'Pro garanty je to podklad k plánování podpory učitelů a vedení škol.'],
  [/uměl[áéou] inteligenc|\bai\b|digitál/i, 'Tip lze využít při přípravě vzdělávání k využití digitálních nástrojů ve výuce.'],
  [/inklu|wellbeing|duševní|bezpeč|poraden/i, 'Tip lze využít při plánování podpory škol a učitelů v této oblasti.'],
];

export function relevance(entry) {
  const topical = topics.reduce((score, [pattern]) => score + Number(pattern.test(entry.title + ' ' + entry.description)), 0);
  return topical * 2 + Number(/metodik|hodnocení|didaktik|učitel|výuk|škol/i.test(entry.title));
}

const sentenceSegments = new Intl.Segmenter('cs', {granularity: 'sentence'});

export function summarize(entry, description) {
  const protectedText = plain(description).split(/\s*(?:\[…\]|\[\.\.\.\]|…\s+Článek|Článek .+ se nejdříve objevil)/i, 1)[0].slice(0, 4000)
    .replace(/\b(např|tzv|tj|tzn|resp|Mgr|Ing|PhDr|Ph\.D|č)\./giu, '$1\uE000')
    .replace(/(\d)\.(?=\s*(?:\d|ledna|února|března|dubna|května|června|července|srpna|září|října|listopadu|prosince))/giu, '$1\uE000');
  const sentences = [...sentenceSegments.segment(protectedText)]
    .map(({segment}) => segment.trim().replaceAll('\uE000', '.'))
    .filter(sentence => sentence.length >= 35 && sentence.length <= 245 &&
      /[.!]$/.test(sentence) && !/(?:\.{2,}|…)\s*$/.test(sentence) &&
      !/^(přihlaste se|registrujte se|více informací|zveme vás|dozvědět se více|přečtěte si|na této stránce|vítáme vás)/i.test(sentence))
    .map(sentence => sentence.replace(/^V rámci (webináře|semináře|workshopu|kurzu) se /i,
      (_, form) => 'Na ' + ({webináře: 'webináři', semináře: 'semináři', workshopu: 'workshopu', kurzu: 'kurzu'})[form.toLowerCase()] + ' se '));
  const selected = [...new Set(sentences)].slice(0, 2);
  if (!selected.length) return '';
  if (selected.length === 1) {
    selected.push(topics.find(([pattern]) => pattern.test(entry.title + ' ' + description))?.[1] ??
      (entry.group === 'Výzkum'
        ? 'Zjištění mohou garantům posloužit při výběru témat pro další vzdělávání pedagogů.'
        : 'Garantům může tip posloužit při výběru témat pro další vzdělávání pedagogů.'));
  }
  return selected.join(' ');
}

function recordingPages(html) {
  const navigation = html.match(/<nav\b[^>]*aria-label="Stránkování"[^>]*>([\s\S]*?)<\/nav>/i)?.[1] ?? '';
  const lastPage = Math.max(1, ...[...navigation.matchAll(/<button\b[^>]*>\s*(\d+)\s*<\/button>/gi)].map(match => Number(match[1])));
  if (lastPage === 1) return [];
  return [lastPage, lastPage - 1].map(page => recordingsUrl + '?page=' + page);
}

export const sources = [
  {name: 'NPI / Revize RVP', url: rvpUrl, read: rvpEntries},
  {name: 'Česká školní inspekce', url: inspectionUrl, read: inspectionEntries},
  {name: 'MŠMT / Edu.cz', url: ministryUrl, read: ministryEntries},
  {name: 'NPI / MojeEdu', url: npiUrl, read: npiEntries},
  {name: 'NPI / Záznamy webinářů', url: recordingsUrl, read: html => npiEntries(html, true), pages: recordingPages},
  {name: 'AI dětem', url: aiUrl, read: aiEntries},
];

export function sourceDescription(html, source) {
  if (new URL(source).hostname === 'mojeedu.npi.cz') {
    const body = html.match(/<div class="prose max-w-none">([\s\S]*?)<\/div>/i)?.[1];
    if (body) return plain(body);
  }
  if (new URL(source).hostname === 'revize.rvp.cz') {
    const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1];
    const paragraphs = [...(main ?? '').matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map(([, value]) => plain(value))
      .filter(paragraph => paragraph.length >= 70);
    if (paragraphs.length) return paragraphs.slice(0, 5).join(' ');
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
