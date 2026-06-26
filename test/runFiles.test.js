const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createRunFilesContext, normalizeRunFiles } = require('../src/runFiles');

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agents-api-files-test-'));
}

test('createRunFilesContext writes files and cleans staging directory', () => {
  const cwd = createTempDir();

  try {
    const context = createRunFilesContext([
      {
        path: 'docs/notes.txt',
        content: 'hello',
      },
      {
        path: 'image.png',
        content: Buffer.from('png').toString('base64'),
        encoding: 'base64',
        mimeType: 'image/png',
      },
    ], cwd);

    assert.equal(context.files.length, 2);
    assert.equal(fs.readFileSync(context.files[0].absolutePath, 'utf8'), 'hello');
    assert.equal(fs.readFileSync(context.files[1].absolutePath, 'utf8'), 'png');
    assert.equal(context.files[1].isImage, true);
    assert.equal(fs.existsSync(context.directory), true);

    context.cleanup();
    assert.equal(fs.existsSync(context.directory), false);
    assert.equal(fs.existsSync(path.join(cwd, 'agents-api-run-files')), false);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('createRunFilesContext accepts multipart file buffers', () => {
  const cwd = createTempDir();

  try {
    const context = createRunFilesContext([
      {
        path: 'docs/input.txt',
        buffer: Buffer.from('buffer content', 'utf8'),
        mimeType: 'text/plain',
      },
    ], cwd);

    assert.equal(context.files[0].path, path.join('docs', 'input.txt'));
    assert.equal(fs.readFileSync(context.files[0].absolutePath, 'utf8'), 'buffer content');
    context.cleanup();
    assert.equal(fs.existsSync(context.directory), false);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('normalizeRunFiles rejects unsafe paths and invalid encodings', () => {
  assert.throws(
    () => normalizeRunFiles([{ path: '../secret.txt', content: 'x' }]),
    /relative|segments/
  );
  assert.throws(
    () => normalizeRunFiles([{ path: 'notes.txt', content: 'x', encoding: 'hex' }]),
    /encoding/
  );
  assert.throws(
    () => normalizeRunFiles([{ path: 'notes.txt', content: 'not-base64', encoding: 'base64' }]),
    /base64/
  );
});

test('normalizeRunFiles rejects duplicate paths', () => {
  assert.throws(
    () => normalizeRunFiles([
      { path: 'notes.txt', content: 'one' },
      { path: 'notes.txt', content: 'two' },
    ]),
    /Duplicate run file path/
  );
});
