const textEncoder = new TextEncoder();

function trimmedOr(value: string | undefined, fallback: string) {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? fallback : trimmed;
}

export interface GitFile {
  path: string;
  content: string;
}

export interface GitObject {
  type: "blob" | "tree" | "commit";
  sha: string;
  payload: Uint8Array;
}

export interface GitRepository {
  branch: "main";
  commitSha: string;
  objects: GitObject[];
}

export interface GitCommitOptions {
  parentSha?: string;
  message?: string;
  authorName?: string;
  authorEmail?: string;
  timestamp?: number;
}

export interface GitRef {
  ref: string;
  sha: string;
}

interface TreeNode {
  files: Map<string, Uint8Array>;
  dirs: Map<string, TreeNode>;
}

export function gitRemoteUrl(
  origin: string,
  workspaceId: string,
  repo: string,
) {
  const base = origin.replace(/\/$/u, "");
  return `${base}/git/${encodeURIComponent(workspaceId)}/${encodeURIComponent(repo)}.git`;
}

export function gitRepoSlug(name: string) {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .slice(0, 64) || "agent"
  );
}

export async function buildGitRepository(
  files: readonly GitFile[],
  options: GitCommitOptions = {},
): Promise<GitRepository> {
  const objects = new Map<string, GitObject>();
  const root: TreeNode = { files: new Map(), dirs: new Map() };
  for (const file of files) {
    insertFile(
      root,
      file.path.split("/").filter(Boolean),
      textEncoder.encode(file.content),
    );
  }
  const treeSha = await writeTree(root, objects);
  const name = trimmedOr(options.authorName, "Chief");
  const email = trimmedOr(options.authorEmail, "chief@heychief.sh");
  const timestamp = options.timestamp ?? 1;
  const identity = `${name} <${email}> ${timestamp} +0000`;
  const message = trimmedOr(options.message, "Publish Eve agent from Chief");
  const commit = await gitObject(
    "commit",
    textEncoder.encode(
      [
        `tree ${treeSha}`,
        ...(options.parentSha ? [`parent ${options.parentSha}`] : []),
        `author ${identity}`,
        `committer ${identity}`,
        "",
        `${message}\n`,
      ].join("\n"),
    ),
  );
  objects.set(commit.sha, commit);
  return {
    branch: "main",
    commitSha: commit.sha,
    objects: [...objects.values()],
  };
}

export async function gitPackfile(repository: GitRepository) {
  const parts: Uint8Array[] = [
    textEncoder.encode("PACK"),
    u32(2),
    u32(repository.objects.length),
  ];
  for (const object of repository.objects) {
    parts.push(
      packObjectHeader(objectType(object.type), object.payload.byteLength),
    );
    parts.push(await zlibDeflate(object.payload));
  }
  const body = concat(parts);
  const checksum = new Uint8Array(await crypto.subtle.digest("SHA-1", body));
  return concat([body, checksum]);
}

export function gitUploadPackAdvertisement(commitSha: string) {
  return gitUploadPackAdvertisementForRefs([
    { ref: "refs/heads/main", sha: commitSha },
  ]);
}

export function gitUploadPackAdvertisementForRefs(refs: readonly GitRef[]) {
  const head = refs.find((ref) => ref.ref === "refs/heads/main") ?? refs[0];
  // side-band-64k: isomorphic-git (used by the hosted agent computer) always
  // demultiplexes the pack as side-band data. symref tells every client which
  // branch HEAD is, so a clone checks out main rather than guessing master.
  const capabilities = [
    "multi_ack_detailed",
    "no-done",
    "side-band-64k",
    "thin-pack",
    "ofs-delta",
    ...(head ? [`symref=HEAD:${head.ref}`] : []),
    "agent=chief/0.1",
  ].join(" ");
  const lines = [
    pkt(`# service=git-upload-pack\n`),
    flushPkt(),
    ...(head ? [pkt(`${head.sha} HEAD\0${capabilities}\n`)] : []),
    ...refs.map((ref) => pkt(`${ref.sha} ${ref.ref}\n`)),
    flushPkt(),
  ];
  return concat(lines);
}

export function gitUploadPackWants(body: Uint8Array) {
  const text = new TextDecoder().decode(body);
  return [...text.matchAll(/want ([a-fA-F0-9]{40})/gu)].map(
    (match) => match[1]?.toLowerCase() ?? "",
  );
}

