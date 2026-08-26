import { composeBarn } from "./compose.js";

const port = Number(process.env["PORT"] ?? 4477);
const { app, categorizerMode } = composeBarn({
  dbPath: process.env["BARN_DB"] ?? "data/barn.sqlite",
  blobDir: process.env["BARN_BLOBS"] ?? "data/blobs",
});

await app.listen({ port, host: "0.0.0.0" });
console.log(`🐴 barn listening on :${port} — categorizer: ${categorizerMode}`);
console.log(`   review queue: http://localhost:${port}/`);
