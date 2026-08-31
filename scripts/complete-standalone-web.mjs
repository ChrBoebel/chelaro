import { cp, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultRepositoryDirectory = path.dirname(scriptDirectory);
const defaultWebDirectory = path.join(defaultRepositoryDirectory, "apps", "web");
const requireFromWeb = createRequire(path.join(defaultWebDirectory, "package.json"));
const defaultHelpersDirectory = path.dirname(requireFromWeb.resolve("@swc/helpers/package.json"));

function requireChildPath(parentDirectory, childPath, label) {
  const relativePath = path.relative(parentDirectory, childPath);
  if (
    relativePath.length === 0 ||
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(`${label} must be a child of the repository`);
  }
  return relativePath;
}

export async function completeStandaloneWeb({
  repositoryDirectory = defaultRepositoryDirectory,
  webDirectory = defaultWebDirectory,
  helpersDirectory = defaultHelpersDirectory,
} = {}) {
  requireChildPath(repositoryDirectory, webDirectory, "Web directory");
  const relativeHelpersDirectory = requireChildPath(
    repositoryDirectory,
    helpersDirectory,
    "Helpers directory",
  );
  const sourceDirectory = path.join(helpersDirectory, "esm");
  const destinationDirectory = path.join(
    webDirectory,
    ".next",
    "standalone",
    relativeHelpersDirectory,
    "esm",
  );

  await mkdir(destinationDirectory, { recursive: true });
  await cp(sourceDirectory, destinationDirectory, { recursive: true, force: true });
}

const entrypoint = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : undefined;
if (entrypoint === import.meta.url) {
  await completeStandaloneWeb();
}
