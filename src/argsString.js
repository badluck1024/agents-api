function splitArgsString(value) {
  const input = String(value || '');
  const args = [];
  let current = '';
  let quote = null;
  let escaping = false;

  for (const char of input) {
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

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current !== '') {
        args.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (escaping) {
    current += '\\';
  }

  if (quote) {
    throw new Error(`Unclosed quote in configuration: ${input}`);
  }

  if (current !== '') {
    args.push(current);
  }

  return args;
}

function joinRemainingArgs(args, startIndex = 0) {
  return args.slice(startIndex).join(' ').trim();
}

module.exports = {
  joinRemainingArgs,
  splitArgsString,
};
