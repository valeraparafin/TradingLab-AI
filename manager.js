import { readdirSync, existsSync } from "fs";
import path from "path";
import { spawn } from "child_process";
import readline from "readline";
import { parseArgs } from "util";

const STRATEGIES_DIR = "strategies";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function main() {
  const args = parseArgs({
    args: process.argv.slice(2),
    options: {
      strategy: { type: "string", short: "s" },
    },
    allowPositionals: true,
  });

  const strategyName = args.values.strategy;

  if (strategyName) {
    // Automatic Mode: Launch specified strategy immediately
    const strategyPath = path.join(STRATEGIES_DIR, `${strategyName}.json`);

    // Verify if the file exists
    if (!existsSync(strategyPath)) {
      console.error(`Error: Strategy '${strategyName}' not found at ${strategyPath}`);
      process.exit(1);
    }

    console.log(`\n🚀 Launching bot_engine.js with strategy: ${strategyName}...\n`);
    const child = spawn("node", ["bot_engine.js", strategyPath], {
      stdio: "inherit",
      shell: true
    });

    child.on("close", (code) => {
      process.exit(code);
    });
    return;
  }

  // Interactive Mode: menu for the user
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  Trading Strategy Manager");
  console.log("═══════════════════════════════════════════════════════════");

  try {
    const files = readdirSync(STRATEGIES_DIR).filter(file => file.endsWith(".json"));

    if (files.length === 0) {
      console.log("No strategy files found in /strategies folder.");
      process.exit(0);
    }

    console.log("\nAvailable Strategies:");
    files.forEach((file, index) => {
      console.log(`${index + 1}. ${file.replace(".json", "")}`);
    });

    const answer = await new Promise((resolve) => {
      rl.question("\nSelect a strategy number: ", (res) => resolve(res));
    });

    const selection = parseInt(answer) - 1;
    if (isNaN(selection) || selection < 0 || selection >= files.length) {
      console.log("Invalid selection. Exiting.");
      process.exit(1);
    }

    const selectedFile = files[selection];
    const strategyPath = path.join(STRATEGIES_DIR, selectedFile);

    console.log(`\nLaunching bot_engine.js with strategy: ${selectedFile}...\n`);
    const child = spawn("node", ["bot_engine.js", strategyPath], {
      stdio: "inherit",
      shell: true
    });

    child.on("close", (code) => {
      process.exit(code);
    });

  } catch (e) {
    console.error("Error:", e);
    process.exit(1);
  } finally {
    rl.close();
  }
}

main();

