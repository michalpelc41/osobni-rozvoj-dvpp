import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import {allowedUrl, knownTitle, sourceDescription, sources, titleKey, urlKey} from './sources.mjs';

const dateInPrague = (date: Date) => new Intl.DateTimeFormat('sv-SE', {timeZone: 'Europe/Prague'}).format(date);

async function fetchPage(source: string) {
  let url = allowedUrl(source);
  const signal = AbortSignal.timeout(8000);
  for (let redirects = 0; url && redirects <= 4; redirects++) {
    const response = await fetch(url, {
      redirect: 'manual', signal, headers: {Accept: 'text/html, application/xhtml+xml, application/rss+xml, application/xml, text/xml'},
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('Location');
      await response.body?.cancel();
      url = location ? allowedUrl(location, url) : null;
      continue;
    }
    if (!response.ok || !/^(?:text\/(?:html|xml)|application\/(?:xhtml\+xml|rss\+xml|xml))\b/i.test(response.headers.get('Content-Type') ?? '')) {
      await response.body?.cancel();
      throw Error(response.ok ? 'Zdroj neposkytuje podporovaný obsah.' : 'Zdroj vrátil HTTP ' + response.status + '.');
    }
    const reader = response.body?.getReader();
    if (!reader) throw Error('Zdroj neposkytuje obsah.');
    const decoder = new TextDecoder();
    let size = 0;
    let html = '';
    try {
      while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 1_500_000) throw Error('Zdroj je příliš rozsáhlý pro automatickou kontrolu.');
        html += decoder.decode(value, {stream: true});
      }
    } finally {
      await reader.cancel();
    }
    return {url: url.href, html: html + decoder.decode()};
  }
  throw Error('Odkaz nebo jeho přesměrování vede mimo podporované zdroje.');
}

async function digest(value: unknown) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return new Response(null, {status: 405});
  const token = request.headers.get('X-DVPP-Job');
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return new Response(null, {status: 401});

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    {auth: {persistSession: false, autoRefreshToken: false}});
  const today = dateInPrague(new Date());
  const monday = new Date(today + 'T12:00:00Z');
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
  const week = monday.toISOString().slice(0, 10);

  try {
    const auth = await db.rpc('dvpp_validate_review_job', {p_token: token, p_week: week});
    if (auth.error) throw auth.error;
    if (!auth.data) return new Response(null, {status: 403});

    EdgeRuntime.waitUntil(generateReport(db, today, week));
    return Response.json({queued: true}, {status: 202});
  } catch (error) {
    logError(error);
    return Response.json({error: 'Review failed'}, {status: 500});
  }
});

function logError(error: unknown) {
  console.error('DVPP review failed', error instanceof Error ? error.message : String((error as {code?: string}).code ?? 'unknown'));
}

async function generateReport(db: ReturnType<typeof createClient>, today: string, week: string) {
  try {
    const knownUrls = new Set<string>();
    const knownTitles = new Set<string>();
    for (const table of ['dvpp_ideas', 'dvpp_idea_review_items']) {
      const previous = table === 'dvpp_idea_review_items';
      for (let offset = 0; ; offset += 500) {
        let query = db.from(table).select(previous ? 'title,source' : 'title,url');
        if (previous) query = query.eq('kind', 'new');
        const {data, error} = await query.order('id').range(offset, offset + 499);
        if (error) throw error;
        for (const row of data as unknown as {title: string; source?: string; url?: string}[]) {
          const url = row.source ?? row.url ?? '';
          if (previous && !allowedUrl(url)) continue;
          knownUrls.add(urlKey(url));
          knownTitles.add(titleKey(row.title));
        }
        if (data.length < 500) break;
      }
    }

    const catalogs = await Promise.all(sources.map(async source => {
      try {
        const {html} = await fetchPage(source.url);
        const entries = source.read(html);
        return {name: source.name, available: true, entries: entries
          .filter(entry => entry.event_date && entry.event_date >= today &&
            !knownUrls.has(urlKey(entry.url)) && !knownTitle(entry.title, knownTitles))
          .sort((a, b) => a.event_date.localeCompare(b.event_date))};
      } catch (error) {
        console.warn('DVPP catalog unavailable', source.name, error instanceof Error ? error.message : '');
        return {name: source.name, available: false, entries: []};
      }
    }));
    if (catalogs.every(catalog => !catalog.available)) throw Error('Žádný katalog není dostupný.');

    // Round-robin between publishers, favoring a format that is not yet represented.
    const suggestions = [];
    const types = new Set();
    for (let round = 0; round < 5 && suggestions.length < 5; round++) {
      const picks = await Promise.all(catalogs.map(async catalog => {
        const index = catalog.entries.findIndex(entry => !types.has(entry.type));
        const [entry] = catalog.entries.splice(Math.max(index, 0), 1);
        if (!entry || knownUrls.has(urlKey(entry.url)) || knownTitle(entry.title, knownTitles)) return null;
        const page = await fetchPage(entry.url).catch(() => null);
        if (!page || knownUrls.has(urlKey(page.url))) return null;
        const description = entry.description || sourceDescription(page.html, page.url);
        if (description.length < 40) return null;
        return {entry, publisher: catalog.name, source: page.url, description};
      }));
      for (const pick of picks) {
        if (!pick || suggestions.length >= 5) continue;
        const {entry, publisher, source, description} = pick;
        if (knownUrls.has(urlKey(source)) || knownTitle(entry.title, knownTitles)) continue;
        suggestions.push({
          kind: 'new', title: entry.title, source, note: publisher + ' · ' + entry.type,
          fingerprint: await digest(['new', urlKey(source)]),
          proposed: {title: entry.title, url: source, format: entry.format, event_date: entry.event_date, description: description.slice(0, 700)},
        });
        knownUrls.add(urlKey(source));
        knownTitles.add(titleKey(entry.title));
        types.add(entry.type);
      }
    }

    const unavailable = catalogs.filter(catalog => !catalog.available).map(catalog => catalog.name);
    const result = await db.rpc('dvpp_save_review_run', {
      p_week: week,
      p_summary: {mode: 'external', suggested: suggestions.length, unavailable},
      p_items: suggestions,
    });
    if (result.error) throw result.error;
  } catch (error) {
    logError(error);
  }
}
