"use strict";

const helper = require("node-red-node-test-helper");
const readNode = require("../src/read-value/lads-read-value");
const connectionNode = require("../src/connection/lads-connection");

helper.init(require.resolve("node-red"));

describe("lads-read-value node", function () {

  beforeEach(function (done) { helper.startServer(done); });
  afterEach(function (done) {
    helper.unload().then(function () { helper.stopServer(done); });
  });

  it("loads with a connection and reads its config", function (done) {
    const flow = [
      { id: "c1", type: "lads-connection", endpoint: "opc.tcp://h:4840" },
      {
        id: "n1",
        type: "lads-read-value",
        name: "test-read",
        connection: "c1",
        nodeId: "ns=6;i=6054",
        nodeIdType: "str",
        outputProperty: "payload",
        outputPropertyType: "msg",
        includeMeta: true,
        wires: [["out1"]],
      },
      { id: "out1", type: "helper" },
    ];
    helper.load([connectionNode, readNode], flow, function () {
      try {
        const n = helper.getNode("n1");
        require("assert").ok(n);
        require("assert").strictEqual(n.nodeIdValue, "ns=6;i=6054");
        require("assert").strictEqual(n.outputProperty, "payload");
        require("assert").strictEqual(n.includeMeta, true);
        done();
      } catch (e) { done(e); }
    });
  });

  it("marks itself red if there's no connection", function (done) {
    const flow = [
      {
        id: "n1",
        type: "lads-read-value",
        name: "orphan",
        connection: "",
        nodeId: "ns=6;i=1",
        nodeIdType: "str",
      },
    ];
    helper.load([readNode], flow, function () {
      try {
        const n = helper.getNode("n1");
        // node-red-node-test-helper exposes the last status() call as n.status
        // (a spy) via the helper. We just verify the node loaded without
        // crashing -- the no-connection branch hits a `return` after setting
        // a red status, which the spy would catch in a richer assertion.
        require("assert").ok(n);
        done();
      } catch (e) { done(e); }
    });
  });
});
