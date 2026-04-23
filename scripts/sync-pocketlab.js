const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");
const statePath = path.join(repoRoot, ".sync-state.json");
const dataDir = path.join(repoRoot, "data");
const targetCsvPath = path.join(dataDir, "latest.csv");

function parseArgs(argv) {
  const args = {
    sourceDir: null,
    pattern: ".csv",
    interval: 30,
    watch: false,
    noPush: false,
    archiveDir: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--source-dir") {
      args.sourceDir = argv[index + 1];
      index += 1;
    } else if (arg === "--pattern") {
      args.pattern = argv[index + 1];
      index += 1;
    } else if (arg === "--interval") {
      args.interval = Number.parseInt(argv[index + 1], 10);
      index += 1;
    } else if (arg === "--watch") {
      args.watch = true;
    } else if (arg === "--no-push") {
      args.noPush = true;
    } else if (arg === "--archive-dir") {
      args.archiveDir = argv[index + 1];
      index += 1;
    }
  }

  if (!args.sourceDir) {
    throw new Error("Missing required argument: --source-dir");
  }

  return args;
}

function loadState() {
  if (!fs.existsSync(statePath)) {
    return {};
  }
  return JSON.parse(fs.readFileSync(statePath, "utf8"));
}

function saveState(state) {
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

function getSignature(filePath) {
  const stat = fs.statSync(filePath);
  return `${stat.size}:${Math.floor(stat.mtimeMs)}`;
}

function listCsvFiles(sourceDir, patternSuffix) {
  return fs
    .readdirSync(sourceDir)
    .filter((name) => name.toLowerCase().endsWith(patternSuffix.toLowerCase()))
    .map((name) => path.join(sourceDir, name))
    .filter((filePath) => fs.statSync(filePath).isFile())
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function archiveFile(filePath, archiveDir) {
  ensureDir(archiveDir);
  const destination = path.join(archiveDir, path.basename(filePath));
  const finalDestination = fs.existsSync(destination)
    ? path.join(
        archiveDir,
        `${path.basename(filePath, path.extname(filePath))}-${Date.now()}${path.extname(filePath)}`
      )
    : destination;
  fs.renameSync(filePath, finalDestination);
  return finalDestination;
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: false,
    ...options,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${command} exited with code ${result.status}`);
  }
}

function canUseGit() {
  const result = spawnSync("git", ["--version"], {
    cwd: repoRoot,
    stdio: "ignore",
    shell: false,
  });
  return result.status === 0;
}

function syncOnce(args, state) {
  ensureDir(dataDir);
  const files = listCsvFiles(args.sourceDir, args.pattern);
  if (files.length === 0) {
    console.log("No CSV files found in source directory.");
    return false;
  }

  const newestFile = files[0];
  const signature = getSignature(newestFile);
  if (state.lastSignature === signature && state.lastSourcePath === newestFile) {
    console.log("No new PocketLab export detected.");
    return false;
  }

  fs.copyFileSync(newestFile, targetCsvPath);
  console.log(`Copied ${newestFile} -> ${targetCsvPath}`);

  let archivedPath = null;
  if (args.archiveDir) {
    archivedPath = archiveFile(newestFile, args.archiveDir);
    console.log(`Archived source file to ${archivedPath}`);
  }

  state.lastSignature = signature;
  state.lastSourcePath = newestFile;
  state.lastSyncedAt = new Date().toISOString();
  state.lastArchivedPath = archivedPath;
  saveState(state);

  if (args.noPush) {
    console.log("Skipping git add/commit/push because --no-push was supplied.");
    return true;
  }

  if (!canUseGit()) {
    console.log("Git is not available on PATH. Data file was updated locally only.");
    return true;
  }

  runCommand("git", ["add", "data/latest.csv", ".sync-state.json"]);
  runCommand("git", ["commit", "-m", `Update PocketLab data ${new Date().toISOString()}`]);
  runCommand("git", ["push"]);
  return true;
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const state = loadState();

    if (!fs.existsSync(args.sourceDir) || !fs.statSync(args.sourceDir).isDirectory()) {
      throw new Error(`Source directory does not exist: ${args.sourceDir}`);
    }

    syncOnce(args, state);

    if (args.watch) {
      console.log(`Watching ${args.sourceDir} every ${args.interval} seconds.`);
      setInterval(() => {
        try {
          syncOnce(args, state);
        } catch (error) {
          console.error(error.message);
        }
      }, args.interval * 1000);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

main();
