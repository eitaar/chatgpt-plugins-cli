#!/usr/bin/env node
import { run } from "../src/cli.js";

run(process.argv.slice(2)).catch((err) => {
  console.error(`error: ${err.message}`);
  process.exitCode = 1;
});
