// Does parallelism actually help THIS link, right now?
//
//   node --env-file=.env.local scripts/probe-link.mjs --folder="clients/Diyora at CCA"
//   node --env-file=.env.local scripts/probe-link.mjs --folder=... --streams 4
//
// build-ladder --jobs only pays off if one TCP stream leaves bandwidth on the
// table. On a high-latency route it usually does; on a link that is simply
// slow, four streams share the same ceiling and you get the same bytes per
// second with four times the memory in flight.
//
// The two runs you get from build-ladder cannot answer this, because they
// happen at different times and a domestic link does not hold still. So this
// measures one stream, then N, then ONE AGAIN — and if the two single-stream
// numbers disagree, it says the measurement is void rather than pretending the
// middle number meant something.
//
// Downloads only. Nothing is written, nothing is uploaded, no rows are touched.

import process from "node:process";

const argv = process.argv.slice(2);
const val = (f, d = null) => {
  const exact = argv.find((a) => a.startsWith(`--${f}=`));
  if (exact) return exact.slice(f.length + 3);
  const i = argv.indexOf(`--${f}`);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};

const ZONE = process.env.BUNNY_STORAGE_ZONE;
const KEY = process.env.BUNNY_STORAGE_API_KEY;
const HOST = (process.env.BUNNY_STORAGE_HOST ?? "storage.bunnycdn.com")
  .replace(/^https?:\/\//, "")
  .replace(/\/$/, "");

if (!ZONE || !KEY) {
  console.error(
    "Missing BUNNY_STORAGE_ZONE / BUNNY_STORAGE_API_KEY.\n" +
      "Run with:  node --env-file=.env.local scripts/probe-link.mjs --folder=<path>",
  );
  process.exit(1);
}

const FOLDER = val("folder");
const STREAMS = Number(val("streams", "4"));

if (!FOLDER) {
  console.error('Need a folder, e.g. --folder="clients/Diyora at CCA"');
  process.exit(1);
}
if (!Number.isInteger(STREAMS) || STREAMS < 2) {
  console.error("--streams must be a whole number of 2 or more.");
  process.exit(1);
}

const IMAGE_RE = /\.(jpe?g|png|webp|avif|tiff?)$/i;
const url = (p) => `https://${HOST}/${ZONE}/${String(p).replace(/^\/+/, "")}`;
const mbps = (bytes, ms) => ((bytes / 1024 / 1024) / (ms / 1000));
const fmt = (n) => `${n.toFixed(2)} MB/s (${(n * 8).toFixed(1)} Mbps)`;

/** Reads the whole body and reports bytes + wall time. Nothing is kept. */
async function timedGet(path) {
  const started = Date.now();
  const res = await fetch(url(path), { headers: { AccessKey: KEY } });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  let bytes = 0;
  // Count as it arrives rather than buffering: a 64 MB original held in memory
  // four times over is the thing this script exists to warn you about.
  for await (const chunk of res.body) bytes += chunk.length;
  return { bytes, ms: Date.now() - started };
}

async function list(folder) {
  const clean = folder.replace(/^\/+|\/+$/g, "");
  const res = await fetch(`https://${HOST}/${ZONE}/${clean}/`, {
    headers: { AccessKey: KEY, Accept: "application/json" },
  });
  if (res.status === 401) throw new Error(`401 — wrong key, or the zone is in another region.`);
  if (!res.ok) throw new Error(`List "${clean}": ${res.status} ${res.statusText}`);
  const entries = await res.json();
  return entries
    .filter((e) => !e.IsDirectory && IMAGE_RE.test(e.ObjectName))
    .map((e) => ({ path: `${clean}/${e.ObjectName}`, length: e.Length }));
}

async function main() {
  const files = await list(FOLDER);
  if (files.length < STREAMS + 2) {
    throw new Error(
      `Need at least ${STREAMS + 2} images in "${FOLDER}" to measure cleanly; found ${files.length}.`,
    );
  }

  const avgMb = files.reduce((n, f) => n + f.length, 0) / files.length / 1024 / 1024;
  console.log(`\nProbe  ${ZONE} @ ${HOST}`);
  console.log(`Folder ${FOLDER} — ${files.length} images, ${avgMb.toFixed(1)} MB average\n`);
  console.log(
    `Every file below is downloaded once and discarded. Peak memory is one\n` +
      `chunk, not one photograph.\n`,
  );

  // Different files at every phase, so nothing is answered from a CDN or OS
  // cache that the previous phase warmed.
  const a = files[0];
  const parallel = files.slice(1, 1 + STREAMS);
  const b = files[1 + STREAMS];

  console.log(`1. One stream`);
  const one = await timedGet(a.path);
  const oneRate = mbps(one.bytes, one.ms);
  console.log(`   ${(one.bytes / 1024 / 1024).toFixed(1)} MB in ${(one.ms / 1000).toFixed(1)}s — ${fmt(oneRate)}\n`);

  console.log(`2. ${STREAMS} streams at once`);
  const started = Date.now();
  const many = await Promise.all(parallel.map((f) => timedGet(f.path)));
  const manyMs = Date.now() - started;
  const manyBytes = many.reduce((n, r) => n + r.bytes, 0);
  const manyRate = mbps(manyBytes, manyMs);
  console.log(`   ${(manyBytes / 1024 / 1024).toFixed(1)} MB in ${(manyMs / 1000).toFixed(1)}s — ${fmt(manyRate)}`);
  console.log(
    `   slowest single stream ${(Math.max(...many.map((r) => r.ms)) / 1000).toFixed(1)}s, ` +
      `fastest ${(Math.min(...many.map((r) => r.ms)) / 1000).toFixed(1)}s\n`,
  );

  console.log(`3. One stream again — the control`);
  const two = await timedGet(b.path);
  const twoRate = mbps(two.bytes, two.ms);
  console.log(`   ${(two.bytes / 1024 / 1024).toFixed(1)} MB in ${(two.ms / 1000).toFixed(1)}s — ${fmt(twoRate)}\n`);

  // ---- verdict -----------------------------------------------------------
  const drift = Math.abs(oneRate - twoRate) / Math.max(oneRate, twoRate);
  const baseline = (oneRate + twoRate) / 2;
  const gain = manyRate / baseline;

  console.log("─".repeat(62));

  if (drift > 0.35) {
    console.log(
      `\nVOID. The two single-stream measurements disagree by ` +
        `${(drift * 100).toFixed(0)}%\n(${fmt(oneRate)} then ${fmt(twoRate)}), so the link moved underneath\n` +
        `the test and the middle number means nothing.\n\n` +
        `That instability is itself the finding: it is what turned your serial\n` +
        `build from 23s a photo into 100s+ a photo without anything changing in\n` +
        `the script. Run this again when the connection is quiet.\n`,
    );
    process.exitCode = 2;
    return;
  }

  console.log(
    `\nSingle stream   ${fmt(baseline)}   (two measurements ${(drift * 100).toFixed(0)}% apart — stable enough)\n` +
      `${String(STREAMS).padStart(2)} streams       ${fmt(manyRate)}\n` +
      `Gain            ${gain.toFixed(2)}×\n`,
  );

  if (gain >= 1.6) {
    console.log(
      `USE --jobs ${STREAMS}. One stream is leaving ${((1 - 1 / gain) * 100).toFixed(0)}% of your\n` +
        `bandwidth unused, which is exactly what photo-level concurrency picks up.\n`,
    );
  } else if (gain >= 1.15) {
    console.log(
      `--jobs 2 is worth it; ${STREAMS} is not. The gain is real but small, and\n` +
        `every extra worker holds another decoded frame in memory.\n`,
    );
  } else {
    console.log(
      `DO NOT use --jobs. Your link is already saturated by one stream, so\n` +
        `more of them divide the same bandwidth and add memory pressure for\n` +
        `nothing. The bottleneck is the pipe, not the number of connections —\n` +
        `run the build somewhere closer to Falkenstein instead.\n`,
    );
  }
}

main().catch((err) => {
  console.error(`\nFailed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
