function parseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function typeOf(value) {
  if (Array.isArray(value)) {
    return 'array';
  }
  if (value === null) {
    return 'null';
  }
  return typeof value;
}

const DYNAMIC_FIELD_MAPS = new Set(['modelUsage']);

function shapeOf(value, depth = 0, path = []) {
  const type = typeOf(value);
  if (depth >= 4 || (type !== 'object' && type !== 'array')) {
    return type;
  }

  if (Array.isArray(value)) {
    return {
      type,
      items: value.length > 0 ? shapeOf(value[0], depth + 1, path.concat('*')) : 'empty',
    };
  }

  if (DYNAMIC_FIELD_MAPS.has(path[path.length - 1])) {
    const shapes = uniqueShapes(Object.values(value), depth + 1, path.concat('<entry>'));
    const fields = {};
    shapes.forEach((shape, index) => {
      fields[index === 0 ? '<entry>' : `<entry:${index + 1}>`] = shape;
    });
    return { type, fields };
  }

  const fields = {};
  for (const key of Object.keys(value).sort()) {
    fields[key] = shapeOf(value[key], depth + 1, path.concat(key));
  }
  return { type, fields };
}

function uniqueShapes(values, depth = 0, path = []) {
  return [...new Map(
    values.map((value) => {
      const shape = shapeOf(value, depth, path);
      return [JSON.stringify(shape), shape];
    })
  ).values()].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

function createOutputSignature({ stdout = '', stderr = '' } = {}) {
  const stdoutText = String(stdout || '').trim();
  const stderrText = String(stderr || '').trim();
  const lines = stdoutText.split(/\r?\n/).filter((line) => line.trim());
  const parsedLines = lines.map(parseJsonLine);
  const allJsonLines = parsedLines.length > 0 && parsedLines.every(Boolean);
  const parsedDocument = parseJsonLine(stdoutText);

  if (parsedDocument) {
    return {
      kind: 'json',
      stdoutShape: shapeOf(parsedDocument),
      stderrPresent: stderrText.length > 0,
    };
  }

  if (allJsonLines) {
    return {
      kind: 'jsonl',
      stdoutLineShapes: uniqueShapes(parsedLines),
      stderrPresent: stderrText.length > 0,
    };
  }

  return {
    kind: stdoutText ? 'text' : 'empty',
    stdoutPresent: stdoutText.length > 0,
    stderrPresent: stderrText.length > 0,
  };
}

module.exports = {
  createOutputSignature,
  shapeOf,
};
