const el = (id) => document.getElementById(id);
const form = el('extract-form');
const editor = el('source-text');
const filePicker = el('document');
const method = el('method');
const limit = el('limit');
const transcript = el('transcript');
const messages = el('messages');

const example = `Rain gardens and urban runoff

Rain gardens collect stormwater from roofs, driveways and streets. The flow of urban runoff is slower where rain passes through native plants and porous soil. More water soaks into the ground, and less reaches the storm drains.

Researchers tracked stormwater runoff across three residential blocks for one year. Rain gardens reduced peak runoff during moderate storms. The gardens with native plants also retained more sediment than the grass plots.

The team measured soil infiltration after each storm. Soil infiltration was higher where the planting beds contained compost and deep-rooted grasses. The findings can help city planners choose sites for rain gardens.`;

const chats = [];
let active;

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function setError(chat, error = '') {
  chat.error = error;
  if (chat !== active) return;
  el('message').textContent = error;
  el('message').hidden = !error;
}

function showAttachment() {
  const label = active.upload ? `Reading ${active.upload.name}…` : active.filename;
  el('file-name').textContent = label;
  el('attachment').hidden = !label;
  el('extract-button').disabled = Boolean(active.pending || active.upload);
}

function showMenu(open) {
  el('sidebar').classList.toggle('open', open);
  el('menu').setAttribute('aria-expanded', String(open));
  el('menu').setAttribute('aria-label', open ? 'Hide conversations' : 'Show conversations');
}

function showHistory() {
  el('chat-list').replaceChildren(...chats.map((chat) => {
    const entry = node('li');
    const button = node('button', '', chat.title);
    button.type = 'button';
    if (chat === active) button.setAttribute('aria-current', 'true');
    button.addEventListener('click', () => {
      openChat(chat);
      editor.focus();
    });
    entry.append(button);
    return entry;
  }));
}

function openChat(chat) {
  if (active) active.scrollTop = transcript.scrollTop;
  active = chat;
  messages.replaceChildren(...chat.turns);
  el('empty-chat').hidden = Boolean(chat.turns.length);
  editor.value = chat.draft;
  setError(chat, chat.error);
  showAttachment();
  showHistory();
  showMenu(false);
  transcript.scrollTop = chat.scrollTop;
}

function newChat() {
  const chat = { title: 'New chat', turns: [], draft: '', filename: '', error: '', scrollTop: 0,
    upload: null, pending: false };
  chats.unshift(chat);
  openChat(chat);
  return chat;
}

async function request(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'The request failed.');
  return payload;
}

function highlightSource(container, source, terms, selected) {
  // The server uses code-point offsets. Keep characters such as emoji intact here.
  const chars = Array.from(source);
  const occupied = new Uint8Array(chars.length);
  const spans = [];
  const order = terms.map((_, index) => index);
  if (selected >= 0) order.unshift(...order.splice(selected, 1));
  for (const index of order) {
    for (const [start, end] of terms[index].spans) {
      if (occupied.subarray(start, end).includes(1)) continue;
      occupied.fill(1, start, end);
      spans.push({ start, end, active: index === selected });
    }
  }
  spans.sort((left, right) => left.start - right.start);
  const fragment = document.createDocumentFragment();
  let cursor = 0;
  for (const { start, end, active: isActive } of spans) {
    fragment.append(chars.slice(cursor, start).join(''));
    fragment.append(node('mark', isActive ? 'active' : '', chars.slice(start, end).join('')));
    cursor = end;
  }
  fragment.append(chars.slice(cursor).join(''));
  container.replaceChildren(fragment);
  const match = container.querySelector('mark.active');
  container.scrollTop = match ? Math.max(0, match.offsetTop - 28) : 0;
}

