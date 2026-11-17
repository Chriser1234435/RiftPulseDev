import assert from "node:assert/strict";
import test from "node:test";
import { beatSaverSongName, parseBeatSaverMapKey, parseSongRequestCommand } from "../../packages/shared/src/song-requests.ts";

test("BeatSaver keys and canonical map URLs are normalized", () => {
  assert.equal(parseBeatSaverMapKey("ABC123"), "abc123");
  assert.equal(parseBeatSaverMapKey("https://beatsaver.com/maps/ABC123"), "abc123");
  assert.equal(parseBeatSaverMapKey("https://www.beatsaver.com/maps/abc123/"), "abc123");
});

test("BeatSaver parser rejects non-BeatSaver or malformed URLs", () => {
  assert.equal(parseBeatSaverMapKey("https://example.com/maps/abc123"), null);
  assert.equal(parseBeatSaverMapKey("http://beatsaver.com.evil.invalid/maps/abc123"), null);
  assert.equal(parseBeatSaverMapKey("abcXYZ"), null);
  assert.equal(parseBeatSaverMapKey(""), null);
});

test("configured BSR command matches only a whole command prefix", () => {
  assert.deepEqual(parseSongRequestCommand("!bsr ABC123", "!bsr"), {
    matched: true, mapKey: "abc123", rawInput: "ABC123", error: null,
  });
  assert.equal(parseSongRequestCommand("!bsrfun ABC123", "!bsr").matched, false);
  assert.equal(parseSongRequestCommand("hello !bsr ABC123", "!bsr").matched, false);
  assert.equal(parseSongRequestCommand("!play ABC123", "!bsr").matched, false);
});

test("matched commands distinguish missing and invalid map IDs", () => {
  assert.deepEqual(parseSongRequestCommand("!bsr", "!bsr"), {
    matched: true, mapKey: null, rawInput: "", error: "missing_map_id",
  });
  assert.deepEqual(parseSongRequestCommand("!bsr not-a-key", "!bsr"), {
    matched: true, mapKey: null, rawInput: "not-a-key", error: "invalid_map_id",
  });
});

test("BeatSaver map titles use song metadata with a subtitle when present", () => {
  assert.equal(beatSaverSongName({ metadata: { songName: "Example", songSubName: "Mix" } }), "Example Mix");
  assert.equal(beatSaverSongName({ name: "Fallback title" }), "Fallback title");
  assert.equal(beatSaverSongName({ metadata: {} }), null);
});
