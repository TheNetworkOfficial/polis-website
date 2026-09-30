// Parser-only capacity check. Generated fictional rows and a local stub; no backend or network.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
const source = await readFile(
  new URL(
    "../../frontend/src/pages/shared-feed/scripts/organizationContactImport.js",
    import.meta.url,
  ),
);
const { uploadSharedContactRows, CONTACT_IMPORT_MAX_ROWS } = await import(
  `data:text/javascript;base64,${source.toString("base64")}`
);
globalThis.fetch = () => {
  throw new Error(
    "Network requests are forbidden in the parser capacity check.",
  );
};

function generatedFile(count) {
  return {
    stream: () => {
      let row = -1;
      return new ReadableStream({
        pull(controller) {
          if (row >= count) {
            controller.close();
            return;
          }
          let chunk = row < 0 ? "name,tax\n" : "";
          if (row < 0) row = 0;
          const end = Math.min(count, row + 1000);
          while (row < end) {
            chunk += `Fictional Person ${row},0007\n`;
            row++;
          }
          controller.enqueue(new TextEncoder().encode(chunk));
        },
      });
    },
  };
}
async function check(rows) {
  let transmitted = 0,
    requests = 0,
    completed = false,
    maxChunkRows = 0,
    maxPayloadBytes = 0,
    error;
  const started = performance.now(),
    initial = process.memoryUsage();
  let peakHeap = initial.heapUsed,
    peakRss = initial.rss;
  try {
    await uploadSharedContactRows({
      file: generatedFile(rows),
      delimiter: ",",
      encoding: "utf-8",
      job: {
        importId: "fictional-capacity",
        operationId: "local-capacity",
        columns: ["name", "tax"],
      },
      guard() {},
      progress() {},
      api: async (path, body) => {
        if (body.rows) {
          assert.equal(body.startRow, transmitted);
          transmitted += body.rows.length;
          requests++;
          maxChunkRows = Math.max(maxChunkRows, body.rows.length);
          maxPayloadBytes = Math.max(
            maxPayloadBytes,
            Buffer.byteLength(JSON.stringify(body)),
          );
          assert.equal(body.rows[0][1], "0007");
          if (requests % 100 === 0) {
            const memory = process.memoryUsage();
            peakHeap = Math.max(peakHeap, memory.heapUsed);
            peakRss = Math.max(peakRss, memory.rss);
          }
        } else {
          assert.ok(path.endsWith("/complete"));
          completed = true;
        }
        return {};
      },
    });
  } catch (caught) {
    error = caught;
  }
  assert.equal(transmitted, Math.min(rows, CONTACT_IMPORT_MAX_ROWS));
  assert.ok(maxChunkRows <= 100 && maxPayloadBytes <= 900000);
  if (rows > CONTACT_IMPORT_MAX_ROWS) {
    assert.match(error?.message || "", /exceeds the supported/);
    assert.equal(completed, false);
  } else {
    assert.ifError(error);
    assert.equal(completed, true);
  }
  return {
    rows,
    transmitted,
    requests,
    maxChunkRows,
    maxPayloadBytes,
    completed,
    rejected: !!error,
    elapsedMs: Math.round(performance.now() - started),
    initialHeapBytes: initial.heapUsed,
    peakObservedHeapBytes: peakHeap,
    initialRssBytes: initial.rss,
    peakObservedRssBytes: peakRss,
  };
}
console.log(
  JSON.stringify(
    {
      evidence:
        "parser capacity only; no deployed ingestion or provider throughput measured",
      supportedMaxRows: CONTACT_IMPORT_MAX_ROWS,
      results: [
        await check(CONTACT_IMPORT_MAX_ROWS),
        await check(CONTACT_IMPORT_MAX_ROWS + 1),
      ],
    },
    null,
    2,
  ),
);