export async function gitUploadPackResult(
  repository: GitRepository,
  body: Uint8Array,
) {
  const wants = gitUploadPackWants(body);
  if (
    wants.length > 0 &&
    !wants.includes(repository.commitSha) &&
    !wants.includes("0000000000000000000000000000000000000000")
  ) {
    return concat([
      pkt("ERR want is not advertised on this Chief Git repository\n"),
    ]);
  }
  const pack = await gitPackfile(repository);
  if (!gitUploadPackSideBand(body)) return concat([pkt("NAK\n"), pack]);
  // Side-band-64k frames carry at most 65520 bytes including the 4-byte
  // length and the 1-byte band, which is 1 for pack data.
  const frames: Uint8Array[] = [pkt("NAK\n")];
  for (let offset = 0; offset < pack.byteLength; offset += 65_515) {
    frames.push(
      pkt(concat([Uint8Array.of(1), pack.subarray(offset, offset + 65_515)])),
    );
  }
  frames.push(flushPkt());
  return concat(frames);
}

/** Whether the client asked for side-band output on its first want line. */
export function gitUploadPackSideBand(body: Uint8Array) {
  const text = new TextDecoder().decode(body);
  const firstWant = /want [a-fA-F0-9]{40}([^\n]*)/u.exec(text)?.[1] ?? "";
  return /(^|\s)side-band-64k(\s|$)/u.test(firstWant);
}

export function pkt(data: string | Uint8Array) {
  const bytes = encodePktPayload(data);
  const length = bytes.byteLength + 4;
  return concat([
    textEncoder.encode(length.toString(16).padStart(4, "0")),
    bytes,
  ]);
}

function encodePktPayload(data: string | Uint8Array) {
  return data instanceof Uint8Array ? data : textEncoder.encode(data);
}

export function flushPkt() {
  return textEncoder.encode("0000");
}

function insertFile(node: TreeNode, parts: string[], content: Uint8Array) {
  const [head, ...rest] = parts;
  if (!head) return;
  if (rest.length === 0) {
    node.files.set(head, content);
    return;
  }
  const next = node.dirs.get(head) ?? { files: new Map(), dirs: new Map() };
  node.dirs.set(head, next);
  insertFile(next, rest, content);
}

async function writeTree(node: TreeNode, objects: Map<string, GitObject>) {
  const entries: { name: string; mode: string; sha: string }[] = [];
  for (const [name, content] of node.files) {
    const blob = await gitObject("blob", content);
    objects.set(blob.sha, blob);
    entries.push({ name, mode: "100644", sha: blob.sha });
  }
  for (const [name, child] of node.dirs) {
    const sha = await writeTree(child, objects);
    entries.push({ name, mode: "40000", sha });
  }
  entries.sort((left, right) =>
    treeSortKey(left).localeCompare(treeSortKey(right)),
  );
  const payload = concat(
    entries.map((entry) => {
      const header = textEncoder.encode(`${entry.mode} ${entry.name}\0`);
      return concat([header, hexToBytes(entry.sha)]);
    }),
  );
  const tree = await gitObject("tree", payload);
  objects.set(tree.sha, tree);
  return tree.sha;
}

function treeSortKey(entry: { name: string; mode: string }) {
  return entry.mode === "40000" ? `${entry.name}/` : entry.name;
}

async function gitObject(
  type: GitObject["type"],
  payload: Uint8Array,
): Promise<GitObject> {
  const header = textEncoder.encode(`${type} ${payload.byteLength}\0`);
  const sha = bytesToHex(
    new Uint8Array(
      await crypto.subtle.digest("SHA-1", concat([header, payload])),
    ),
  );
  return { type, sha, payload };
}

function packObjectHeader(type: number, size: number) {
  const bytes: number[] = [];
  let value = size >> 4;
  let current = (type << 4) | (size & 15);
  while (value) {
    bytes.push(current | 0x80);
    current = value & 0x7f;
    value >>= 7;
  }
  bytes.push(current);
  return Uint8Array.from(bytes);
}

function objectType(type: GitObject["type"]) {
  if (type === "commit") return 1;
  if (type === "tree") return 2;
  return 3;
}

function u32(value: number) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value);
  return bytes;
}

function concat(parts: readonly Uint8Array[]) {
  const bytes = new Uint8Array(
    parts.reduce((total, part) => total + part.byteLength, 0),
  );
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function hexToBytes(value: string) {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

async function zlibDeflate(input: Uint8Array) {
  const stream = new Blob([copyBuffer(input)])
    .stream()
    .pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function copyBuffer(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
