/** Safe parsing helpers for viewer-submitted BeatSaver song requests. */
export type SongRequestParseResult =
  | { matched: false }
  | { matched: true; mapKey: string | null; rawInput: string; error: "missing_map_id" | "invalid_map_id" | null };

export function parseBeatSaverMapKey(input: string): string | null {
  const value = input.trim();
  if (!value || value.length > 300) return null;

  // Accept a bare hexadecimal map ID or a canonical BeatSaver map page URL.
  if (/^[a-f0-9]{4,12}$/i.test(value)) return value.toLowerCase();

  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.hostname.toLowerCase() !== "beatsaver.com" && url.hostname.toLowerCase() !== "www.beatsaver.com") return null;
    const match = url.pathname.match(/^\/maps\/([a-f0-9]{4,12})\/?$/i);
    return match ? match[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

export function parseSongRequestCommand(message: string, configuredCommand: string): SongRequestParseResult {
  const command = configuredCommand.trim();
  if (!/^![a-z0-9_-]{1,19}$/i.test(command)) return { matched: false };

  const text = message.trim();
  if (text.length < command.length || text.slice(0, command.length).toLowerCase() !== command.toLowerCase()) {
    return { matched: false };
  }
  if (text.length > command.length && !/\s/.test(text[command.length])) return { matched: false };

  const rawInput = text.slice(command.length).trim().slice(0, 300);
  if (!rawInput) return { matched: true, mapKey: null, rawInput: "", error: "missing_map_id" };
  const mapKey = parseBeatSaverMapKey(rawInput);
  return mapKey
    ? { matched: true, mapKey, rawInput, error: null }
    : { matched: true, mapKey: null, rawInput, error: "invalid_map_id" };
}

export function beatSaverSongName(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const root = payload as Record<string, unknown>;
  const metadata = root.metadata && typeof root.metadata === "object" && !Array.isArray(root.metadata)
    ? root.metadata as Record<string, unknown> : {};
  const songName = typeof metadata.songName === "string" ? metadata.songName.trim()
    : typeof root.name === "string" ? root.name.trim()
    : typeof root.songName === "string" ? root.songName.trim() : "";
  if (!songName) return null;
  const songSubName = typeof metadata.songSubName === "string" ? metadata.songSubName.trim() : "";
  return (songSubName ? songName + " " + songSubName : songName).slice(0, 180);
}
