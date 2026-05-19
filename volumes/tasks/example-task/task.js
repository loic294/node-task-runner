const startedAt = new Date().toISOString();

console.log(`[INFO] Example task started at ${startedAt}`);
console.log("[INFO] Initializing pipeline: source-sync -> transform -> export");
console.log("[INFO] Environment: demo");

for (let section = 1; section <= 8; section += 1) {
  console.log(`[INFO] ----- Section ${section} begin -----`);

  for (let i = 1; i <= 60; i += 1) {
    const itemId = `sec-${String(section).padStart(2, "0")}-row-${String(i).padStart(3, "0")}`;
    const durationMs = 12 + ((section * 7 + i * 3) % 85);
    const status = i % 17 === 0 ? "WARN" : "INFO";

    if (status === "WARN") {
      console.log(
        `[WARN] ${itemId} high latency detected (${durationMs}ms). Retrying with fallback parser`,
      );
      console.log(
        `[INFO] ${itemId} retry succeeded. normalized_fields=12 duplicate_keys=0`,
      );
    } else {
      console.log(
        `[INFO] ${itemId} processed. duration=${durationMs}ms transformed_fields=${10 + (i % 6)} exported=true`,
      );
    }

    if (i % 20 === 0) {
      console.log(
        `[INFO] section=${section} checkpoint=${i}/60 records_written=${section * i} memory_mb=${110 + section + (i % 9)}`,
      );
    }
  }

  console.log(`[INFO] ----- Section ${section} complete -----`);
}

console.log("[INFO] Aggregating metrics...");
console.log("[INFO] total_sections=8 total_rows=480 warnings=24 retries=24");
console.log("[INFO] writing summary artifacts to ./output/example-report.json");
console.log("[INFO] export finished");
console.log(`[INFO] Example task completed at ${new Date().toISOString()}`);

process.exit(0);
