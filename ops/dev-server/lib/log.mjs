// Minimal ANSI coloring + prefixing - deliberately hand-rolled instead of
// adding chalk/pino/etc as a dependency (requirement: reuse existing
// tooling, don't add new packages for something this small).
const COLORS = [36, 35, 33, 32, 34, 91, 92, 93, 94, 95, 96];
const colorCache = new Map();

function colorFor(name) {
  if (!colorCache.has(name)) {
    colorCache.set(name, COLORS[colorCache.size % COLORS.length]);
  }
  return colorCache.get(name);
}

export function prefix(name) {
  const code = colorFor(name);
  return `\x1b[${code}m[${name}]\x1b[0m`;
}

export function line(name, text) {
  return `${prefix(name)} ${text}`;
}

export function info(text) {
  console.log(`\x1b[36m[dev]\x1b[0m ${text}`);
}

export function warn(text) {
  console.log(`\x1b[33m[dev]\x1b[0m ${text}`);
}

export function error(text) {
  console.log(`\x1b[31m[dev]\x1b[0m ${text}`);
}

export function ok(text) {
  console.log(`\x1b[32m[dev]\x1b[0m ${text}`);
}
