import { rmSync } from "node:fs";

/** Removes a temp directory of a test database. Windows releases the WAL file a moment after close, so retry. */
export async function removeDir(dir: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt >= 20) throw error;
      await Bun.sleep(100);
    }
  }
}
