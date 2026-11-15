const sourceHosts = new Set([
  'csicr.cz', 'digitalizace.rvp.cz', 'edu.gov.cz', 'educaweek.cz', 'mojeedu.npi.cz',
  'msmt.gov.cz', 'nakopnetesvojiskolu.cz', 'revize.rvp.cz', 'triucitelky.cz',
  'ucitel-in.cz', 'vzdelavame.aidetem.cz', 'zsheureka.cz',
]);
const imageHosts = new Set(['cdn.myshoptet.com', 'i0.wp.com', 'i1.wp.com', 'i2.wp.com', 'i.ytimg.com']);

function httpsUrl(value, base) {
  try {
    const url = new URL(value, base);
    if (url.protocol === 'https:' && !url.port && !url.username && !url.password) return url;
  } catch { /* Invalid metadata. */ }
  return null;
}

function isSource(url) {
  return sourceHosts.has(url.hostname.replace(/^www\./, ''));
}

export function sourceUrl(value, base) {
  const url = httpsUrl(value, base);
  return url && isSource(url) ? url : null;
}

function decodeAttribute(value) {
  const named = {amp: '&', quot: '"', apos: "'", lt: '<', gt: '>'};
  return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (_, entity) => {
    const key = entity.toLowerCase();
    if (key[0] !== '#') return named[key];
    const code = key[1] === 'x' ? Number.parseInt(key.slice(2), 16) : Number(key.slice(1));
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  });
}

export function shareImage(html, pageUrl) {
  const head = html.split(/<\/head\s*>/i, 1)[0]
    .replace(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  const metadata = new Map();
  for (const [tag] of head.matchAll(/<meta\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi)) {
    const attributes = new Map();
    for (const [, name, double, single, bare] of tag.matchAll(/\s+([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
      attributes.set(name.toLowerCase(), double ?? single ?? bare);
    }
    const name = (attributes.get('property') || attributes.get('name'))?.trim().toLowerCase();
    const value = attributes.get('content')?.trim();
    const image = value && httpsUrl(decodeAttribute(value), pageUrl);
    if (name && image && (isSource(image) || imageHosts.has(image.hostname)) && !metadata.has(name)) {
      metadata.set(name, image.href);
    }
  }
  return metadata.get('og:image:secure_url') || metadata.get('og:image') ||
    metadata.get('og:image:url') || metadata.get('twitter:image') || null;
}

export async function fetchShareImage(value, fetchPage = fetch) {
  let url = sourceUrl(value);
  const signal = AbortSignal.timeout(4500);
  for (let redirects = 0; url && redirects <= 3; redirects++) {
    const response = await fetchPage(url, {
      redirect: 'manual', signal, headers: {Accept: 'text/html, application/xhtml+xml'},
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      url = location ? sourceUrl(location, url) : null;
      continue;
    }
    if (!response.ok || !/^(text\/html|application\/xhtml\+xml)\b/i.test(response.headers.get('content-type') ?? '')) {
      await response.body?.cancel();
      return null;
    }
    const reader = response.body?.getReader();
    if (!reader) return null;
    const decoder = new TextDecoder();
    let html = '';
    let remaining = 256 * 1024;
    try {
      while (remaining > 0 && !/<\/head\s*>/i.test(html)) {
        const {done, value: bytes} = await reader.read();
        if (done) break;
        html += decoder.decode(bytes.subarray(0, remaining), {stream: true});
        remaining -= bytes.byteLength;
      }
      return shareImage(html + decoder.decode(), url);
    } finally {
      await reader.cancel();
    }
  }
  return null;
}
