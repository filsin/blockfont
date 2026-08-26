import { isAbsolute, posix, relative, resolve, win32 } from "node:path";

import { AssetError, AssetVersionError } from "./errors";

export interface ResourceLocation {
  readonly namespace: string;
  readonly path: string;
}

export type ResourceLocationInput = string | ResourceLocation;

const NAMESPACE_PATTERN = /^[a-z0-9_.-]+$/;
const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function invalidResource(message: string): never {
  throw new AssetError(message, { code: "invalid-asset" });
}

/**
 * Versions are identifiers, not path fragments. Keeping this validation at
 * the asset boundary prevents every source/store implementation from having
 * to reason about platform-specific separators independently.
 */
export function isSafeAssetVersion(version: string): boolean {
  return typeof version === "string" && VERSION_PATTERN.test(version);
}

export function validateAssetVersion(version: string): string {
  if (!isSafeAssetVersion(version)) {
    throw new AssetVersionError(
      `Invalid Minecraft version identifier: ${String(version)}`,
      version,
    );
  }
  return version;
}

/** Resolves a resource-relative path while proving it remains below root. */
export function resolveAssetPathWithinRoot(
  rootDirectory: string,
  resourcePath: string,
): string {
  const root = resolve(rootDirectory);
  const candidate = resolve(root, resourcePath);
  const fromRoot = relative(root, candidate);
  if (
    resourcePath.length === 0 ||
    resourcePath.includes("\0") ||
    resourcePath.includes("\\") ||
    resourcePath.includes(":") ||
    resourcePath.split("/").some((segment) => segment === ".." || segment === "." || segment.length === 0) ||
    isAbsolute(resourcePath) ||
    win32.isAbsolute(resourcePath) ||
    fromRoot === ".." ||
    fromRoot.startsWith(`..${posix.sep}`) ||
    isAbsolute(fromRoot) ||
    win32.isAbsolute(fromRoot)
  ) {
    invalidResource(`Resource path escapes the asset root: ${resourcePath}`);
  }
  return candidate;
}

function validatePath(resourcePath: string): string {
  const normalized = resourcePath.replaceAll("\\", "/").replace(/^\.\//, "");
  if (
    resourcePath.includes("\0") ||
    resourcePath.includes(":") ||
    normalized.length === 0 ||
    normalized.startsWith("/") ||
    win32.isAbsolute(resourcePath) ||
    normalized.split("/").some((segment) => segment === ".." || segment.length === 0 || segment === ".")
  ) {
    invalidResource(`Invalid resource path: ${resourcePath}`);
  }

  const cleaned = posix.normalize(normalized);
  if (cleaned === "." || cleaned.startsWith("../") || cleaned.includes("/../")) {
    invalidResource(`Resource path escapes the asset root: ${resourcePath}`);
  }
  return cleaned;
}

/** Parses a Minecraft namespace:path identifier, defaulting to minecraft. */
export function parseResourceLocation(input: ResourceLocationInput): ResourceLocation {
  if (typeof input !== "string") {
    if (
      input === null ||
      typeof input.namespace !== "string" ||
      typeof input.path !== "string"
    ) {
      invalidResource("Resource location must contain a namespace and path");
    }
    const namespace = input.namespace.trim().toLowerCase();
    if (!NAMESPACE_PATTERN.test(namespace) || namespace === "." || namespace === "..") {
      invalidResource(`Invalid resource namespace: ${input.namespace}`);
    }
    return Object.freeze({ namespace, path: validatePath(input.path) });
  }

  const value = input.trim().replaceAll("\\", "/");
  if (value.length === 0) {
    invalidResource("Resource location must not be empty");
  }

  let withoutAssets = value;
  if (withoutAssets.startsWith("assets/")) {
    withoutAssets = withoutAssets.slice("assets/".length);
  }

  const separator = withoutAssets.indexOf(":");
  const namespace = separator === -1 ? "minecraft" : withoutAssets.slice(0, separator);
  const resourcePath = separator === -1 ? withoutAssets : withoutAssets.slice(separator + 1);
  const normalizedNamespace = namespace.trim().toLowerCase();
  if (
    !NAMESPACE_PATTERN.test(normalizedNamespace) ||
    normalizedNamespace === "." ||
    normalizedNamespace === ".."
  ) {
    invalidResource(`Invalid resource namespace: ${namespace}`);
  }

  return Object.freeze({
    namespace: normalizedNamespace,
    path: validatePath(resourcePath),
  });
}

/** Returns the path used below an unpacked Minecraft assets directory. */
export function resourceLocationToAssetPath(input: ResourceLocationInput): string {
  const resource = parseResourceLocation(input);
  return posix.join("assets", resource.namespace, resource.path);
}

/** Returns candidate relative paths below asset roots, including font/ -> textures/font/ aliases. */
export function getAssetCandidateRelativePaths(input: ResourceLocationInput): readonly string[] {
  const parsed = parseResourceLocation(input);
  const primaryPath = resourceLocationToAssetPath(parsed);
  const relativePaths = [primaryPath, primaryPath.slice("assets/".length)];
  if (parsed.path.startsWith("font/")) {
    const textureParsed = { namespace: parsed.namespace, path: `textures/${parsed.path}` };
    const textureRelPath = resourceLocationToAssetPath(textureParsed);
    relativePaths.push(textureRelPath, textureRelPath.slice("assets/".length));
  }
  return relativePaths;
}

/** Normalizes a font id such as minecraft:default to a JSON font resource. */
export function normalizeFontId(fontId: string): string {
  const resource = parseResourceLocation(fontId);
  let fontPath = resource.path;
  if (!fontPath.startsWith("font/")) {
    fontPath = posix.join("font", fontPath);
  }
  if (!fontPath.endsWith(".json")) {
    fontPath += ".json";
  }
  return `${resource.namespace}:${fontPath}`;
}

/** Extracts a canonical resource id from a font id. */
export function fontIdToResourceLocation(fontId: string): ResourceLocation {
  const normalized = normalizeFontId(fontId);
  return parseResourceLocation(normalized);
}

/** A deterministic key useful for in-memory stores and cache files. */
export function resourceLocationKey(
  version: string,
  resource: ResourceLocationInput,
): string {
  validateAssetVersion(version);
  const parsed = parseResourceLocation(resource);
  return `${version}\0${parsed.namespace}:${parsed.path}`;
}
