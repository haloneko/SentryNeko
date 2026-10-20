// Checks the CSS Modules contract, which the type checker cannot see: every `styles.someClass` a
// component reads has to be exported by the stylesheet it imported, the app has to mount the
// tokens and the global sheet, and global.css may not name a class a module owns — a global
// selector can never match a hashed class, so that rule would simply do nothing. `pnpm lint` runs
// this.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const camel = (name) => name.replace(/-+([a-z0-9])/g, (_, char) => char.toUpperCase());

const files = readdirSync(SRC, { recursive: true })
  .map((entry) => String(entry).split("\\").join("/"))
  .filter((entry) => entry.endsWith(".tsx") || entry.endsWith(".module.css"));

const exported = new Map();
const owners = new Map();

for (const file of files.filter((name) => name.endsWith(".module.css"))) {
  const text = readFileSync(join(SRC, file), "utf8").replace(/:global\([^)]*\)/g, "");
  const names = new Set();

  for (const match of text.matchAll(/\.([a-zA-Z][a-zA-Z0-9-]*)/g)) {
    names.add(camel(match[1]));
    owners.set(match[1], file);
  }

  exported.set(file, names);
}

const problems = [];

for (const file of files.filter((name) => name.endsWith(".tsx"))) {
  const text = readFileSync(join(SRC, file), "utf8");

  for (const match of text.matchAll(/import\s+(\w+)\s+from\s+"([^"]+\.module\.css)"/g)) {
    const [, variable, specifier] = match;
    const target = relative(SRC, resolve(dirname(join(SRC, file)), specifier)).split("\\").join("/");
    const names = exported.get(target);

    if (!names) {
      problems.push(`${file} imports ${specifier}, which is not a stylesheet on disk`);
      continue;
    }

    for (const used of text.matchAll(new RegExp(`\\b${variable}\\.(\\w+)`, "g"))) {
      if (!names.has(used[1])) {
        problems.push(`${file}: ${variable}.${used[1]} is not a class in ${target}`);
      }
    }
  }
}

const globalSheet = readFileSync(join(SRC, "styles", "global.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

for (const match of globalSheet.matchAll(/\.([a-zA-Z][a-zA-Z0-9-]*)/g)) {
  const owner = owners.get(match[1]);

  if (owner) {
    problems.push(`styles/global.css names .${match[1]}, which is a module class of ${owner}`);
  }
}

const main = readFileSync(join(SRC, "main.tsx"), "utf8");

for (const sheet of ["tokens.css", "global.css"]) {
  if (!main.includes(`"./styles/${sheet}"`)) {
    problems.push(`main.tsx does not import styles/${sheet}`);
  }
}

if (problems.length > 0) {
  for (const problem of problems) {
    console.error(problem);
  }

  process.exitCode = 1;
} else {
  console.log(`styles: ${exported.size} modules, ${owners.size} classes, no global rule reaches into a module`);
}
