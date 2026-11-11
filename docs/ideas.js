const storageKey = 'dvpp-demo-ideas';
const editIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m16 3 5 5-12 12-6 1 1-6Z"/><path d="m14 5 5 5"/></svg>';
const deleteIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg>';

export function createIdeasBoard({getAccount, getDb, loadRows, demo, esc, safeUrl, person, userIcon, toast, richPrefix, cleanRichHtml}) {
  const $ = id => document.getElementById(id);
  const section = $('ideas');
  const status = $('ideasStatus');
  const retry = $('retryIdeas');
  const cards = $('ideaCards');
  const add = $('addIdea');
  const editor = $('ideaEditor');
  const form = $('ideaForm');
  const description = $('ideaDescription');
  const formatButtons = form.querySelectorAll('[data-idea-format]');
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

  function arrangeCards() {
    if (!cards.clientWidth) return;
    const style = getComputedStyle(cards);
    const widths = style.gridTemplateColumns.split(' ').map(parseFloat);
    const gap = parseFloat(style.columnGap);
    const positions = [];
    const bottoms = widths.map(() => 0);
    let left = 0;
    for (const width of widths) {
      positions.push(left);
      left += width + gap;
    }

    cards.classList.add('idea-masonry');
    // Set the common track width before measuring wrapped text.
    for (const card of cards.children) card.style.width = `${widths[0]}px`;
    const heights = Array.from(cards.children, card => card.getBoundingClientRect().height);
    Array.from(cards.children).forEach((card, index) => {
      const shortest = Math.min(...bottoms);
      const column = bottoms.indexOf(shortest);
      card.style.left = `${positions[column]}px`;
      card.style.top = `${shortest}px`;
      bottoms[column] += heights[index] + gap;
    });
    cards.style.height = `${Math.max(0, Math.max(...bottoms) - gap)}px`;
  }

  let layoutFrame = 0;
  const layoutObserver = new ResizeObserver(() => {
    if (layoutFrame) return;
    layoutFrame = requestAnimationFrame(() => {
      layoutFrame = 0;
      arrangeCards();
    });
  });

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
        <div class="idea-description">${renderDescription(idea.description)}</div>
        <div class="cardfoot"><div class="person">${userIcon}<span>${esc(author)}</span>
          <div class="cardactions">
            <button type="button" data-edit-idea="${esc(idea.id)}" aria-label="Upravit příspěvek" title="Upravit příspěvek">${editIcon}</button>
            <button type="button" data-delete-idea="${esc(idea.id)}" aria-label="Smazat příspěvek" title="Smazat příspěvek">${deleteIcon}</button>
          </div>
        </div></div>
      </article>`;
    }).join('');
    layoutObserver.disconnect();
    arrangeCards();
    layoutObserver.observe(cards);
    for (const card of cards.children) layoutObserver.observe(card, {box: 'border-box'});
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
      description.replaceChildren();
      descriptionRange = null;
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
    description.innerHTML = idea ? renderDescription(idea.description) : '';
    descriptionRange = null;
    editingId = idea?.id ?? null;
    $('ideaError').textContent = '';
    $('ideaEditorTitle').textContent = idea ? 'Upravit příspěvek' : 'Přidat inspiraci';
    if (idea) {
      for (const field of ['title', 'format', 'url']) form.elements[field].value = idea[field];
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
    const payload = Object.fromEntries(['title', 'format', 'url'].map(field => [field, data.get(field).trim()]));
    const error = $('ideaError');
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

  return {show};
}
