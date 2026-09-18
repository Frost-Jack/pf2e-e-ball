import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(resolve(root, "module.json"), "utf8"));
const expectedFiles = ["dist/main.js", "dist/resource.js", "dist/styles.css"];

if (manifest.id !== "pf2e-e-ball") {
  throw new Error("module.json has an unexpected module id");
}

if (manifest.esmodules?.[0] !== expectedFiles[0] || manifest.styles?.[0] !== expectedFiles[2]) {
  throw new Error("module.json does not point at the expected build output");
}

await mkdir(resolve(root, "dist"), { recursive: true });
await Promise.all([
  copyFile(resolve(root, "src/main.js"), resolve(root, "dist/main.js")),
  copyFile(resolve(root, "src/resource.js"), resolve(root, "dist/resource.js")),
  copyFile(resolve(root, "src/styles.css"), resolve(root, "dist/styles.css"))
]);

console.log(`Built ${manifest.title} ${manifest.version}: ${expectedFiles.join(", ")}`);