function downloadCsv(terms, methodName) {
  const quote = (value) => `"${String(value).replaceAll('"', '""')}"`;
  const rows = terms.map(({ term, length, count, score }, index) => [index + 1, term, length, count, score.toFixed(2), methodName]);
  const csv = [['Rank', 'Term', 'Words', 'Occurrences', 'Score', 'Method'], ...rows]
    .map((row) => row.map(quote).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['\uFEFF', csv, '\r\n'], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'termfolio-keywords.csv';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function showReply(reply, source, methodName, payload) {
  const { candidates, results, words } = payload;
  reply.replaceChildren();
  const heading = node('div', 'reply-head');
  const noun = results.length === 1 ? 'term' : 'terms';
  heading.append(node('h2', '', results.length ? `${results.length} ranked ${noun}` : 'No terms found'));
  reply.append(heading, node('p', 'reply-meta', `${methodName} · ${words} words · ${candidates} candidates`));
  if (!results.length) {
    reply.append(node('p', 'reply-copy', 'Try sending a passage with more content words.'));
    return;
  }

  const exportButton = node('button', 'quiet', 'Download CSV ↓');
  exportButton.type = 'button';
  exportButton.addEventListener('click', () => downloadCsv(results, methodName));
  heading.append(exportButton);

  const details = node('details', 'source-preview');
  const annotation = node('div', 'highlighted-source');
  annotation.tabIndex = 0;
  annotation.setAttribute('aria-label', 'Highlighted source text');
  details.append(node('summary', '', 'Show source highlights'), annotation);

  let selected = -1;
  const table = node('table', 'terms');
  table.setAttribute('aria-label', 'Ranked terms');
  const headers = table.createTHead().insertRow();
  for (const label of ['#', 'Term', 'Hits', 'Score']) {
    const column = node('th', '', label);
    column.scope = 'col';
    headers.append(column);
  }
  const body = table.createTBody();
  results.forEach(({ term, count, score }, index) => {
    const row = body.insertRow();
    row.className = 'term-row';
    row.insertCell().textContent = String(index + 1).padStart(2, '0');
    const button = node('button', 'term-button', term);
    button.type = 'button';
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => {
      body.querySelector('[aria-pressed="true"]')?.setAttribute('aria-pressed', 'false');
      selected = selected === index ? -1 : index;
      button.setAttribute('aria-pressed', String(selected === index));
      details.open = true;
      highlightSource(annotation, source, results, selected);
      if (details.getBoundingClientRect().bottom > transcript.getBoundingClientRect().bottom) {
        details.scrollIntoView({ block: 'nearest' });
      }
    });
    row.insertCell().append(button);
    row.insertCell().textContent = count;
    row.insertCell().textContent = score.toFixed(2);
  });
  details.addEventListener('toggle', () => {
    details.firstElementChild.textContent = details.open ? 'Hide source highlights' : 'Show source highlights';
    if (details.open && !annotation.hasChildNodes()) highlightSource(annotation, source, results, selected);
  });
  reply.append(table, details);
}

function truncate(value, length) {
  const chars = Array.from(value);
  return chars.length > length ? `${chars.slice(0, length).join('').trimEnd()}…` : value;
}

function appendTurn(chat, source, title) {
  const turn = node('article', 'turn');
  const user = node('details', 'user-message');
  const summary = node('summary');
  const firstLine = source.trimStart().split('\n', 1)[0].trim();
  const preview = firstLine === title ? source.trimStart().slice(firstLine.length).trimStart() : source;
  summary.append(node('span', 'message-title', title));
  if (preview) summary.append(node('span', 'preview', truncate(preview.replace(/\s+/g, ' '), 170)));
  user.append(summary, node('p', 'full', source));
  const reply = node('div', 'reply');
  const avatar = node('span', 'avatar', 'T');
  avatar.setAttribute('aria-hidden', 'true');
  const content = node('div', 'reply-main');
  content.append(node('p', 'reply-copy', 'Extracting terms…'));
  reply.append(avatar, content);
  turn.append(user, reply);
  chat.turns.push(turn);
  messages.append(turn);
  el('empty-chat').hidden = true;
  turn.scrollIntoView({ block: 'nearest' });
  return { turn, content };
}

async function extract(source = editor.value, name = active.filename) {
  const chat = active;
  if (chat.pending || chat.upload || !form.reportValidity()) return;
  if (!source.trim()) {
    setError(chat, 'Paste a document or attach a file first.');
    editor.focus();
    return;
  }
  const methodName = method.selectedOptions[0].textContent;
  const options = { text: source, method: method.value, limit: limit.valueAsNumber };
  const firstLine = source.trim().split(/\r?\n/, 1)[0];
  if (!chat.turns.length) chat.title = name || truncate(firstLine, 45);
  const title = name || (source.trim().includes('\n') ? truncate(firstLine, 65) : 'Pasted text');
  chat.pending = true;
  chat.draft = editor.value = '';
  chat.filename = '';
  setError(chat);
  if (document.activeElement === el('extract-button')) editor.focus({ preventScroll: true });
  showAttachment();
  showHistory();
  const { turn, content } = appendTurn(chat, source, title);
  try {
    const payload = await request('/api/extract', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(options),
    });
    showReply(content, source, methodName, payload);
  } catch (error) {
    content.replaceChildren(node('p', 'reply-copy reply-error', error.message));
  } finally {
    chat.pending = false;
    if (chat === active) {
      showAttachment();
      const bounds = transcript.getBoundingClientRect();
      const position = turn.getBoundingClientRect();
      if (position.bottom > bounds.bottom) transcript.scrollTop += position.top - bounds.top - 12;
    }
  }
}

