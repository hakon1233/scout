import test from "node:test";
import assert from "node:assert/strict";
import { voiceSupported } from "./voice";

test("the mic shows only where the browser can record", () => {
  const getUserMedia = () => undefined;
  class MediaRecorder {}
  assert.equal(voiceSupported(null), false); // no window: server render
  assert.equal(
    voiceSupported({ navigator: { mediaDevices: { getUserMedia } } }),
    false,
  );
  assert.equal(voiceSupported({ MediaRecorder, navigator: {} }), false);
  assert.equal(
    voiceSupported({
      MediaRecorder,
      navigator: { mediaDevices: { getUserMedia } },
    }),
    true,
  );
});
