const storageKey = 'dvpp-demo-ideas';
const editIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m16 3 5 5-12 12-6 1 1-6Z"/><path d="m14 5 5 5"/></svg>';
const deleteIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg>';

export function createIdeasBoard({getAccount, getDb, loadRows, demo, esc, safeUrl, person, userIcon, toast}) {
  const $ = id => document.getElementById(id);
  const section = $('ideas');
  const status = $('ideasStatus');
  const retry = $('retryIdeas');
  const cards = $('ideaCards');
  const add = $('addIdea');
  const editor = $('ideaEditor');
  const form = $('ideaForm');
  const save = $('saveIdea');
  const deleteDialog = $('deleteIdeaDialog');
  const confirmDelete = $('confirmIdeaDelete');

  for (const option of $('formatFilter').options) {
    if (option.value) form.elements.format.add(option.cloneNode(true));
  }

  let account = null;
  let rows = [];
  let editingId = null;
  let deletingId = null;
  let request = 0;
  let loading = false;
  let loadError = false;
  let busy = false;

  function render() {
    add.disabled = !account || loading || loadError;
    retry.hidden = !loadError;
    status.textContent = '';
    if (!account) status.textContent = 'Nápady jsou dostupné členům týmu DVPP.';
    else if (loading) status.textContent = 'Načítání příspěvků…';
    else if (loadError) status.textContent = 'Příspěvky se nepodařilo načíst.';
    else if (!rows.length) status.textContent = 'Zatím tu nejsou žádné příspěvky.';

    const sorted = [...rows].sort((a, b) =>
      b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id)
    );
    cards.innerHTML = sorted.map(idea => {
      const url = safeUrl(idea.url);
      const author = idea.author_id ? person(idea.author_id) : 'Bývalý člen týmu';
      const title = esc(idea.title);
      const heading = url
        ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${title}</a>`
        : title;
      return `<article class="card idea-card">
        <h3>${heading}</h3>
        <p class="card-format">${esc(idea.format)}</p>
        <p class="idea-description">${esc(idea.description)}</p>
        ${url ? `<a class="idea-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Otevřít odkaz ↗</a>` : ''}
        <div class="cardfoot"><div class="person">${userIcon}<span>${esc(author)}</span>
          <div class="cardactions">
            <button type="button" data-edit-idea="${esc(idea.id)}" aria-label="Upravit příspěvek" title="Upravit příspěvek">${editIcon}</button>
            <button type="button" data-delete-idea="${esc(idea.id)}" aria-label="Smazat příspěvek" title="Smazat příspěvek">${deleteIcon}</button>
          </div>
        </div></div>
      </article>`;
    }).join('');
  }

  async function load() {
    const revision = ++request;
    const owner = account;
    loading = true;
    loadError = false;
    render();
    try {
      const result = demo ? JSON.parse(localStorage.getItem(storageKey) || '[]') : await loadRows();
      if (revision === request && getAccount() === owner) rows = result;
    } catch {
      if (revision === request && getAccount() === owner) {
        rows = [];
        loadError = true;
      }
    } finally {
      if (revision === request && getAccount() === owner) {
        loading = false;
        render();
      }
    }
  }

  function show(visible) {
    const opening = visible && section.hidden;
    section.hidden = !visible;
    $('activityFilters').hidden = visible;
    $('addButton').hidden = visible;
    add.hidden = !visible;
    const nextAccount = getAccount();
    const accountChanged = account !== nextAccount;
    if (accountChanged) {
      account = nextAccount;
      request++;
      rows = [];
      loading = false;
      loadError = false;
      editingId = null;
      deletingId = null;
      form.reset();
      $('deleteIdeaName').textContent = '';
      cards.replaceChildren();
    }
    if (!visible) return;
    if (account && (opening || accountChanged) && !busy) void load();
    else render();
  }

  function openEditor(idea) {
    if (!account || busy || loading) return;
    form.reset();
    editingId = idea?.id ?? null;
    $('ideaError').textContent = '';
    $('ideaEditorTitle').textContent = idea ? 'Upravit příspěvek' : 'Přidat inspiraci';
    if (idea) {
      for (const field of ['title', 'format', 'description', 'url']) form.elements[field].value = idea[field];
    }
    editor.showModal();
  }

  function setBusy(value) {
    busy = value;
    form.inert = value;
    save.disabled = value;
    confirmDelete.disabled = value;
  }

  for (const dialog of [editor, deleteDialog]) {
    dialog.addEventListener('cancel', event => {
      if (busy) event.preventDefault();
    });
    dialog.addEventListener('click', event => {
      if (busy && event.target.closest('[data-close]')) event.stopPropagation();
    });
  }

  retry.onclick = () => { if (account && !busy) void load(); };
  add.onclick = () => openEditor();
  cards.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || !account || busy || loading) return;
    const idea = rows.find(row => row.id === (button.dataset.editIdea ?? button.dataset.deleteIdea));
    if (!idea) return;
    if (button.dataset.editIdea) openEditor(idea);
    else {
      deletingId = idea.id;
      $('deleteIdeaName').textContent = idea.title;
      $('deleteIdeaError').textContent = '';
      deleteDialog.showModal();
    }
  });

  form.onsubmit = async event => {
    event.preventDefault();
    if (!account || busy) return;
    const owner = account;
    const id = editingId;
    const data = new FormData(form);
    const payload = Object.fromEntries(['title', 'format', 'description', 'url'].map(field => [field, data.get(field).trim()]));
    const error = $('ideaError');
    if (!payload.title || !payload.description || (payload.url && !safeUrl(payload.url))) {
      error.textContent = 'Vyplňte název a popis. Odkaz musí začínat https:// nebo http://.';
      return;
    }
    error.textContent = '';
    setBusy(true);
    try {
      let saved;
      if (demo) {
        saved = id
          ? {...rows.find(idea => idea.id === id), ...payload}
          : {...payload, id: crypto.randomUUID(), author_id: owner, created_at: new Date().toISOString()};
        localStorage.setItem(storageKey, JSON.stringify([...rows.filter(idea => idea.id !== id), saved]));
      } else {
        const table = getDb().from('dvpp_ideas');
        const query = id ? table.update(payload).eq('id', id) : table.insert(payload);
        const result = await query.select().single();
        if (result.error) throw result.error;
        saved = result.data;
      }
      if (getAccount() !== owner) return;
      rows = [...rows.filter(idea => idea.id !== saved.id), saved];
      editor.close();
      render();
      toast('Příspěvek byl uložen.');
    } catch {
      if (getAccount() === owner) error.textContent = 'Příspěvek se nepodařilo uložit. Zkuste to znovu.';
    } finally {
      setBusy(false);
    }
  };

  confirmDelete.onclick = async () => {
    if (!account || !deletingId || busy) return;
    const owner = account;
    const id = deletingId;
    const error = $('deleteIdeaError');
    error.textContent = '';
    setBusy(true);
    try {
      if (demo) localStorage.setItem(storageKey, JSON.stringify(rows.filter(idea => idea.id !== id)));
      else {
        const result = await getDb().from('dvpp_ideas').delete().eq('id', id).select('id');
        if (result.error) throw result.error;
      }
      if (getAccount() !== owner) return;
      rows = rows.filter(idea => idea.id !== id);
      deleteDialog.close();
      render();
      toast('Příspěvek byl smazán.');
    } catch {
      if (getAccount() === owner) error.textContent = 'Příspěvek se nepodařilo smazat. Zkuste to znovu.';
    } finally {
      setBusy(false);
    }
  };

  return {show};
}
