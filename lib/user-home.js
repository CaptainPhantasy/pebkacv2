import { homedir } from "os";
import { resolve } from "path";
// Explicit sandbox/storage root. Never changes HOME or CODEX_HOME.
export function userHome() { return process.env.PEBKAC_USER_HOME ? resolve(process.env.PEBKAC_USER_HOME) : homedir(); }
