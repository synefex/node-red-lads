"use strict";

// Load test for the lads-connection config node. Verifies it registers,
// reads its config, exposes the action-node-facing API, and does NOT
// open a socket at load time (we never call getSession()).
//
// Picker admin routes are registered as a side effect of module load;
// we don't exercise them here -- those would need a deployed connection
// plus optional OPC UA browse cache, out of scope for unit tests.

const helper = require("node-red-node-test-helper");
const connectionNode = require("../src/connection/lads-connection");

helper.init(require.resolve("node-red"));

describe("lads-connection node", function () {

  beforeEach(function (done) { helper.startServer(done); });
  afterEach(function (done) {
    helper.unload().then(function () { helper.stopServer(done); });
  });

  it("loads with the configured endpoint + security + app metadata", function (done) {
    const flow = [
      {
        id: "c1",
        type: "lads-connection",
        name: "test-conn",
        endpoint: "opc.tcp://example:4840",
        securityMode: "Sign",
        securityPolicy: "Basic256Sha256",
        authMode: "anonymous",
        applicationName: "test-app",
        applicationUri: "urn:test:app",
        sessionTimeout: 30000,
        acceptServerCertificate: true,
      },
    ];
    helper.load(connectionNode, flow, function () {
      try {
        const c = helper.getNode("c1");
        require("assert").ok(c);
        require("assert").strictEqual(c.endpoint, "opc.tcp://example:4840");
        require("assert").strictEqual(c.securityMode, "Sign");
        require("assert").strictEqual(c.securityPolicy, "Basic256Sha256");
        require("assert").strictEqual(c.authMode, "anonymous");
        require("assert").strictEqual(c.applicationName, "test-app");
        require("assert").strictEqual(c.requestedSessionTimeout, 30000);
        require("assert").strictEqual(c.acceptServerCertificate, true);
        done();
      } catch (e) { done(e); }
    });
  });

  it("exposes the action-node-facing API (onStatus, getSession, listDevices, ...)", function (done) {
    const flow = [{ id: "c1", type: "lads-connection", endpoint: "opc.tcp://h:4840" }];
    helper.load(connectionNode, flow, function () {
      try {
        const c = helper.getNode("c1");
        require("assert").strictEqual(typeof c.onStatus, "function");
        require("assert").strictEqual(typeof c.getSession, "function");
        require("assert").strictEqual(typeof c.listDevices, "function");
        require("assert").strictEqual(typeof c.browseChildren, "function");
        require("assert").strictEqual(typeof c.listMethods, "function");
        require("assert").strictEqual(typeof c.listAfo, "function");
        require("assert").strictEqual(typeof c.invalidateBrowseCache, "function");
        done();
      } catch (e) { done(e); }
    });
  });

  it("fills in sensible defaults", function (done) {
    // Endpoint is required per the editor schema, but the node should
    // tolerate everything else missing.
    const flow = [{ id: "c1", type: "lads-connection", endpoint: "opc.tcp://h:4840" }];
    helper.load(connectionNode, flow, function () {
      try {
        const c = helper.getNode("c1");
        require("assert").strictEqual(c.securityMode, "None");
        require("assert").strictEqual(c.securityPolicy, "None");
        require("assert").strictEqual(c.authMode, "anonymous");
        require("assert").strictEqual(c.applicationName, "synefex-lads-nodered");
        require("assert").strictEqual(c.acceptServerCertificate, true);
        done();
      } catch (e) { done(e); }
    });
  });
});