function cancelUpload(chat) {
  chat.upload?.controller.abort();
  chat.upload = null;
}

filePicker.addEventListener('change', async () => {
  const chat = active;
  const file = filePicker.files[0];
  filePicker.value = '';
  if (!file) return;
  cancelUpload(chat);
  if (file.size > 5 * 1024 * 1024) {
    showAttachment();
    setError(chat, 'Choose a file under 5 MB.');
    return;
  }
  const upload = { controller: new AbortController(), name: file.name };
  chat.upload = upload;
  setError(chat);
  showAttachment();
  try {
    const extension = file.name.match(/\.[a-z0-9]+$/i)?.[0] || '';
    const payload = await request('/api/document', {
      method: 'POST', body: file, signal: upload.controller.signal,
      headers: { 'X-Document-Name': `upload${extension}` },
    });
    if (chat.upload !== upload) return;
    chat.draft = payload.text;
    chat.filename = file.name;
    if (chat === active) {
      editor.value = chat.draft;
      editor.focus();
    }
  } catch (error) {
    if (chat.upload === upload) setError(chat, error.message);
  } finally {
    if (chat.upload === upload) chat.upload = null;
    if (chat === active) showAttachment();
  }
});

form.addEventListener('submit', (event) => { event.preventDefault(); extract(); });
editor.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    if (!el('extract-button').disabled) form.requestSubmit();
  }
});
editor.addEventListener('input', () => {
  active.draft = editor.value;
  cancelUpload(active);
  setError(active);
  showAttachment();
});
el('remove-file').addEventListener('click', () => {
  cancelUpload(active);
  if (active.filename) active.draft = editor.value = '';
  active.filename = '';
  setError(active);
  showAttachment();
  editor.focus();
});
el('menu').addEventListener('click', () => showMenu(el('menu').getAttribute('aria-expanded') !== 'true'));
el('new-chat').addEventListener('click', () => { newChat(); editor.focus(); });
function loadExample() {
  if (active.draft.trim() || active.pending || active.upload) newChat();
  extract(example, 'Rain gardens and urban runoff');
}
el('load-example').addEventListener('click', loadExample);
el('empty-example').addEventListener('click', loadExample);
el('open-methods').addEventListener('click', async () => {
  el('methods-dialog').showModal();
  const summary = el('benchmark-summary');
  if (summary.textContent) return;
  try {
    const data = await request('/api/evaluation');
    const score = data.held_out_test.learned['10'].f1.toFixed(3);
    summary.textContent = `The learned ranker scored ${score} macro F1 at 10 on ${data.eda.splits.test.documents} held-out Inspec abstracts.`;
  } catch {
    summary.textContent = 'The local evaluation summary is unavailable.';
  }
});

newChat();
loadExample();
