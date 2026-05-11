"use strict";

const helper = require("node-red-node-test-helper");
const callNode = require("../src/call-method/lads-call-method");
const connectionNode = require("../src/connection/lads-connection");

helper.init(require.resolve("node-red"));

describe("lads-call-method node", function () {

  beforeEach(function (done) { helper.startServer(done); });
  afterEach(function (done) {
    helper.unload().then(function () { helper.stopServer(done); });
  });

  it("loads with a connection and reads its config", function (done) {
    const flow = [
      { id: "c1", type: "lads-connection", endpoint: "opc.tcp://h:4840" },
      {
        id: "n1",
        type: "lads-call-method",
        name: "test-call",
        connection: "c1",
        objectId: "ns=6;i=5016",
        objectIdType: "str",
        methodId: "ns=6;i=7005",
        methodIdType: "str",
        inputArgs: "[]",
        inputArgsType: "json",
        outputProperty: "payload",
        outputPropertyType: "msg",
        includeMeta: false,
      },
    ];
    helper.load([connectionNode, callNode], flow, function () {
      try {
        const n = helper.getNode("n1");
        require("assert").ok(n);
        done();
      } catch (e) { done(e); }
    });
  });
});
