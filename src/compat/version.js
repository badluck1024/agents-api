function extractVersionNumber(value) {
  const match = String(value || '').match(/\d+(?:\.\d+){1,3}/);
  return match ? match[0] : '';
}

function parseVersion(value) {
  const version = extractVersionNumber(value);
  if (!version) {
    return [];
  }
  return version.split('.').map((part) => Number(part));
}

function compareVersions(left, right) {
  const leftParts = Array.isArray(left) ? left : parseVersion(left);
  const rightParts = Array.isArray(right) ? right : parseVersion(right);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftValue = leftParts[index] || 0;
    const rightValue = rightParts[index] || 0;
    if (leftValue > rightValue) {
      return 1;
    }
    if (leftValue < rightValue) {
      return -1;
    }
  }

  return 0;
}

function compareWithOperator(actual, operator, expected) {
  const comparison = compareVersions(actual, expected);
  if (operator === '>') {
    return comparison > 0;
  }
  if (operator === '>=') {
    return comparison >= 0;
  }
  if (operator === '<') {
    return comparison < 0;
  }
  if (operator === '<=') {
    return comparison <= 0;
  }
  if (operator === '=') {
    return comparison === 0;
  }
  return false;
}

function satisfiesVersionRange(versionText, range) {
  const version = extractVersionNumber(versionText);
  const normalizedRange = String(range || '*').trim();
  if (!normalizedRange || normalizedRange === '*') {
    return true;
  }
  if (!version) {
    return false;
  }

  return normalizedRange.split(/\s+/).every((part) => {
    const match = part.match(/^(>=|<=|>|<|=)?(\d+(?:\.\d+){0,3})$/);
    if (!match) {
      return false;
    }
    return compareWithOperator(version, match[1] || '=', match[2]);
  });
}

module.exports = {
  compareVersions,
  extractVersionNumber,
  parseVersion,
  satisfiesVersionRange,
};
