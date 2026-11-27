// Asserts the contents of the tarball `npm pack` produced, using its `--json`
// report, so a change to `files`, `main`, `types` or the build output cannot
// silently ship a package that is missing its JS entry point, its typings or a
// native half. Usage: node check-tarball.mjs <npm-pack-output.json>
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const reportPath = process.argv[2];
if (!reportPath) {
  console.error("usage: node check-tarball.mjs <npm-pack-output.json>");
  process.exit(2);
}

const [report] = JSON.parse(readFileSync(reportPath, "utf8"));
const files = new Set(report.files.map((file) => file.path));
const manifest = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../package.json"), "utf8"));

const normalize = (path) => path.replace(/^\.\//, "");
const required = [
  "package.json",
  normalize(manifest.main),
  normalize(manifest.types),
  "expo-module.config.json",
  // Expo autolinking reads the podspec and the Gradle module straight from the
  // installed package; without them the native module is never linked.
  "ios/Asleep.podspec",
  "ios/AsleepModule.swift",
  "android/build.gradle",
  "android/src/main/AndroidManifest.xml",
  "android/src/main/java/ai/asleep/reactnative/AsleepModule.kt",
  "LICENSE.md",
];
const forbidden = [/^src\/.*__tests__\//, /^example\//, /^node_modules\//, /^\.github\//, /^scripts\//];

const errors = [];
for (const path of required) {
  if (!files.has(path)) errors.push(`missing required file: ${path}`);
}
for (const path of files) {
  if (forbidden.some((pattern) => pattern.test(path))) errors.push(`unexpected file in tarball: ${path}`);
}

if (report.name !== manifest.name || report.version !== manifest.version) {
  errors.push(`tarball is ${report.name}@${report.version}, expected ${manifest.name}@${manifest.version}`);
}

if (errors.length > 0) {
  for (const error of errors) console.error(`::error::${error}`);
  process.exit(1);
}

console.log(
  `${report.filename}: ${report.entryCount} files, ${report.size} bytes packed, ${report.unpackedSize} unpacked`,
);
