#!/usr/bin/env node
import { run } from "../src/cli.js";

run(process.argv.slice(2))
  .then((code) => {
    if (typeof code === "number" && code !== 0) process.exitCode = code;
  })
  .catch((err) => {
    console.error(`error: ${err.message}`);
    process.exitCode = 1;
  });
