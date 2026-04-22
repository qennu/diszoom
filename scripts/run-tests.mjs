import { readdir } from "fs/promises";
import path from "path";
import { spawn } from "child_process";

async function collectTestFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectTestFiles(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".test.js")) {
      files.push(fullPath);
    }
  }

  return files;
}

async function main() {
  const dirArg = process.argv[2];
  const listOnly = process.argv.includes("--list");
  if (!dirArg) {
    console.error("Usage: node scripts/run-tests.mjs <tests-directory>");
    process.exit(1);
  }

  const root = process.cwd();
  const targetDir = path.resolve(root, dirArg);
  const testFiles = (await collectTestFiles(targetDir)).sort();

  if (!testFiles.length) {
    console.error(`No test files found in: ${targetDir}`);
    process.exit(1);
  }

  if (listOnly) {
    for (const file of testFiles) {
      console.log(file);
    }
    return;
  }

  const child = spawn(process.execPath, ["--test", ...testFiles], {
    stdio: "inherit"
  });

  child.on("exit", code => process.exit(code ?? 1));
  child.on("error", err => {
    console.error(err);
    process.exit(1);
  });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
