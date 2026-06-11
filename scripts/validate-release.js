const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const packageJson = require(path.join(root, 'package.json'));
const version = String(packageJson.version || '').trim();
const errors = [];

function readFile(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function fail(message) {
  errors.push(message);
}

if (!/^0\.2\.\d+$/.test(version)) {
  fail(`package.json version must stay in the 0.2.x line. Found ${version}.`);
}

const readme = readFile('README.md');
if (!readme.includes(`\n${version}\n`)) {
  fail(`README.md must contain the current package version ${version}.`);
}

const openapi = readFile('src/openapi.js');
if (!openapi.includes(`version: '${version}'`)) {
  fail(`src/openapi.js must expose version ${version}.`);
}

const tag = String(process.env.GITHUB_REF_NAME || '').trim();
if (tag && tag.startsWith('v') && tag !== `v${version}`) {
  fail(`Git tag ${tag} does not match package.json version ${version}.`);
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`release check failed: ${error}`);
  }
  process.exit(1);
}

console.log(`release check ok: v${version}`);
