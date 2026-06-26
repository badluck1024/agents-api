function parseHeaderParameters(value) {
  const segments = [];
  let current = '';
  let quote = null;
  let escaping = false;

  for (const char of String(value || '')) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (char === '\\') {
      escaping = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"') {
      quote = char;
      continue;
    }

    if (char === ';') {
      segments.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  if (current.trim() !== '') {
    segments.push(current.trim());
  }

  const type = String(segments.shift() || '').trim().toLowerCase();
  const parameters = {};

  for (const segment of segments) {
    const equalsIndex = segment.indexOf('=');
    if (equalsIndex === -1) {
      continue;
    }

    const key = segment.slice(0, equalsIndex).trim().toLowerCase();
    const rawValue = segment.slice(equalsIndex + 1).trim();
    parameters[key] = rawValue;
  }

  return { parameters, type };
}

function unquoteHeaderValue(value) {
  const raw = String(value || '').trim();
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    return raw.slice(1, -1).replace(/\\(["\\])/g, '$1');
  }
  return raw;
}

function decodeRfc5987Value(value) {
  const raw = unquoteHeaderValue(value);
  const match = raw.match(/^([^']*)'[^']*'(.*)$/);
  if (!match) {
    return raw;
  }

  const charset = match[1].toLowerCase();
  if (charset && charset !== 'utf-8') {
    return raw;
  }

  try {
    return decodeURIComponent(match[2]);
  } catch {
    return raw;
  }
}

function parseContentType(value) {
  const parsed = parseHeaderParameters(value);
  const parameters = {};

  for (const [key, rawValue] of Object.entries(parsed.parameters)) {
    parameters[key] = unquoteHeaderValue(rawValue);
  }

  return {
    parameters,
    type: parsed.type,
  };
}

function isMultipartFormData(contentType) {
  return parseContentType(contentType).type === 'multipart/form-data';
}

function parseHeaders(buffer) {
  const text = buffer.toString('latin1');
  const headers = {};

  for (const line of text.split('\r\n')) {
    if (!line.trim()) {
      continue;
    }

    const separator = line.indexOf(':');
    if (separator === -1) {
      throw new Error('Invalid multipart header.');
    }

    const name = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    headers[name] = value;
  }

  return headers;
}

function partDisposition(headers) {
  const value = headers['content-disposition'];
  if (!value) {
    throw new Error('Multipart part is missing Content-Disposition.');
  }

  const parsed = parseHeaderParameters(value);
  if (parsed.type !== 'form-data') {
    throw new Error('Multipart Content-Disposition must be form-data.');
  }

  const name = unquoteHeaderValue(parsed.parameters.name);
  const filename = parsed.parameters['filename*']
    ? decodeRfc5987Value(parsed.parameters['filename*'])
    : unquoteHeaderValue(parsed.parameters.filename);

  return { filename, name };
}

function parseMultipartParts(body, boundary) {
  if (!boundary) {
    throw new Error('Multipart boundary is required.');
  }

  const delimiter = Buffer.from(`--${boundary}`, 'latin1');
  const headerEndDelimiter = Buffer.from('\r\n\r\n', 'latin1');
  const nextPartPrefix = Buffer.from(`\r\n--${boundary}`, 'latin1');
  let position = body.indexOf(delimiter);

  if (position === -1) {
    throw new Error('Multipart boundary was not found.');
  }

  position += delimiter.length;
  const parts = [];

  while (position < body.length) {
    if (body.slice(position, position + 2).toString('latin1') === '--') {
      break;
    }

    if (body.slice(position, position + 2).toString('latin1') !== '\r\n') {
      throw new Error('Invalid multipart boundary separator.');
    }
    position += 2;

    const headerEnd = body.indexOf(headerEndDelimiter, position);
    if (headerEnd === -1) {
      throw new Error('Multipart part headers are not terminated.');
    }

    const headers = parseHeaders(body.slice(position, headerEnd));
    const contentStart = headerEnd + headerEndDelimiter.length;
    const nextBoundary = body.indexOf(nextPartPrefix, contentStart);
    if (nextBoundary === -1) {
      throw new Error('Multipart part is not terminated by a boundary.');
    }

    parts.push({
      body: body.slice(contentStart, nextBoundary),
      headers,
    });

    position = nextBoundary + nextPartPrefix.length;
  }

  return parts;
}

function parseMultipartRunRequest(body, contentType) {
  const parsedContentType = parseContentType(contentType);
  if (parsedContentType.type !== 'multipart/form-data') {
    throw new Error('Content-Type must be multipart/form-data.');
  }

  const parts = parseMultipartParts(body, parsedContentType.parameters.boundary);
  let request = null;
  const files = [];

  for (const part of parts) {
    const disposition = partDisposition(part.headers);

    if (disposition.name === 'request') {
      if (request !== null) {
        throw new Error('Multipart request can include only one request part.');
      }

      try {
        request = JSON.parse(part.body.toString('utf8'));
      } catch (error) {
        throw new Error(`Invalid multipart request JSON: ${error.message}`);
      }

      if (!request || typeof request !== 'object' || Array.isArray(request)) {
        throw new Error('Multipart request JSON must be an object.');
      }
      continue;
    }

    if (disposition.name === 'files') {
      if (!disposition.filename) {
        throw new Error('Multipart files parts must include a filename.');
      }

      files.push({
        buffer: part.body,
        mimeType: part.headers['content-type'] || '',
        path: disposition.filename,
      });
    }
  }

  if (!request) {
    throw new Error('Multipart run requests must include a request JSON part.');
  }

  if (Object.prototype.hasOwnProperty.call(request, 'files')) {
    throw new Error('Multipart request JSON cannot include files; attach files as multipart parts.');
  }

  return {
    ...request,
    files,
  };
}

module.exports = {
  isMultipartFormData,
  parseContentType,
  parseMultipartRunRequest,
};
