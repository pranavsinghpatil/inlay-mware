import assert from "node:assert/strict";
import test from "node:test";
import { ResponsesStreamObserver } from "../src/observation.ts";

const smallFrames = [
  'event: response.created\ndata: {"type":"response.created"}\n\n',
  'event: response.in_progress\ndata: {"type":"response.in_progress","response":{"usage":{"input_tokens":5,"input_tokens_details":{"cached_tokens":2}}}}\n\n',
  'event: response.completed\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":12,"output_tokens":8,"total_tokens":20,"input_tokens_details":{"cached_tokens":3}}}}\n\n',
].join("");

const usageFields = {
  inputTokens: 12,
  outputTokens: 8,
  totalTokens: 20,
  cachedInputTokens: 3,
};

function withoutTiming(snapshot: ReturnType<ResponsesStreamObserver["snapshot"]>) {
  const { timeToFirstResponseBodyByteMs: _firstByte, timeToTerminalEventMs: _terminal, ...stable } = snapshot;
  return stable;
}

function observe(chunks: Buffer[], finish = true) {
  const observer = new ResponsesStreamObserver();
  for (const [index, chunk] of chunks.entries()) observer.observe(chunk, index + 1);
  if (finish) observer.finish();
  return observer.snapshot();
}

function cutsAt(bytes: Buffer, offsets: number[]) {
  const chunks: Buffer[] = [];
  let previous = 0;
  for (const offset of offsets) {
    if (offset > previous && offset < bytes.length) chunks.push(bytes.subarray(previous, offset));
    previous = offset;
  }
  if (previous < bytes.length) chunks.push(bytes.subarray(previous));
  return chunks;
}

function assertSameStableSnapshot(bytes: Buffer, partitions: Array<[string, Buffer[]]>) {
  const expected = withoutTiming(observe([bytes]));
  for (const [label, chunks] of partitions) {
    assert.deepEqual(Buffer.concat(chunks), bytes, `${label} byte reconstruction`);
    assert.deepEqual(withoutTiming(observe(chunks)), expected, label);
  }
}

const expectedSmallProjection = {
  responseBytes: Buffer.byteLength(smallFrames),
  usage: usageFields,
  terminalEventObserved: true,
  responseObservationIncomplete: false,
};

test("supported LF and CRLF streams produce partition-independent snapshots", () => {
  for (const [newline, stream] of [["LF", smallFrames], ["CRLF", smallFrames.replaceAll("\n", "\r\n")]] as const) {
    const bytes = Buffer.from(stream);
    const eventEnds = [...stream.matchAll(/\r?\n\r?\n/g)].map((match) => (match.index ?? 0) + match[0].length);
    const jsonStart = stream.indexOf('{"type":"response.in_progress"');
    const usageStart = stream.indexOf('"usage"');
    const terminalStart = stream.indexOf("event: response.completed");
    const partitions: Array<[string, Buffer[]]> = [
      [`${newline} whole stream`, [bytes]],
      [`${newline} byte-sized chunks`, [...bytes].map((byte) => Buffer.from([byte]))],
      [`${newline} event boundaries`, cutsAt(bytes, eventEnds)],
      [`${newline} event field cuts`, cutsAt(bytes, [stream.indexOf("event:") + 3, stream.indexOf("data:") + 3])],
      [`${newline} JSON boundary`, cutsAt(bytes, [Buffer.byteLength(stream.slice(0, jsonStart + 19))])],
      [`${newline} usage boundary`, cutsAt(bytes, [Buffer.byteLength(stream.slice(0, usageStart + 4))])],
      [`${newline} terminal boundary`, cutsAt(bytes, [Buffer.byteLength(stream.slice(0, terminalStart + 10))])],
      [`${newline} mixed partitions`, cutsAt(bytes, [1, 7, 23, 48, 83, 121, 177, 233, bytes.length - 3])],
    ];
    assertSameStableSnapshot(bytes, partitions);
    assert.deepEqual(withoutTiming(observe([bytes])), expectedSmallProjection, `${newline} expected projection`);
  }
});

test("usage fields merge across events and later usage after terminal remains observable", () => {
  const stream = Buffer.from(
    'event: response.completed\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":12,"output_tokens":8,"total_tokens":20,"input_tokens_details":{"cached_tokens":3}}}}\n\n' +
    'event: response.in_progress\ndata: {"response":{"usage":{"output_tokens":9}}}\n\n',
  );
  const result = observe([stream]);
  assert.deepEqual(result.usage, { ...usageFields, outputTokens: 9 });
  assert.equal(result.terminalEventObserved, true);
  assert.equal(result.responseBytes, stream.length);
  assert.equal(result.responseObservationIncomplete, false);
});

test("synthetic historical keepalive witness reconstructs exactly under deterministic partitions", () => {
  const terminalFrame = Buffer.from(`event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: { usage: { input_tokens: 12, output_tokens: 8, total_tokens: 20 } } })}\n\n`);
  const bytes = Buffer.concat([Buffer.from(": keepalive\n\n".repeat(6000)), terminalFrame]);
  assert.equal(bytes.length, 78140);

  const labels = ["whole", "byte-sized", "keepalive frame", "terminal frame", "mixed"];
  const partitions: Array<[string, Buffer[]]> = [
    [labels[0], [bytes]],
    [labels[1], [...bytes].map((byte) => Buffer.from([byte]))],
    [labels[2], cutsAt(bytes, Array.from({ length: 6000 }, (_, index) => (index + 1) * Buffer.byteLength(": keepalive\n\n")))],
    [labels[3], [bytes.subarray(0, bytes.length - terminalFrame.length), terminalFrame]],
    [labels[4], cutsAt(bytes, [1, 31, 8191, 32768, 65537, 78001, bytes.length - 2])],
  ];
  for (const [label, chunks] of partitions) {
    assert.equal(Buffer.concat(chunks).length, 78140, `${label} reconstruction length`);
    assert.deepEqual(Buffer.concat(chunks), bytes, `${label} byte reconstruction`);
  }
  assertSameStableSnapshot(bytes, partitions);
  assert.deepEqual(withoutTiming(observe([bytes])), {
    responseBytes: 78140,
    usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
    terminalEventObserved: true,
    responseObservationIncomplete: false,
  });
});

