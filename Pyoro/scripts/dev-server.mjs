import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".md", "text/markdown; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".ttf", "font/ttf"],
  [".txt", "text/plain; charset=utf-8"],
  [".wav", "audio/wav"],
  [".webp", "image/webp"],
]);

const projectRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const defaultPort = 4173;

function parsePort() {
  const explicitPortIndex = process.argv.indexOf("--port");
  if (explicitPortIndex >= 0) {
    const nextValue = Number.parseInt(process.argv[explicitPortIndex + 1] || "", 10);
    if (Number.isInteger(nextValue) && nextValue > 0) {
      return nextValue;
    }
  }

  const positionalPort = Number.parseInt(process.argv[2] || "", 10);
  if (Number.isInteger(positionalPort) && positionalPort > 0) {
    return positionalPort;
  }

  const envPort = Number.parseInt(process.env.PORT || "", 10);
  if (Number.isInteger(envPort) && envPort > 0) {
    return envPort;
  }

  return defaultPort;
}

function resolveRequestPath(requestUrl) {
  const url = new URL(requestUrl || "/", "http://127.0.0.1");
  const pathname = decodeURIComponent(url.pathname);
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const normalizedPath = path.normalize(requestedPath).replace(/^([.][/\\])+/, "");
  const absolutePath = path.join(projectRoot, normalizedPath);

  if (!absolutePath.startsWith(projectRoot)) {
    return null;
  }

  return absolutePath;
}

async function readFromDisk(absolutePath) {
  const fileStat = await stat(absolutePath);
  if (fileStat.isDirectory()) {
    return readFromDisk(path.join(absolutePath, "index.html"));
  }

  const extension = path.extname(absolutePath).toLowerCase();
  const mimeType = MIME_TYPES.get(extension) || "application/octet-stream";
  const body = await readFile(absolutePath);

  return { body, mimeType };
}

const server = createServer(async (request, response) => {
  const absolutePath = resolveRequestPath(request.url);
  if (!absolutePath) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }

  try {
    const { body, mimeType } = await readFromDisk(absolutePath);
    response.writeHead(200, {
      "Cache-Control": "no-cache",
      "Content-Type": mimeType,
    });
    response.end(body);
  } catch (_error) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
});

const port = parsePort();
server.listen(port, () => {
  console.log(`Pyoro Web available at http://127.0.0.1:${port}/`);
});
