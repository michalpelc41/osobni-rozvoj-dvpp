const timestamp = new Intl.DateTimeFormat('cs-CZ', {dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Prague'});

export function createIdeaReview({getAccount, getDb, esc, safeUrl, date, toast}) {
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

  function renderItem(item) {
    const url = safeUrl(item.source);
    const source = url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Otevřít zdroj ↗</a>` : 'Bez zdrojového odkazu';
    const draft = item.proposed;
    const edit = `<details class="review-draft">
      <summary>Zobrazit a upravit návrh</summary>
      <label>Název<input name="title" value="${esc(draft.title)}" maxlength="200" required></label>
      <div class="formgrid">
        <label>Forma<select name="format">${[...byId('formatFilter').options].slice(1).map(option =>
          `<option${option.value === draft.format ? ' selected' : ''}>${esc(option.value)}</option>`).join('')}</select></label>
        <label>Termín konání<input name="event_date" type="date" value="${esc(draft.event_date)}"></label>
      </div>
      <label>Popis<textarea name="description" rows="4" maxlength="10000" required>${esc(draft.description)}</textarea></label>
      <label>Odkaz<input name="url" type="url" value="${esc(draft.url)}" maxlength="2000" required></label>
    </details>`;
    return `<article class="panel review-item">
      <form data-review-id="${esc(item.id)}" novalidate>
        <h4>${esc(item.title)}</h4>
        <p class="review-meta">${source} <span>· ${timestamp.format(new Date(item.checked_at))}</span></p>
        ${item.note ? `<p>${esc(item.note)}</p>` : ''}
        ${draft.event_date ? `<p>Termín konání · ${esc(date(draft.event_date))}</p>` : ''}
        <p>${esc(draft.description)}</p>
        ${edit}
        <p class="review-feedback" role="status" hidden></p>
        <div class="actions">
          <button type="submit" class="quiet" value="reject">Zamítnout</button>
          <button type="submit" class="primary" value="approve">Schválit a zveřejnit</button>
        </div>
      </form>
    </article>`;
  }

  function renderItems(items) {
    if (!items.length) {
      list.textContent = 'Žádné nové návrhy ke schválení.';
      return;
    }
    list.innerHTML = `<section class="review-group" aria-label="Návrhy ke schválení"><div>${items.map(renderItem).join('')}</div></section>`;
  }

  async function refresh() {
    const current = ++revision;
    if (visible) summary.textContent = 'Načítání návrhů…';
    reload.disabled = true;
    try {
      const db = getDb();
      const requests = [
        db.from('dvpp_idea_review_items').select('id', {count: 'exact', head: true}).eq('kind', 'new').eq('decision', 'pending'),
      ];
      if (visible) requests.push(
        db.from('dvpp_idea_review_runs').select('checked_at,summary').eq('summary->>mode', 'external').order('week', {ascending: false}).limit(1).maybeSingle(),
        db.from('dvpp_idea_review_items').select('id,title,proposed,source,note,checked_at')
          .eq('kind', 'new').eq('decision', 'pending').order('checked_at', {ascending: false}).order('id').limit(100),
      );
      const [count, run, items] = await Promise.all(requests);
      if (current !== revision || !allowed) return;
      if (count.error || run?.error || items?.error) throw Error();
      setCount(count.count ?? 0);
      if (run) {
        const last = run.data;
        const result = last?.summary;
        summary.textContent = last
          ? `Poslední hledání ${timestamp.format(new Date(last.checked_at))} · Nové tipy ${result.suggested}.`
            + (result.unavailable?.length ? ' Nedostupné zdroje · ' + result.unavailable.join(', ') + '.' : '') + (pending > 100 ? ' Zobrazeno 100 nejnovějších položek.' : '')
          : 'První týdenní hledání zatím neproběhlo.';
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
    const edits = approve ? Object.fromEntries(new FormData(form)) : null;
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
      if (result.data === 'invalid') {
        displayError('Zadejte platný odkaz mimo web kcv.cz.');
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
      if (result.data === 'approved') toast('Inspirace byla zveřejněna.');
      else if (result.data === 'rejected') toast('Návrh byl zamítnut.');
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