test("UTF-8 scalar split across chunks is decoded without affecting observation", () => {
  const stream = Buffer.from('data: {"type":"response.completed","marker":"☃","response":{"usage":{"input_tokens":12}}}\n\n');
  const scalar = Buffer.from("☃");
  const at = stream.indexOf(scalar);
  const split = cutsAt(stream, [at + 1, at + 2]);
  const result = observe(split);
  assert.equal(result.terminalEventObserved, true);
  assert.deepEqual(result.usage, { inputTokens: 12 });
  assert.equal(result.responseBytes, stream.length);
  assert.equal(result.responseObservationIncomplete, false);
});

test("CRLF delimiter split and unfinished final frame preserve framing semantics", () => {
  const complete = Buffer.from('event: response.completed\r\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":12}}}\r\n\r\n');
  const delimiter = complete.lastIndexOf(Buffer.from("\r\n\r\n"));
  assertSameStableSnapshot(complete, [["split CRLF delimiter", cutsAt(complete, [delimiter + 1, delimiter + 3])]]);

  const unfinished = Buffer.from('event: response.completed\ndata: {"type":"response.completed"}');
  const result = observe([unfinished]);
  assert.equal(result.terminalEventObserved, false);
  assert.equal(result.responseObservationIncomplete, true);
  assert.equal(result.responseBytes, unfinished.length);
});

test("malformed data is ignored and an interruption snapshot stays unfinished", () => {
  const bytes = Buffer.from('event: response.completed\ndata: {broken}\n\n');
  const finished = observe([bytes]);
  assert.equal(finished.terminalEventObserved, true);
  assert.equal(finished.usage, undefined);
  assert.equal(finished.responseObservationIncomplete, false);

  const observer = new ResponsesStreamObserver();
  observer.observe(Buffer.from('data: {"type":"response.completed"}'), 1);
  const interrupted = observer.snapshot();
  assert.equal(interrupted.terminalEventObserved, false);
  assert.equal(interrupted.responseObservationIncomplete, false);
});

test("oversized event suffix is discarded through its delimiter before a later valid frame", () => {
  const oversized = Buffer.from(
    `data: ${"x".repeat(64 * 1024)}\nevent: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: { usage: { input_tokens: 99 } } })}\n\n`,
  );
  const next = Buffer.from('event: response.completed\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":12,"output_tokens":8,"total_tokens":20,"input_tokens_details":{"cached_tokens":3}}}}\n\n');
  const observer = new ResponsesStreamObserver();
  observer.observe(oversized.subarray(0, 64 * 1024 + 8), 1);
  observer.observe(oversized.subarray(64 * 1024 + 8, -2), 2);
  const beforeDelimiter = observer.snapshot();
  assert.equal(beforeDelimiter.terminalEventObserved, false);
  assert.equal(beforeDelimiter.usage, undefined);
  assert.equal(beforeDelimiter.responseObservationIncomplete, true);

  observer.observe(oversized.subarray(-2), 3);
  const afterOversizedDelimiter = observer.snapshot();
  assert.equal(afterOversizedDelimiter.terminalEventObserved, false);
  assert.equal(afterOversizedDelimiter.usage, undefined);
  assert.equal(afterOversizedDelimiter.responseObservationIncomplete, true);

  observer.observe(next, 4);
  const result = observer.snapshot();
  assert.equal(result.terminalEventObserved, true);
  assert.deepEqual(result.usage, usageFields);
  assert.equal(result.responseBytes, oversized.length + next.length);
  assert.equal(result.responseObservationIncomplete, true);

  const joined = Buffer.concat([oversized, next]);
  const whole = observe([joined]);
  const fragmented = observe([...joined].map((byte) => Buffer.from([byte])));
  assert.deepEqual(withoutTiming(whole), withoutTiming(fragmented));
  assert.equal(whole.responseObservationIncomplete, true);
  assert.equal(fragmented.responseObservationIncomplete, true);
  assert.deepEqual(whole.usage, usageFields);
});

test("event frame size boundary accepts 65536 characters and discards 65537", () => {
  const validTerminal = Buffer.from('event: response.completed\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":12}}}\n\n');
  const atLimit = Buffer.from(`: ${"x".repeat(65532)}\n\n`);
  const overLimit = Buffer.from(`: ${"x".repeat(65533)}\n\n`);
  assert.equal(atLimit.length, 65536);
  assert.equal(overLimit.length, 65537);

  for (const [label, oversized] of [["at limit", atLimit], ["over limit", overLimit]] as const) {
    const stream = Buffer.concat([oversized, validTerminal]);
    const whole = observe([stream]);
    const fragmented = observe([...stream].map((byte) => Buffer.from([byte])));
    assert.deepEqual(Buffer.concat([oversized, validTerminal]), stream, `${label} fixture reconstruction`);
    assert.deepEqual(withoutTiming(whole), withoutTiming(fragmented), `${label} whole/fragment result`);
    assert.equal(whole.terminalEventObserved, true, `${label} later terminal`);
    assert.equal(whole.usage?.inputTokens, 12, `${label} later usage`);
    assert.equal(whole.responseObservationIncomplete, label === "over limit", `${label} incomplete flag`);
    assert.equal(whole.responseBytes, stream.length, `${label} byte count`);
  }
});
