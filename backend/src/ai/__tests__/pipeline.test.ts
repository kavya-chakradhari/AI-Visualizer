/**
 * Tests for the JSON parse/validate/retry pipeline — the piece that must
 * "retry once with a stricter instruction, then fail gracefully" per spec.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  runWithJsonRetry,
  parseAIResponse,
  extractJsonPayload,
  AIProtocolError,
} from "../pipeline.js";

const VALID = JSON.stringify({
  intent: "create_visual",
  commands: [],
  requires_confirmation: false,
  clarification_needed: false,
  message: "ok",
});

describe("extractJsonPayload", () => {
  it("returns bare JSON unchanged", () => {
    assert.equal(extractJsonPayload(VALID), VALID);
  });

  it("strips a ```json fence", () => {
    assert.equal(extractJsonPayload("```json\n" + VALID + "\n```"), VALID);
  });

  it("strips a bare ``` fence", () => {
    assert.equal(extractJsonPayload("```\n" + VALID + "\n```"), VALID);
  });
});

describe("parseAIResponse", () => {
  it("accepts a valid response", () => {
    const parsed = parseAIResponse(VALID);
    assert.equal(parsed.intent, "create_visual");
  });

  it("rejects non-JSON text", () => {
    assert.throws(() => parseAIResponse("this is not json at all"));
  });

  it("rejects JSON missing a required field", () => {
    assert.throws(() => parseAIResponse(JSON.stringify({ intent: "x" })));
  });

  it("rejects an unknown key — the envelope is strict", () => {
    assert.throws(() =>
      parseAIResponse(JSON.stringify({ ...JSON.parse(VALID), extra: "nope" }))
    );
  });

  it("rejects a commands entry with the wrong shape", () => {
    assert.throws(() =>
      parseAIResponse(
        JSON.stringify({ ...JSON.parse(VALID), commands: [{ notAType: true }] })
      )
    );
  });
});

describe("runWithJsonRetry", () => {
  it("succeeds on the first attempt without retrying", async () => {
    let calls = 0;
    const response = await runWithJsonRetry(async () => {
      calls++;
      return VALID;
    });
    assert.equal(calls, 1);
    assert.equal(response.intent, "create_visual");
  });

  it("retries once with the stricter suffix and succeeds", async () => {
    let calls = 0;
    const suffixesSeen: (string | undefined)[] = [];

    const response = await runWithJsonRetry(async (suffix) => {
      calls++;
      suffixesSeen.push(suffix);
      return calls === 1 ? "not json at all" : VALID;
    });

    assert.equal(calls, 2, "should have retried exactly once");
    assert.equal(suffixesSeen[0], undefined, "the first attempt gets no retry suffix");
    assert.ok(suffixesSeen[1]?.includes("ONLY"), "the retry attempt gets the stricter instruction");
    assert.equal(response.intent, "create_visual");
  });

  it("recovers when the first attempt is syntactically valid JSON but fails the schema", async () => {
    let calls = 0;
    const response = await runWithJsonRetry(async () => {
      calls++;
      return calls === 1 ? JSON.stringify({ intent: "x" }) : VALID;
    });
    assert.equal(calls, 2);
    assert.equal(response.intent, "create_visual");
  });

  it("fails gracefully with AIProtocolError when both attempts are unusable", async () => {
    let calls = 0;
    await assert.rejects(
      runWithJsonRetry(async () => {
        calls++;
        return "still not json";
      }),
      (err: unknown) => {
        assert.ok(err instanceof AIProtocolError);
        assert.equal(err.attempts.length, 2);
        assert.match(err.message, /could not be parsed/i);
        return true;
      }
    );
    assert.equal(calls, 2, "should attempt exactly twice, never loop or hang");
  });

  it("never throws anything other than AIProtocolError", async () => {
    await assert.rejects(
      runWithJsonRetry(async () => "{}"),
      AIProtocolError
    );
  });
});
