const reportElement = document.querySelector('#report');
const contentsElement = document.querySelector('#report-contents');
const nameElement = document.querySelector('#report-name');
const formatElement = document.querySelector('#report-format');

function slug(value, index) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
  return normalized || `section-${index + 1}`;
}

function severity(text) {
  const match = text.trim().match(/^\[?(critical|high|medium|low|p[0-3])\]?\b/i);
  return match ? match[1].toLowerCase() : null;
}

function appendInlineText(parent, text) {
  const fragments = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean);
  for (const fragment of fragments) {
    if (fragment.startsWith('`') && fragment.endsWith('`')) {
      const code = document.createElement('code');
      code.textContent = fragment.slice(1, -1);
      parent.append(code);
      continue;
    }
    if (fragment.startsWith('**') && fragment.endsWith('**')) {
      const strong = document.createElement('strong');
      strong.textContent = fragment.slice(2, -2);
      parent.append(strong);
      continue;
    }
    parent.append(document.createTextNode(fragment));
  }
}

function tableRow(line) {
  return line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
}

function isTableDivider(line) {
  return tableRow(line).every((cell) => /^:?-{3,}:?$/.test(cell));
}

function renderMarkdown(markdown) {
  const fragment = document.createDocumentFragment();
  const headings = [];
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (line.startsWith('```')) {
      const codeLines = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith('```')) {
        codeLines.push(lines[index]);
        index += 1;
      }
      index += 1;
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.textContent = codeLines.join('\n');
      pre.append(code);
      fragment.append(pre);
      continue;
    }

    const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const heading = document.createElement(`h${level}`);
      const text = headingMatch[2].trim();
      heading.id = slug(text, headings.length);
      appendInlineText(heading, text);
      const marker = severity(text);
      if (level === 3 && marker) heading.dataset.severity = marker;
      fragment.append(heading);
      if (level === 2) headings.push({ id: heading.id, text });
      index += 1;
      continue;
    }

    if (line.includes('|') && lines[index + 1]?.includes('|') && isTableDivider(lines[index + 1])) {
      const table = document.createElement('table');
      const thead = document.createElement('thead');
      const headerRow = document.createElement('tr');
      for (const cellText of tableRow(line)) {
        const cell = document.createElement('th');
        cell.scope = 'col';
        appendInlineText(cell, cellText);
        headerRow.append(cell);
      }
      thead.append(headerRow);
      table.append(thead);
      const tbody = document.createElement('tbody');
      index += 2;
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        const row = document.createElement('tr');
        for (const cellText of tableRow(lines[index])) {
          const cell = document.createElement('td');
          appendInlineText(cell, cellText);
          row.append(cell);
        }
        tbody.append(row);
        index += 1;
      }
      table.append(tbody);
      fragment.append(table);
      continue;
    }

    const listMatch = line.match(/^\s*([-*]|\d+\.)\s+(.+)$/);
    if (listMatch) {
      const ordered = /\d+\./.test(listMatch[1]);
      const list = document.createElement(ordered ? 'ol' : 'ul');
      while (index < lines.length) {
        const itemMatch = lines[index].match(/^\s*([-*]|\d+\.)\s+(.+)$/);
        if (!itemMatch || /\d+\./.test(itemMatch[1]) !== ordered) break;
        const item = document.createElement('li');
        appendInlineText(item, itemMatch[2]);
        list.append(item);
        index += 1;
      }
      fragment.append(list);
      continue;
    }

    if (line.startsWith('> ')) {
      const quote = document.createElement('blockquote');
      const quoteLines = [];
      while (index < lines.length && lines[index].startsWith('> ')) {
        quoteLines.push(lines[index].slice(2));
        index += 1;
      }
      appendInlineText(quote, quoteLines.join(' '));
      fragment.append(quote);
      continue;
    }

    const paragraphLines = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index].trim()
      && !/^(#{1,4})\s+/.test(lines[index])
      && !/^\s*([-*]|\d+\.)\s+/.test(lines[index])
      && !lines[index].startsWith('```')
      && !lines[index].startsWith('> ')) {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }
    const paragraph = document.createElement('p');
    appendInlineText(paragraph, paragraphLines.join(' '));
    fragment.append(paragraph);
  }

  reportElement.replaceChildren(fragment);
  return headings;
}

function renderJson(content) {
  let value;
  try {
    value = JSON.parse(content);
  } catch {
    throw new Error('The selected JSON report is not valid JSON.');
  }
  const pre = document.createElement('pre');
  const code = document.createElement('code');
  code.textContent = JSON.stringify(value, null, 2);
  pre.append(code);
  reportElement.replaceChildren(pre);
  return [];
}

function renderContents(headings) {
  if (headings.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'contents-empty';
    empty.textContent = 'Single-section report';
    contentsElement.replaceChildren(empty);
    return;
  }
  const links = headings.map(({ id, text }) => {
    const link = document.createElement('a');
    link.href = `#${id}`;
    link.textContent = text;
    return link;
  });
  contentsElement.replaceChildren(...links);
}

async function loadReport() {
  const response = await fetch('/report', { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Report request failed with status ${response.status}.`);
  const payload = await response.json();
  if (!payload || typeof payload.name !== 'string' || typeof payload.content !== 'string') {
    throw new Error('The local report response was malformed.');
  }

  nameElement.textContent = payload.name;
  formatElement.textContent = payload.format === 'json' ? 'JSON' : 'Markdown';
  document.title = `${payload.name} · Autohand Review`;
  const headings = payload.format === 'json'
    ? renderJson(payload.content)
    : renderMarkdown(payload.content);
  renderContents(headings);
  reportElement.setAttribute('aria-busy', 'false');
}

loadReport().catch((error) => {
  const message = document.createElement('p');
  message.className = 'error';
  message.textContent = error instanceof Error ? error.message : 'The report could not be loaded.';
  reportElement.replaceChildren(message);
  reportElement.setAttribute('aria-busy', 'false');
});
