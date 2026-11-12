const fieldLabels = {title: 'Název', description: 'Popis', event_date: 'Termín konání', url: 'Odkaz'};
const timestamp = new Intl.DateTimeFormat('cs-CZ', {dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Prague'});

export function createIdeaReview({getAccount, getDb, esc, safeUrl, date, toast, richPrefix, reflectionPlainText}) {
  const byId = id => document.getElementById(id);
  const section = byId('ideaReview');
  const button = byId('reviewTab');
  const badge = byId('reviewCount');
  const summary = byId('reviewSummary');
  const list = byId('reviewItems');
  const reload = byId('reloadReview');
  let account = null;
  let allowed = false;
  let visible = false;
  let revision = 0;
  let pending = 0;

  function setCount(count) {
    pending = count;
    badge.hidden = count === 0;
    badge.textContent = count;
    badge.setAttribute('aria-label', count + ' položek k vyřízení');
  }

  function valueText(item, value) {
    if (value == null || value === '') return 'Nevyplněno';
    if (item.field === 'event_date') return date(value);
    if (item.field === 'description' && value.startsWith(richPrefix)) return reflectionPlainText(value);
    return value;
  }

  function renderItem(item) {
    const url = safeUrl(item.source);
    const source = url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Otevřít zdroj ↗</a>` : 'Bez zdrojového odkazu';
    const details = item.kind === 'change' ? `
      <dl class="review-compare">
        <div><dt>Na nástěnce</dt><dd>${esc(valueText(item, item.original))}</dd></div>
        <div><dt>Návrh ze zdroje</dt><dd>${esc(valueText(item, item.proposed))}</dd></div>
      </dl>` : '';
    const draft = item.kind === 'new' ? item.proposed : null;
    const edit = draft ? `<details class="review-draft">
      <summary>Zobrazit a upravit návrh</summary>
      <label>Název<input name="title" value="${esc(draft.title)}" maxlength="200" required></label>
      <div class="formgrid">
        <label>Forma<select name="format">${[...byId('formatFilter').options].slice(1).map(option =>
          `<option${option.value === draft.format ? ' selected' : ''}>${esc(option.value)}</option>`).join('')}</select></label>
        <label>Termín konání<input name="event_date" type="date" value="${esc(draft.event_date)}"></label>
      </div>
      <label>Popis<textarea name="description" rows="4" maxlength="10000" required>${esc(draft.description)}</textarea></label>
      <label>Odkaz<input name="url" type="url" value="${esc(draft.url)}" maxlength="2000" required></label>
    </details>` : '';
    return `<article class="panel review-item">
      <form data-review-id="${esc(item.id)}" data-review-kind="${esc(item.kind)}" novalidate>
        ${item.kind === 'change' ? `<p class="review-field">${esc(fieldLabels[item.field])}</p>` : ''}
        <h4>${esc(item.title)}</h4>
        <p class="review-meta">${source} <span>· ${timestamp.format(new Date(item.checked_at))}</span></p>
        ${item.note ? `<p>${esc(item.note)}</p>` : ''}
        ${draft ? `<p>${esc(draft.format)}${draft.event_date ? ' · ' + esc(date(draft.event_date)) : ''}</p><p>${esc(draft.description)}</p>` : ''}
        ${details}${edit}
        <p class="review-feedback" role="status" hidden></p>
        <div class="actions">
          <button type="submit" class="quiet" value="reject">${item.kind === 'manual' ? 'Označit jako vyřízené' : 'Zamítnout'}</button>
          ${item.kind === 'manual' ? '' : `<button type="submit" class="primary" value="approve">${draft ? 'Schválit a zveřejnit' : 'Schválit změnu'}</button>`}
        </div>
      </form>
    </article>`;
  }

  function renderItems(items) {
    list.innerHTML = [
      ['change', 'Změny na stávajících kartách'],
      ['manual', 'K ručnímu ověření'],
      ['new', 'Nové inspirace'],
    ].map(([kind, heading]) => {
      const subset = items.filter(item => item.kind === kind);
      if (!subset.length) return '';
      const rows = subset.map(renderItem);
      return `<section class="review-group"><h3>${heading}</h3><div>${rows.join('')}</div></section>`;
    }).join('');
    if (!items.length) list.textContent = 'Všechny položky jsou vyřízené.';
  }

  async function refresh() {
    const current = ++revision;
    if (visible) summary.textContent = 'Načítání kontroly…';
    reload.disabled = true;
    try {
      const db = getDb();
      const requests = [
        db.from('dvpp_idea_review_items').select('id', {count: 'exact', head: true}).eq('decision', 'pending'),
      ];
      if (visible) requests.push(
        db.from('dvpp_idea_review_runs').select('checked_at,summary').order('week', {ascending: false}).limit(1).maybeSingle(),
        db.from('dvpp_idea_review_items').select('id,kind,title,field,original,proposed,source,note,checked_at')
          .eq('decision', 'pending').order('checked_at', {ascending: false}).order('id').limit(100),
      );
      const [count, run, items] = await Promise.all(requests);
      if (current !== revision || !allowed) return;
      if (count.error || run?.error || items?.error) throw Error();
      setCount(count.count ?? 0);
      if (run) {
        const last = run.data;
        const result = last?.summary;
        summary.textContent = last
          ? `Poslední kontrola ${timestamp.format(new Date(last.checked_at))} · Dostupné zdroje ${result.reachable} z ${result.checked} karet · Nové tipy ${result.suggested}.`
            + (result.catalogWarning ? ' ' + result.catalogWarning : '') + (pending > 100 ? ' Zobrazeno 100 nejnovějších položek.' : '')
          : 'První týdenní kontrola zatím neproběhla.';
        renderItems(items.data);
      }
    } catch {
      if (current === revision && visible) summary.textContent = 'Přehled se nepodařilo načíst.';
    } finally {
      if (current === revision) reload.disabled = false;
    }
  }

  reload.onclick = refresh;
  list.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.isComposing && event.target.matches('input:not([type="date"])')) {
      event.preventDefault();
    }
  });
  list.addEventListener('submit', async event => {
    const form = event.target;
    if (!form.matches('[data-review-id]')) return;
    event.preventDefault();
    if (!allowed || !visible || !event.submitter) return;
    const approve = event.submitter.value === 'approve';
    const edits = approve && form.dataset.reviewKind === 'new' ? Object.fromEntries(new FormData(form)) : null;
    const feedback = form.querySelector('.review-feedback');
    const displayError = message => {
      feedback.hidden = false;
      feedback.textContent = message;
    };
    if (edits && (!edits.title.trim() || !edits.description.trim() || !safeUrl(edits.url) || !form.checkValidity())) {
      displayError('Vyplňte název, popis a platný odkaz.');
      return;
    }
    const owner = account;
    const buttons = [...form.querySelectorAll('button')];
    buttons.forEach(control => { control.disabled = true; });
    reload.disabled = true;
    try {
      const result = await getDb().rpc('dvpp_decide_idea_review', {
        p_id: form.dataset.reviewId, p_approve: approve, p_edits: edits,
      });
      if (owner !== account) return;
      if (result.error) throw result.error;
      if (result.data === 'conflict') {
        displayError('Karta se mezitím změnila nebo byla smazána. Návrh můžete zamítnout.');
        return;
      }
      if (result.data === 'duplicate') {
        displayError('Na nástěnce už je inspirace se stejným názvem nebo odkazem.');
        return;
      }
      if (!['approved', 'rejected', 'resolved'].includes(result.data)) throw Error();
      const group = form.closest('.review-group');
      form.closest('article').remove();
      if (!group.querySelector('article')) group.remove();
      setCount(Math.max(0, pending - 1));
      if (!list.children.length && pending) void refresh();
      else if (!list.children.length) renderItems([]);
      if (result.data === 'approved') toast(edits ? 'Inspirace byla zveřejněna.' : 'Změna byla uložena.');
      else if (result.data === 'rejected') toast('Položka byla vyřízena.');
      else toast('Položka už byla vyřízena.');
    } catch {
      if (owner === account) displayError('Rozhodnutí se nepodařilo uložit.');
    } finally {
      buttons.forEach(control => { control.disabled = false; });
      reload.disabled = false;
    }
  });

  function show(selected) {
    const nextAccount = getAccount();
    const opening = selected && !visible;
    if (nextAccount !== account) {
      account = nextAccount;
      allowed = false;
      ++revision;
      setCount(0);
      list.replaceChildren();
      summary.textContent = '';
      button.hidden = true;
      if (account) {
        const owner = account;
        void (async () => {
          try {
            const {data, error} = await getDb().rpc('dvpp_can_review_ideas');
            if (owner !== account || error || data !== true) return;
            allowed = true;
            button.hidden = false;
            section.hidden = !visible;
            void refresh();
          } catch { /* keep the private tab hidden when verification fails */ }
        })();
      }
    }
    visible = selected;
    section.hidden = !visible || !allowed;
    if (opening && allowed) void refresh();
  }
  return {show};
}
