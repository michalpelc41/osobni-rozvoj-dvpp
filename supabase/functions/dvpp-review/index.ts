import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import {allowedUrl, catalogEntries, catalogUrl, sourceFields, urlKey} from './sources.mjs';

type Idea = {
  id: string;
  title: string;
  description: string;
  event_date: string | null;
  url: string;
};
type Item = {
  kind: 'change' | 'new' | 'manual';
  idea_id?: string;
  title: string;
  field?: string;
  original?: string | null;
  proposed?: unknown;
  source: string;
  note: string;
  fingerprint: string;
};

const dateInPrague = (date: Date) => new Intl.DateTimeFormat('sv-SE', {timeZone: 'Europe/Prague'}).format(date);
const normalize = (value: string) => value.normalize('NFC').replace(/\s+/gu, ' ').trim().toLowerCase();

async function fetchPage(source: string) {
  let url = allowedUrl(source);
  const signal = AbortSignal.timeout(8000);
  for (let redirects = 0; url && redirects <= 4; redirects++) {
    const response = await fetch(url, {
      redirect: 'manual', signal, headers: {Accept: 'text/html, application/xhtml+xml'},
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('Location');
      await response.body?.cancel();
      url = location ? allowedUrl(location, url) : null;
      continue;
    }
    if (!response.ok || !/^(?:text\/html|application\/xhtml\+xml)\b/i.test(response.headers.get('Content-Type') ?? '')) {
      await response.body?.cancel();
      throw Error(response.ok ? 'Zdroj neposkytuje webovou stránku.' : 'Zdroj vrátil HTTP ' + response.status + '.');
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

async function inBatches<T, R>(items: T[], work: (item: T) => Promise<R>) {
  const output: R[] = [];
  for (let i = 0; i < items.length; i += 6) {
    output.push(...await Promise.all(items.slice(i, i + 6).map(work)));
  }
  return output;
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

    const ideas: Idea[] = [];
    for (let offset = 0; ; offset += 500) {
      const {data, error} = await db.from('dvpp_ideas').select('id,title,description,event_date,url')
        .order('id').range(offset, offset + 499);
      if (error) throw error;
      ideas.push(...data);
      if (data.length < 500) break;
    }

    let catalogWarning = '';
    const catalog = await fetchPage(catalogUrl).then(({html}) => {
      const entries = catalogEntries(html);
      if (!entries.length) catalogWarning = 'Katalog KCV neposkytl rozpoznatelné programy s termíny.';
      return entries;
    }).catch(() => {
      catalogWarning = 'Katalog KCV se nepodařilo načíst.';
      return [] as ReturnType<typeof catalogEntries>;
    });
    const catalogByUrl = new Map(catalog.map(entry => [urlKey(entry.url), entry]));
    let reachable = 0;
    const checked = await inBatches(ideas, async idea => {
      const base = {idea_id: idea.id, title: idea.title, source: idea.url};
      const manual = async (note: string): Promise<Item> => ({
        ...base, kind: 'manual', note, fingerprint: await digest(['manual', idea.id, idea.url, note]),
      });
      if (!idea.url) return [await manual('Karta nemá zdrojový odkaz.')];
      if (!allowedUrl(idea.url)) return [await manual('Odkaz je mimo podporované zdroje nebo nepoužívá HTTPS.')];
      let page;
      try { page = await fetchPage(idea.url); }
      catch (error) {
        const note = error instanceof Error && !['TimeoutError', 'AbortError', 'TypeError'].includes(error.name)
          ? error.message : 'Zdroj je dočasně nedostupný.';
        return [await manual(note)];
      }
      reachable++;
      const fields = sourceFields(page.html, page.url);
      const eventDate = fields.event_date ?? catalogByUrl.get(urlKey(page.url))?.event_date ?? null;
      const items: Item[] = [];
      if (fields.ambiguous) {
        items.push(await manual('Zdroj uvádí více akcí, změnu stavu nebo přesun termínu. Ověřte ho ručně.'));
      } else {
        if (!fields.title || !fields.description || (!eventDate && idea.event_date)) {
          items.push(await manual('Na zdroji chybí čitelný název, popis nebo jednoznačný termín uvedený na kartě.'));
        }
        const candidates = {title: fields.title, description: fields.description, event_date: eventDate};
        for (const [field, value] of Object.entries(candidates)) {
          if (!value) continue;
          const original = idea[field as keyof typeof candidates];
          if (normalize(value) === normalize(original ?? '')) continue;
          items.push({...base, kind: 'change', field, original, proposed: value, note: '',
            fingerprint: await digest([idea.id, idea.url, field, original, value])});
        }
      }
      if (urlKey(idea.url) !== urlKey(page.url)) {
        items.push({...base, kind: 'change', field: 'url', original: idea.url, proposed: page.url,
          note: 'Zdroj přesměrovává na tuto adresu.', fingerprint: await digest([idea.id, idea.url, 'url', page.url])});
      }
      return items;
    });

    const knownUrls = new Set(ideas.map(idea => urlKey(idea.url)).filter(Boolean));
    const knownTitles = new Set(ideas.map(idea => normalize(idea.title)));
    const topics = [
      [/digitál|informatik|uměl[áéou] inteligenc|\bAI\b/i, 'Digitální kompetence a využití technologií ve vzdělávání.'],
      [/profesní rozvoj|vedení|mentor|kouč|metodik|lídr/i, 'Vedení škol, metodická podpora nebo profesní rozvoj pedagogů.'],
      [/pedagog|výuk|učitel|učení|vzděláv|škol/i, 'Metody výuky a podpora pedagogů nebo škol.'],
    ] as const;
    const candidates = catalog.filter(entry => entry.event_date >= today && !knownUrls.has(urlKey(entry.url)) &&
      !knownTitles.has(normalize(entry.title))).map(entry => ({
        entry, rank: topics.findIndex(([pattern]) => pattern.test(entry.title)),
      })).filter(({rank}) => rank >= 0)
      .sort((a, b) => a.rank - b.rank || a.entry.event_date.localeCompare(b.entry.event_date));

    const suggestions: Item[] = [];
    for (let i = 0; i < candidates.length && suggestions.length < 5; i += 5) {
      const group = await inBatches(candidates.slice(i, i + 5), async ({entry, rank}) => {
        const fingerprint = await digest(['new', urlKey(entry.url)]);
        const previous = await db.from('dvpp_idea_review_items').select('id').eq('fingerprint', fingerprint).maybeSingle();
        if (previous.error) throw previous.error;
        if (previous.data) return null;
        const page = await fetchPage(entry.url).catch(() => null);
        if (!page) return null;
        const fields = sourceFields(page.html, page.url);
        if (fields.ambiguous || !fields.description) return null;
        return {kind: 'new' as const, title: entry.title, source: entry.url, fingerprint,
          proposed: {...entry, description: fields.description}, note: topics[rank][1]};
      });
      for (const item of group) {
        if (!item || suggestions.length >= 5 || knownTitles.has(normalize(item.title))) continue;
        suggestions.push(item);
        knownTitles.add(normalize(item.title));
      }
    }

    const result = await db.rpc('dvpp_save_review_run', {
      p_week: week, p_summary: {checked: ideas.length, reachable, suggested: suggestions.length, catalogWarning},
      p_items: [...checked.flat(), ...suggestions],
    });
    if (result.error) throw result.error;
    return Response.json({added: result.data});
  } catch (error) {
    console.error('DVPP review failed', error instanceof Error ? error.message : String((error as {code?: string}).code ?? 'unknown'));
    return Response.json({error: 'Review failed'}, {status: 500});
  }
});
