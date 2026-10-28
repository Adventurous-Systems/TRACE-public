#!/usr/bin/env node

export function assertNodeRuntime(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value ?? '');
  if (!match) throw new Error('Missing or invalid Node runtime version');
  const [major, minor, patch] = match.slice(1).map(Number);
  if (major !== 24 || minor < 22 || (minor === 22 && patch < 1)) {
    throw new Error(`Node ${value} is unsupported: require Node >=24.22.1 <25`);
  }
  return `${major}.${minor}.${patch}`;
}

// import.meta.main is true whenever this file is the entry point, including
// through a symlink; comparing argv[1] with import.meta.url was not, and a gate
// that skips its check exits 0. The CLI tests fail if this stops running.
if (import.meta.main) {
  try {
    console.log(`Node runtime accepted: ${assertNodeRuntime(process.argv[2] ?? process.version)}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
