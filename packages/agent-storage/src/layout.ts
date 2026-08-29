import { lstatSync, mkdirSync, rmSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

const MEBIBYTE = 1024 * 1024;

export const AGENT_IMAGE_SPECS = Object.freeze([
  { capacityBytes: 256 * MEBIBYTE, id: "control", volumeName: "Chelaro Agent Control" },
  { capacityBytes: 512 * MEBIBYTE, id: "workspace", volumeName: "Chelaro Agent Workspace" },
  { capacityBytes: 512 * MEBIBYTE, id: "baseline", volumeName: "Chelaro Agent Baseline" },
  { capacityBytes: 512 * MEBIBYTE, id: "recovery", volumeName: "Chelaro Agent Recovery" },
] as const);

export type AgentImageId = (typeof AGENT_IMAGE_SPECS)[number]["id"];

export const MAX_AGENT_IMAGE_BYTES = AGENT_IMAGE_SPECS.reduce(
  (total, image) => total + image.capacityBytes,
  0,
);
export const MAX_AGENT_RUNTIME_BYTES = MEBIBYTE;
export const MAX_AGENT_OVERHEAD_BYTES = 256 * MEBIBYTE;
export const MAX_AGENT_STORAGE_BYTES = 2 * 1024 * MEBIBYTE;

export interface AgentStorageLayout {
  agentRoot: string;
  imagesRoot: string;
  mounts: Readonly<Record<AgentImageId, string>>;
  mountsRoot: string;
  runtimeRoot: string;
  sparseBundles: Readonly<Record<AgentImageId, string>>;
}

export class AgentStoragePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentStoragePathError";
  }
}

export function resolveAgentStorageLayout(userDataRoot: string): AgentStorageLayout {
  if (!isAbsolute(userDataRoot)) {
    throw new AgentStoragePathError("Electron userData root must be absolute.");
  }
  const agentRoot = join(resolve(userDataRoot), "agent");
  const imagesRoot = join(agentRoot, "images");
  const mountsRoot = join(agentRoot, "mounts");
  return {
    agentRoot,
    imagesRoot,
    mounts: Object.fromEntries(AGENT_IMAGE_SPECS.map(({ id }) => [id, join(mountsRoot, id)])) as Record<AgentImageId, string>,
    mountsRoot,
    runtimeRoot: join(agentRoot, "runtime"),
    sparseBundles: Object.fromEntries(AGENT_IMAGE_SPECS.map(({ id }) => [id, join(imagesRoot, `${id}.sparsebundle`)])) as Record<AgentImageId, string>,
  };
}

export function initializeAgentStorageLayout(layout: AgentStorageLayout): void {
  for (const directory of [layout.agentRoot, layout.imagesRoot, layout.mountsRoot, layout.runtimeRoot]) {
    mkdirSync(directory, { mode: 0o700, recursive: true });
    assertOwnedDirectory(directory);
  }
}

export function assertManagedPath(agentRoot: string, target: string): string {
  const canonicalRoot = resolve(agentRoot);
  assertOwnedDirectory(canonicalRoot);
  const resolvedTarget = resolve(target);
  if (resolvedTarget === canonicalRoot || !resolvedTarget.startsWith(`${canonicalRoot}${sep}`)) {
    throw new AgentStoragePathError("Managed path must be a child of the agent root.");
  }

  const pathFromRoot = relative(canonicalRoot, resolvedTarget);
  let current = canonicalRoot;
  for (const segment of pathFromRoot.split(sep)) {
    current = join(current, segment);
    try {
      const metadata = lstatSync(current);
      if (metadata.isSymbolicLink()) {
        throw new AgentStoragePathError("Managed paths cannot traverse symbolic links.");
      }
      if (metadata.uid !== process.getuid?.()) {
        throw new AgentStoragePathError("Managed path owner does not match the current user.");
      }
    } catch (error) {
      if (isMissingPath(error)) {
        break;
      }
      throw error;
    }
  }
  return resolvedTarget;
}

export function removeManagedTree(agentRoot: string, target: string): void {
  const managedTarget = assertManagedPath(agentRoot, target);
  rmSync(managedTarget, { force: true, recursive: true });
}

function assertOwnedDirectory(path: string): void {
  const metadata = lstatSync(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new AgentStoragePathError("Agent storage path must be a real directory.");
  }
  if (metadata.uid !== process.getuid?.()) {
    throw new AgentStoragePathError("Agent storage path owner does not match the current user.");
  }
}

function isMissingPath(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
