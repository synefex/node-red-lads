"use strict";

const helper = require("node-red-node-test-helper");
const writeNode = require("../src/write-value/lads-write-value");
const connectionNode = require("../src/connection/lads-connection");

helper.init(require.resolve("node-red"));

describe("lads-write-value node", function () {

  beforeEach(function (done) { helper.startServer(done); });
  afterEach(function (done) {
    helper.unload().then(function () { helper.stopServer(done); });
  });

  it("loads with a connection and reads its config", function (done) {
    const flow = [
      { id: "c1", type: "lads-connection", endpoint: "opc.tcp://h:4840" },
      {
        id: "n1",
        type: "lads-write-value",
        name: "test-write",
        connection: "c1",
        nodeId: "ns=6;i=6141",
        nodeIdType: "str",
        value: "payload",
        valueType: "msg",
        dataType: "Double",
        wires: [["out1"]],
      },
      { id: "out1", type: "helper" },
    ];
    helper.load([connectionNode, writeNode], flow, function () {
      try {
        const n = helper.getNode("n1");
        require("assert").ok(n);
        require("assert").strictEqual(n.dataType, "Double");
        done();
      } catch (e) { done(e); }
    });
  });
});
