import * as cp from "child_process";
import * as fs from "fs";
import * as path from "path";

export function resolveHermesExecutable(configured: string): string {
  // If it looks like a bare command (no slashes or backslashes), try to locate it in PATH
  if (!configured.includes(path.sep) && !configured.includes("/")) {
    try {
      const cmd = process.platform === "win32" ? "where" : "which";
      const result = cp.execFileSync(cmd, [configured], { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] });
      const found = result.trim().split(/\r?\n/)[0];
      if (found && fs.existsSync(found)) {
        return found;
      }
    } catch {
      // ignore — fall back to configured value so spawn gives a standard error
    }
  } else {
    // It's a path — normalize and check existence
    const normalized = path.normalize(configured);
    if (fs.existsSync(normalized)) {
      return normalized;
    }
  }
  return configured;
}
