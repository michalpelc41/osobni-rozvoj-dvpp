const timestamp = new Intl.DateTimeFormat('cs-CZ', {dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Prague'});

export function createIdeaReview({getAccount, getDb, esc, safeUrl, toast}) {
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
    const url = safeUrl(item.proposed.url) || safeUrl(item.source);
    const title = esc(item.proposed.title || item.title);
    const link = url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${title}</a>` : title;
    return `<tr>
      <th scope="row">${link}</th>
      <td class="review-description">${esc(item.proposed.description)}</td>
      <td>
        <form data-review-id="${esc(item.id)}">
          <div class="review-actions">
            <button type="submit" class="quiet" value="reject">Zamítnout</button>
            <button type="submit" class="primary" value="approve">Vložit na nástěnku inspirací</button>
          </div>
          <p class="review-feedback" role="status" hidden></p>
        </form>
      </td>
    </tr>`;
  }

  function renderItems(items) {
    if (!items.length) {
      list.textContent = 'Žádné nové návrhy ke schválení.';
      return;
    }
    list.innerHTML = `<div class="tablewrap review-tablewrap" tabindex="0" role="region" aria-label="Návrhy ke schválení">
      <table>
        <thead><tr><th scope="col">Název</th><th scope="col">Krátký popis</th><th scope="col">Akce</th></tr></thead>
        <tbody>${items.map(renderItem).join('')}</tbody>
      </table>
    </div>`;
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
        db.from('dvpp_idea_review_items').select('id,title,proposed,source')
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
  list.addEventListener('submit', async event => {
    const form = event.target;
    if (!form.matches('[data-review-id]')) return;
    event.preventDefault();
    if (!allowed || !visible || !event.submitter) return;
    const approve = event.submitter.value === 'approve';
    const feedback = form.querySelector('.review-feedback');
    const displayError = message => {
      feedback.hidden = false;
      feedback.textContent = message;
    };
    const owner = account;
    const buttons = [...form.querySelectorAll('button')];
    buttons.forEach(control => { control.disabled = true; });
    reload.disabled = true;
    try {
      const result = await getDb().rpc('dvpp_decide_idea_review', {
        p_id: form.dataset.reviewId, p_approve: approve, p_edits: null,
      });
      if (owner !== account) return;
      if (result.error) throw result.error;
      if (result.data === 'invalid') {
        displayError('Tento návrh nemá platný odkaz mimo web kcv.cz.');
        return;
      }
      if (result.data === 'duplicate') {
        displayError('Na nástěnce už je inspirace se stejným názvem nebo odkazem.');
        return;
      }
      if (!['approved', 'rejected', 'resolved'].includes(result.data)) throw Error();
      form.closest('tr').remove();
      setCount(Math.max(0, pending - 1));
      if (!list.querySelector('tbody tr')) {
        renderItems([]);
        if (pending) void refresh();
      }
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
