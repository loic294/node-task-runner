const startedAt = new Date().toISOString();

console.log(`[INFO] Example task 2 started at ${startedAt}`);
console.log("[INFO] Running nightly summary simulation");

const stages = [
  "collect-inputs",
  "validate-records",
  "aggregate-metrics",
  "build-artifacts",
  "publish-results",
];

for (let i = 0; i < stages.length; i += 1) {
  const stage = stages[i];
  console.log(`[INFO] stage=${stage} status=started`);

  for (let row = 1; row <= 40; row += 1) {
    const id = `${stage}-item-${String(row).padStart(3, "0")}`;
    const ms = 20 + ((i * 11 + row * 5) % 140);
    console.log(`[INFO] ${id} duration=${ms}ms status=ok`);

    if (row % 15 === 0) {
      console.log(
        `[INFO] stage=${stage} progress=${row}/40 processed_total=${i * 40 + row}`,
      );
    }
  }

  console.log(`[INFO] stage=${stage} status=completed`);
}

console.log("[INFO] summary written to ./output/summary.json");
console.log(`[INFO] Example task 2 completed at ${new Date().toISOString()}`);

process.exit(0);
