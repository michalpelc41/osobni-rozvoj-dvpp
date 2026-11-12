const eventCategory = 'Vzdělávací akce';
const resourceCategory = 'Vzdělávací zdroj';
const eventFormats = new Set([eventCategory, 'Konference', 'Přednáška', 'Seminář', 'Workshop', 'Metodické setkání', 'Webinář']);
const datedEventFormats = new Set(['On-line zdroj', 'E-learning']);
const categoryOf = idea => eventFormats.has(idea.format) ||
  (datedEventFormats.has(idea.format) && idea.event_date) ? eventCategory : resourceCategory;

const storageKey = 'dvpp-demo-ideas';
const editIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m16 3 5 5-12 12-6 1 1-6Z"/><path d="m14 5 5 5"/></svg>';
const deleteIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg>';

export function createIdeasBoard({getAccount, getDb, loadRows, demo, esc, safeUrl, person, userIcon, calendarIcon, date, toast, richPrefix, cleanRichHtml}) {
  const $ = id => document.getElementById(id);
  const section = $('ideas');
  const status = $('ideasStatus');
  const retry = $('retryIdeas');
  const cards = $('ideaCards');
  const categories = [
    {label: eventCategory, toggle: $('showIdeaEvents'), list: $('ideaEvents'), style: 'event'},
    {label: resourceCategory, toggle: $('showIdeaResources'), list: $('ideaResources'), style: 'resource'},
  ];
  const add = $('addIdea');
  const editor = $('ideaEditor');
  const form = $('ideaForm');
  const description = $('ideaDescription');
  const formatButtons = form.querySelectorAll('[data-idea-format]');
  const save = $('saveIdea');
  const deleteDialog = $('deleteIdeaDialog');
  const confirmDelete = $('confirmIdeaDelete');

  let account = null;
  let rows = [];
  let editingId = null;
  let deletingId = null;
  let request = 0;
  let loading = false;
  let loadError = false;
  let busy = false;
  let descriptionRange = null;

  function renderDescription(value) {
    return value.startsWith(richPrefix) ? cleanRichHtml(value.slice(richPrefix.length)) : esc(value);
  }

  document.addEventListener('selectionchange', () => {
    const selection = window.getSelection();
    if (selection.rangeCount && description.contains(selection.getRangeAt(0).commonAncestorContainer)) {
      descriptionRange = selection.getRangeAt(0).cloneRange();
    }
  });

  for (const button of formatButtons) {
    button.onmousedown = event => event.preventDefault();
    button.onclick = () => {
      const selection = window.getSelection();
      const currentRange = selection.rangeCount && selection.getRangeAt(0);
      let range = currentRange && description.contains(currentRange.commonAncestorContainer)
        ? currentRange.cloneRange()
        : descriptionRange;
      if (!range || !description.contains(range.commonAncestorContainer)) {
        range = document.createRange();
        range.selectNodeContents(description);
        range.collapse(false);
      }
      description.focus();
      selection.removeAllRanges();
      selection.addRange(range);
      document.execCommand('styleWithCSS', false, false);
      document.execCommand(button.dataset.ideaFormat);
    };
  }

  description.addEventListener('paste', event => {
    event.preventDefault();
    document.execCommand('insertText', false, event.clipboardData.getData('text/plain'));
  });
  description.addEventListener('drop', event => event.preventDefault());

  const authorName = id => id ? person(id) : 'Bývalý člen týmu';
  const readRows = () => demo ? JSON.parse(localStorage.getItem(storageKey) || '[]') : loadRows();
  const newestFirst = (a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id);

  async function exportRows() {
    const owner = getAccount();
    if (!owner) return [];
    const result = await readRows();
    if (getAccount() !== owner) return [];
    const text = document.createElement('template');
    return result.sort(newestFirst).map(idea => {
      text.innerHTML = renderDescription(idea.description)
        .replace(/(?:<\/?(?:div|p|li)>)+/g, '\n')
        .replaceAll('<br>', '\n');
      return [
        idea.title, idea.event_date, authorName(idea.author_id), idea.format,
        '', idea.url, text.content.textContent.trim(), '', '', '', '', 'Nástěnka inspirací',
      ];
    });
  }

  function render() {
    add.disabled = !account || loading || loadError;
    retry.hidden = !loadError;
    const enabled = categories.filter(category => category.toggle.checked);
    status.textContent = '';
    if (!account) status.textContent = 'Inspirace jsou dostupné členům týmu DVPP.';
    else if (loading) status.textContent = 'Načítání příspěvků…';
    else if (loadError) status.textContent = 'Příspěvky se nepodařilo načíst.';
    else if (!enabled.length) status.textContent = 'Zapněte alespoň jednu kategorii.';
    cards.hidden = Boolean(status.textContent);

    const sorted = [...rows].sort(newestFirst);
    for (const category of categories) {
      category.toggle.disabled = add.disabled;
      category.list.parentElement.hidden = !category.toggle.checked;
      const matching = cards.hidden || !category.toggle.checked
        ? [] : sorted.filter(idea => categoryOf(idea) === category.label);
      category.list.innerHTML = matching.length
        ? matching.map(idea => renderCard(idea, category)).join('')
        : '<p class="idea-empty">V této kategorii zatím nejsou žádné inspirace.</p>';
    }
  }

  function renderCard(idea, category) {
    const url = safeUrl(idea.url);
    const author = authorName(idea.author_id);
    const title = esc(idea.title);
    const heading = url
      ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${title}</a>`
      : title;
    return `<article class="card idea-card">
      <h3>${heading}</h3>
      <p class="card-format idea-category idea-category--${category.style}">${category.label}</p>
      ${category.label === eventCategory && idea.event_date ? `<time class="meta-item idea-date" datetime="${esc(idea.event_date)}">${calendarIcon}<span>${esc(date(idea.event_date))}</span></time>` : ''}
      <div class="idea-description">${renderDescription(idea.description)}</div>
      <div class="cardfoot"><div class="person">${userIcon}<span>${esc(author)}</span>
        <div class="cardactions">
          <button type="button" data-edit-idea="${esc(idea.id)}" aria-label="Upravit příspěvek" title="Upravit příspěvek">${editIcon}</button>
          <button type="button" data-delete-idea="${esc(idea.id)}" aria-label="Smazat příspěvek" title="Smazat příspěvek">${deleteIcon}</button>
        </div>
      </div></div>
    </article>`;
  }

  async function load() {
    const revision = ++request;
    const owner = account;
    loading = true;
    loadError = false;
    render();
    try {
      const result = await readRows();
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
      for (const {toggle, list} of categories) {
        toggle.checked = true;
        list.replaceChildren();
      }
      description.replaceChildren();
      descriptionRange = null;
      $('deleteIdeaName').textContent = '';
    }
    if (!visible) return;
    if (account && (opening || accountChanged) && !busy) void load();
    else render();
  }

  function openEditor(idea) {
    if (!account || busy || loading) return;
    form.reset();
    description.innerHTML = idea ? renderDescription(idea.description) : '';
    descriptionRange = null;
    editingId = idea?.id ?? null;
    $('ideaError').textContent = '';
    $('ideaEditorTitle').textContent = idea ? 'Upravit příspěvek' : 'Přidat inspiraci na nástěnku';
    if (idea) {
      for (const field of ['title', 'url']) form.elements[field].value = idea[field];
      form.elements.format.value = categoryOf(idea);
      form.elements.event_date.value = idea.event_date ?? '';
    }
    syncEventDate();
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

  function syncEventDate() {
    form.elements.event_date.disabled = form.elements.format.value !== eventCategory;
  }

  form.elements.format.onchange = syncEventDate;
  for (const {toggle} of categories) toggle.onchange = render;
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
    const payload = Object.fromEntries(['title', 'format', 'url'].map(field => [field, data.get(field).trim()]));
    const selectedCategory = payload.format;
    const error = $('ideaError');
    if (![eventCategory, resourceCategory].includes(selectedCategory)) {
      error.textContent = 'Vyberte kategorii inspirace.';
      return;
    }
    const original = rows.find(idea => idea.id === id);
    const sameCategory = original && categoryOf(original) === selectedCategory;
    payload.event_date = selectedCategory === eventCategory
      ? data.get('event_date') || null
      : sameCategory ? original.event_date ?? null : null;
    if (sameCategory && categoryOf({...payload, format: original.format}) === selectedCategory) {
      payload.format = original.format;
    }
    const plainDescription = description.innerText.trim();
    if (!payload.title || !plainDescription || (payload.url && !safeUrl(payload.url))) {
      error.textContent = 'Vyplňte název a popis. Odkaz musí začínat https:// nebo http://.';
      return;
    }
    const formatted = description.querySelector('b, strong, i, em, u');
    payload.description = formatted || plainDescription.startsWith(richPrefix)
      ? richPrefix + cleanRichHtml(description.innerHTML)
      : plainDescription;
    if (Array.from(payload.description).length > 10000) {
      error.textContent = 'Popis je příliš dlouhý. Zkraťte text nebo uberte formátování.';
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

  return {show, exportRows};
}
