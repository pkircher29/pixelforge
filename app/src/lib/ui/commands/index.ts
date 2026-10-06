/** Importing this module registers every shell command. */
import "./file";
import "./edit";
import "./layer";
import "./select";
import "./view";

export { syncRecentCommands, openPaths, closeDocument, newDocument } from "./file";
export { syncWindowPanelCommands } from "./view";
