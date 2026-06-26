const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const RUN_FILES_PARENT_DIR = 'agents-api-run-files';
const MAX_RUN_FILES = 20;
const MAX_RUN_FILE_BYTES = 8 * 1024 * 1024;
const MAX_RUN_FILES_TOTAL_BYTES = 16 * 1024 * 1024;

const IMAGE_EXTENSIONS = new Set([
  '.avif',
  '.bmp',
  '.gif',
  '.jpeg',
  '.jpg',
  '.png',
  '.webp',
]);

function emptyRunFilesContext() {
  return {
    directory: '',
    files: [],
    cleanup() {},
  };
}

function ensureSafeRelativePath(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('Each files item must include a non-empty path.');
  }

  const rawPath = value.trim();
  if (rawPath.includes('\0')) {
    throw new Error('Run file paths cannot contain null bytes.');
  }

  if (path.isAbsolute(rawPath) || /^[a-zA-Z]:($|[\\/])/.test(rawPath)) {
    throw new Error('Run file paths must be relative.');
  }

  const segments = rawPath.split(/[\\/]+/).filter(Boolean);
  if (segments.length === 0 || segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error('Run file paths cannot contain . or .. segments.');
  }

  return segments.join(path.sep);
}

function normalizeEncoding(value) {
  if (value === undefined || value === null || value === '') {
    return 'utf8';
  }

  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'utf8' || normalized === 'utf-8' || normalized === 'text') {
    return 'utf8';
  }

  if (normalized === 'base64') {
    return 'base64';
  }

  throw new Error('Run file encoding must be utf8 or base64.');
}

function decodeFileContent(file) {
  if (Object.prototype.hasOwnProperty.call(file, 'buffer')) {
    if (!Buffer.isBuffer(file.buffer)) {
      throw new Error('Run file buffer must be a Buffer.');
    }

    return { buffer: file.buffer, encoding: 'buffer' };
  }

  if (!Object.prototype.hasOwnProperty.call(file, 'content')) {
    throw new Error('Each files item must include content.');
  }

  if (typeof file.content !== 'string') {
    throw new Error('Run file content must be a string.');
  }

  const encoding = normalizeEncoding(file.encoding);
  if (encoding === 'utf8') {
    return { buffer: Buffer.from(file.content, 'utf8'), encoding };
  }

  const compact = file.content.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact) || compact.length % 4 !== 0) {
    throw new Error('Run file content is not valid base64.');
  }

  return { buffer: Buffer.from(compact, 'base64'), encoding };
}

