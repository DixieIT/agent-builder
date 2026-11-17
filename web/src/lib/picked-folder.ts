/** Text files a bundle can hold; everything else (images, binaries, node_modules) is left out of the upload. */
const IMPORTABLE = /\.(ya?ml|md|py|ts|sh|txt|json)$/i;
const SKIP_DIR = /(^|\/)(\.git|node_modules|\.venv|__pycache__)(\/|$)/;
const MAX_FILE = 1_000_000;

export type PickedFolder = { name: string; files: { path: string; content: string }[]; skipped: number };

/** Reads a folder chosen with a `webkitdirectory` input: importable text files, paths relative to the picked folder. */
export async function readPickedFolder(list: FileList): Promise<PickedFolder> {
  const all = Array.from(list);
  const name = all[0].webkitRelativePath.split("/")[0] || "folder";
  const files: PickedFolder["files"] = [];
  let skipped = 0;
  for (const file of all) {
    // Paths come as "<picked folder>/<rest>"; the server recreates the folder under its own name.
    const rel = file.webkitRelativePath.split("/").slice(1).join("/");
    if (!rel || SKIP_DIR.test(rel) || !IMPORTABLE.test(rel) || file.size > MAX_FILE) {
      skipped++;
      continue;
    }
    files.push({ path: rel, content: await file.text() });
  }
  return { name, files, skipped };
}
