"use strict";

// Unit tests for attachConnectionStatus -- the helper that translates
// connection state events into Node-RED node.status() calls.
//
// We mock the node and connection just enough to capture which
// status() shapes get emitted for each state.

const assert = require("assert");
const { attachConnectionStatus } = require("../src/lib/status");

function makeMockNode() {
  const calls = [];
  return {
    status: function (s) { calls.push(s); },
    _calls: calls,
  };
}

function makeMockConnection() {
  let listener = null;
  return {
    onStatus: function (fn) {
      listener = fn;
      return function unsubscribe() { listener = null; };
    },
    emit: function (status) {
      if (listener) listener(status);
    },
    hasListener: function () { return listener !== null; },
  };
}

describe("attachConnectionStatus()", function () {

  it("subscribes the node to the connection and returns the unsubscribe fn", function () {
    const node = makeMockNode();
    const conn = makeMockConnection();
    const unsub = attachConnectionStatus(node, conn);
    assert.strictEqual(typeof unsub, "function");
    assert.ok(conn.hasListener());
    unsub();
    assert.ok(!conn.hasListener());
  });

  it("maps 'connected' to a green dot", function () {
    const node = makeMockNode();
    const conn = makeMockConnection();
    attachConnectionStatus(node, conn);
    conn.emit({ state: "connected", detail: "opc.tcp://h:4840" });
    assert.deepStrictEqual(node._calls[0], { fill: "green", shape: "dot", text: "connected" });
  });

  it("maps 'connecting' to a yellow ring with detail in the text", function () {
    const node = makeMockNode();
    const conn = makeMockConnection();
    attachConnectionStatus(node, conn);
    conn.emit({ state: "connecting", detail: "retry 1" });
    assert.strictEqual(node._calls[0].fill, "yellow");
    assert.strictEqual(node._calls[0].shape, "ring");
    assert.ok(/connecting/.test(node._calls[0].text));
    assert.ok(/retry 1/.test(node._calls[0].text));
  });

  it("maps 'reconnecting' to a yellow ring", function () {
    const node = makeMockNode();
    const conn = makeMockConnection();
    attachConnectionStatus(node, conn);
    conn.emit({ state: "reconnecting", detail: "" });
    assert.strictEqual(node._calls[0].fill, "yellow");
  });

  it("maps 'session-closed' to a yellow ring", function () {
    const node = makeMockNode();
    const conn = makeMockConnection();
    attachConnectionStatus(node, conn);
    conn.emit({ state: "session-closed", detail: "" });
    assert.strictEqual(node._calls[0].fill, "yellow");
  });

  it("maps 'error' to a red ring", function () {
    const node = makeMockNode();
    const conn = makeMockConnection();
    attachConnectionStatus(node, conn);
    conn.emit({ state: "error", detail: "boom" });
    assert.strictEqual(node._calls[0].fill, "red");
    assert.strictEqual(node._calls[0].shape, "ring");
  });

  it("maps 'disconnected' to a red ring", function () {
    const node = makeMockNode();
    const conn = makeMockConnection();
    attachConnectionStatus(node, conn);
    conn.emit({ state: "disconnected", detail: "" });
    assert.strictEqual(node._calls[0].fill, "red");
  });

  it("maps unknown states to a grey ring", function () {
    const node = makeMockNode();
    const conn = makeMockConnection();
    attachConnectionStatus(node, conn);
    conn.emit({ state: "frobnicating", detail: "" });
    assert.strictEqual(node._calls[0].fill, "grey");
    assert.strictEqual(node._calls[0].shape, "ring");
  });

  it("handles empty detail without crashing", function () {
    const node = makeMockNode();
    const conn = makeMockConnection();
    attachConnectionStatus(node, conn);
    conn.emit({ state: "connecting" });
    assert.ok(node._calls[0].text);
  });
});
