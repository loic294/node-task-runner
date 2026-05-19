#!/usr/bin/env node

import { execSync } from "node:child_process";

try {
  execSync("npm version patch --no-git-tag-version", {
    stdio: "inherit",
  });
} catch (error) {
  process.stderr.write("Failed to bump version in pre-commit hook.\n");
  process.exit(error?.status || 1);
}
