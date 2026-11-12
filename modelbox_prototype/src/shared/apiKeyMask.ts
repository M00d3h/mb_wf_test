/**
 * Substring embedded in `BuildCommandResult.fullCommand` in place of the real `--api-key` value
 * (both `--api-key {mask}` and `--api-key={mask}`). The launch panel replaces this with the real
 * key when showing/copying, so it is never dependent on a fixed bullet count.
 */
export const API_KEY_COMMAND_MASK = "__LLAMAFRONT_APIKEY__" as const;
