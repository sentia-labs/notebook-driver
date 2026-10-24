#!/usr/bin/env node
import { main } from '../src/cli.js';

main(process.argv.slice(2)).catch((err) => {
  console.error(`nbd: ${err.message}`);
  if (process.env.NBD_DEBUG) console.error(err.stack);
  process.exit(1);
});
