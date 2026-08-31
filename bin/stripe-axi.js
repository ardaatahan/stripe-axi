#!/usr/bin/env node
import(new URL("../dist/index.js", import.meta.url).href).catch((err) => {
  if (err?.code === "ERR_MODULE_NOT_FOUND") {
    process.stdout.write("error: stripe-axi is not built\n");
    process.stdout.write("suggestion: run 'npm run build' in the stripe-axi checkout\n");
  } else {
    process.stdout.write(`error: stripe-axi failed to start: ${err?.message ?? err}\n`);
    process.stdout.write("suggestion: reinstall stripe-axi, or report this at https://github.com/ardaatahan/stripe-axi/issues\n");
  }
  process.exitCode = 1;
});