function isPathInside(childPath, parentPath) {
  const relative = path.relative(parentPath, childPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function displayPathFor(cwd, absolutePath) {
  const relative = path.relative(cwd, absolutePath);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative)
    ? relative
    : absolutePath;
}

function pathForAgentPrompt(absolutePath) {
  return absolutePath.replace(/\\/g, '/');
}

function promptValue(value) {
  return JSON.stringify(String(value || ''));
}

function stagedRelativePathFor(file, index) {
  const extension = path.extname(file.path).toLowerCase();
  const safeExtension = /^\.[a-z0-9]{1,12}$/.test(extension) ? extension : '';
  return `attachment-${index + 1}${safeExtension}`;
}

function isImageFile(file) {
  const mimeType = String(file.mimeType || '').trim().toLowerCase();
  if (mimeType.startsWith('image/')) {
    return true;
  }

  return IMAGE_EXTENSIONS.has(path.extname(file.path).toLowerCase());
}

function normalizeRunFiles(files) {
  if (files === undefined || files === null) {
    return [];
  }

  if (!Array.isArray(files)) {
    throw new Error('The files field must be an array.');
  }

  if (files.length > MAX_RUN_FILES) {
    throw new Error(`The files field supports up to ${MAX_RUN_FILES} files.`);
  }

  let totalBytes = 0;
  const seenPaths = new Set();

  return files.map((file) => {
    if (!file || typeof file !== 'object' || Array.isArray(file)) {
      throw new Error('Each files item must be an object.');
    }

    const relativePath = ensureSafeRelativePath(file.path || file.name);
    const duplicateKey = relativePath.toLowerCase();
    if (seenPaths.has(duplicateKey)) {
      throw new Error(`Duplicate run file path: ${relativePath}`);
    }
    seenPaths.add(duplicateKey);

    const { buffer, encoding } = decodeFileContent(file);
    if (buffer.length > MAX_RUN_FILE_BYTES) {
      throw new Error(`Run file is too large: ${relativePath}`);
    }

    totalBytes += buffer.length;
    if (totalBytes > MAX_RUN_FILES_TOTAL_BYTES) {
      throw new Error(`Run files exceed the ${MAX_RUN_FILES_TOTAL_BYTES} byte limit.`);
    }

    const mimeType = typeof file.mimeType === 'string' ? file.mimeType.trim() : '';

    return {
      buffer,
      encoding,
      mimeType,
      path: relativePath,
      size: buffer.length,
    };
  });
}

function createRunFilesContext(files, cwd) {
  const normalizedFiles = normalizeRunFiles(files);
  if (normalizedFiles.length === 0) {
    return emptyRunFilesContext();
  }

  const parentDirectory = path.join(cwd, RUN_FILES_PARENT_DIR);
  const runDirectory = path.join(
    parentDirectory,
    `run-${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}`
  );

  fs.mkdirSync(runDirectory, { recursive: true });

  let cleaned = false;
  function cleanup() {
    if (cleaned) {
      return;
    }
    cleaned = true;
    fs.rmSync(runDirectory, { recursive: true, force: true });
    try {
      fs.rmdirSync(parentDirectory);
    } catch {
      // Keep the parent directory when other active runs are using it.
    }
  }

  try {
    const stagedFiles = normalizedFiles.map((file, index) => {
      const stagedPath = stagedRelativePathFor(file, index);
      const absolutePath = path.resolve(runDirectory, stagedPath);
      if (!isPathInside(absolutePath, runDirectory)) {
        throw new Error(`Run file path escapes the staging directory: ${stagedPath}`);
      }

      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      fs.writeFileSync(absolutePath, file.buffer, { flag: 'wx' });

      const staged = {
        absolutePath,
        agentPath: pathForAgentPrompt(absolutePath),
        encoding: file.encoding,
        isImage: isImageFile(file),
        mimeType: file.mimeType,
        path: file.path,
        stagedPath,
        runPath: displayPathFor(cwd, absolutePath),
        size: file.size,
      };
      return staged;
    });

    return {
      directory: runDirectory,
      files: stagedFiles,
      cleanup,
    };
  } catch (error) {
    cleanup();
    throw error;
  }
}

function appendRunFilesToPrompt(prompt, runFiles) {
  if (!runFiles || !Array.isArray(runFiles.files) || runFiles.files.length === 0) {
    return prompt;
  }

  const lines = [
    'Uploaded request files saved locally for this run:',
    'Use exactly the staged filesystem paths below to read uploaded files.',
    'Do not search Downloads, the home directory, the workspace, or any other location for same-named files.',
    ...runFiles.files.flatMap((file, index) => [
      `Attachment ${index + 1}:`,
      `  Alias from request: ${promptValue(file.path)}`,
      `  Staged filesystem path to read: ${promptValue(file.agentPath)}`,
      ...(file.mimeType ? [`  MIME type: ${file.mimeType}`] : []),
    ]),
    'If the user mentions an alias above, read the matching staged filesystem path.',
    'Now complete the user request using the staged files above.',
  ];

  return `${lines.join('\n')}\n\nUser prompt:\n${String(prompt || '').trimEnd()}`;
}

function publicRunFiles(runFiles) {
  if (!runFiles || !Array.isArray(runFiles.files)) {
    return [];
  }

  return runFiles.files.map((file) => ({
    path: file.path,
    runPath: file.runPath,
    stagedPath: file.stagedPath,
    size: file.size,
    ...(file.mimeType ? { mimeType: file.mimeType } : {}),
  }));
}

function buildRunFileArgs(agentId, runFiles) {
  if (!runFiles || !Array.isArray(runFiles.files) || runFiles.files.length === 0) {
    return [];
  }

  const args = [];
  if (agentId === 'codex') {
    for (const file of runFiles.files) {
      if (file.isImage) {
        args.push(`--image=${file.absolutePath}`);
      }
    }
  }

  return args;
}

module.exports = {
  MAX_RUN_FILES,
  MAX_RUN_FILES_TOTAL_BYTES,
  MAX_RUN_FILE_BYTES,
  appendRunFilesToPrompt,
  buildRunFileArgs,
  createRunFilesContext,
  normalizeRunFiles,
  publicRunFiles,
};
