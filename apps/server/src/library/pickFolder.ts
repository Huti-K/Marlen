import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

/**
 * Opens the operating system's native folder-picker dialog so the user can
 * choose the document library folder by browsing rather than typing a path.
 * The server runs on the user's own machine (this is a local-first app), so
 * shelling out to a short-lived OS helper is the whole implementation —
 * osascript on macOS, PowerShell's FolderBrowserDialog on Windows, zenity on
 * Linux.
 */

const execFile = promisify(execFileCb);

const PROMPT = "Choose the Trailin document folder";
/** Generous but bounded — a human needs time to browse, but a dialog that
 *  never got shown (or was abandoned) shouldn't hang the request forever. */
const DIALOG_TIMEOUT_MS = 180_000;
const EXEC_OPTS: { timeout: number; killSignal: NodeJS.Signals } = {
  timeout: DIALOG_TIMEOUT_MS,
  killSignal: "SIGKILL",
};

export type PickFolderResult = { path: string } | { canceled: true };

interface ExecFileError extends Error {
  code?: number | string;
  killed?: boolean;
  stdout?: string;
  stderr?: string;
}

function asExecError(error: unknown): ExecFileError | undefined {
  return error instanceof Error ? (error as ExecFileError) : undefined;
}

/** The helper binary itself couldn't be spawned (not installed / not on PATH). */
function isSpawnMissing(error: unknown): boolean {
  return asExecError(error)?.code === "ENOENT";
}

/** We killed the process ourselves after DIALOG_TIMEOUT_MS — treat like a cancel. */
function isTimeout(error: unknown): boolean {
  return asExecError(error)?.killed === true;
}

function exitCodeIs(error: unknown, code: number): boolean {
  return asExecError(error)?.code === code;
}

function unavailableError(): Error {
  return new Error("native folder dialog is not available on this system");
}

/** Guards against opening a second native dialog while one is already up. */
let dialogOpen = false;

/**
 * Opens the OS's native folder picker and resolves once the user picks a
 * folder or dismisses the dialog. Throws if this platform has no supported
 * picker (or the helper binary is missing), or if a dialog is already open.
 */
export async function pickFolder(): Promise<PickFolderResult> {
  // Test seam: set to a path (or "cancel") to fake the OS dialog's outcome
  // instead of actually opening one — used by integration tests.
  if (process.env.TRAILIN_FAKE_PICKER !== undefined) {
    const fake = process.env.TRAILIN_FAKE_PICKER;
    return fake === "cancel" ? { canceled: true } : { path: fake };
  }

  if (dialogOpen) throw new Error("a folder dialog is already open");
  dialogOpen = true;
  try {
    if (process.platform === "darwin") return await pickFolderDarwin();
    if (process.platform === "win32") return await pickFolderWin32();
    if (process.platform === "linux") return await pickFolderLinux();
    throw unavailableError();
  } finally {
    dialogOpen = false;
  }
}

async function pickFolderDarwin(): Promise<PickFolderResult> {
  try {
    const { stdout } = await execFile(
      "osascript",
      ["-e", `POSIX path of (choose folder with prompt "${PROMPT}")`],
      EXEC_OPTS,
    );
    return { path: stdout.trim() };
  } catch (error) {
    if (isSpawnMissing(error)) throw unavailableError();
    const stderr = asExecError(error)?.stderr ?? "";
    if (isTimeout(error) || stderr.includes("-128") || /user canceled/i.test(stderr)) {
      return { canceled: true };
    }
    throw error;
  }
}

async function pickFolderWin32(): Promise<PickFolderResult> {
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms;",
    "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog;",
    `$dialog.Description = "${PROMPT}";`,
    "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.SelectedPath }",
  ].join(" ");
  try {
    const { stdout } = await execFile(
      "powershell",
      ["-NoProfile", "-STA", "-Command", script],
      EXEC_OPTS,
    );
    const path = stdout.trim();
    return path ? { path } : { canceled: true };
  } catch (error) {
    if (isSpawnMissing(error)) throw unavailableError();
    if (isTimeout(error)) return { canceled: true };
    throw error;
  }
}

async function pickFolderLinux(): Promise<PickFolderResult> {
  try {
    const { stdout } = await execFile(
      "zenity",
      ["--file-selection", "--directory", `--title=${PROMPT}`],
      EXEC_OPTS,
    );
    return { path: stdout.trim() };
  } catch (error) {
    if (isSpawnMissing(error)) throw unavailableError();
    if (isTimeout(error) || exitCodeIs(error, 1)) return { canceled: true };
    throw error;
  }
}
