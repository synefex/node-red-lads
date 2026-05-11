"use strict";

// Unit tests for the security-mode / security-policy / user-identity
// resolution helpers. These are the boundary between the editor UI
// (which uses friendly strings like "Sign", "Basic256Sha256",
// "username") and node-opcua's enum-based API.

const assert = require("assert");
const opcua = require("node-opcua");
const {
  resolveSecurityMode,
  resolveSecurityPolicy,
  buildUserIdentity,
  securityModes,
  securityPolicies,
} = require("../src/lib/options");

describe("resolveSecurityMode()", function () {
  it("maps 'None'", function () {
    assert.strictEqual(resolveSecurityMode("None"), opcua.MessageSecurityMode.None);
  });
  it("maps 'Sign'", function () {
    assert.strictEqual(resolveSecurityMode("Sign"), opcua.MessageSecurityMode.Sign);
  });
  it("maps 'SignAndEncrypt'", function () {
    assert.strictEqual(resolveSecurityMode("SignAndEncrypt"), opcua.MessageSecurityMode.SignAndEncrypt);
  });
  it("defaults to None for unknown names", function () {
    assert.strictEqual(resolveSecurityMode("Garbage"), opcua.MessageSecurityMode.None);
  });
  it("defaults to None for null/undefined", function () {
    assert.strictEqual(resolveSecurityMode(null), opcua.MessageSecurityMode.None);
    assert.strictEqual(resolveSecurityMode(undefined), opcua.MessageSecurityMode.None);
  });
});

describe("resolveSecurityPolicy()", function () {
  it("maps 'None'", function () {
    assert.strictEqual(resolveSecurityPolicy("None"), opcua.SecurityPolicy.None);
  });
  it("maps 'Basic256Sha256'", function () {
    assert.strictEqual(resolveSecurityPolicy("Basic256Sha256"), opcua.SecurityPolicy.Basic256Sha256);
  });
  it("maps 'Aes128_Sha256_RsaOaep'", function () {
    assert.strictEqual(resolveSecurityPolicy("Aes128_Sha256_RsaOaep"), opcua.SecurityPolicy.Aes128_Sha256_RsaOaep);
  });
  it("maps 'Aes256_Sha256_RsaPss'", function () {
    assert.strictEqual(resolveSecurityPolicy("Aes256_Sha256_RsaPss"), opcua.SecurityPolicy.Aes256_Sha256_RsaPss);
  });
  it("defaults to None for unknown names", function () {
    assert.strictEqual(resolveSecurityPolicy("Garbage"), opcua.SecurityPolicy.None);
  });
});

describe("buildUserIdentity()", function () {
  it("returns Anonymous for authMode='anonymous'", function () {
    const id = buildUserIdentity("anonymous");
    assert.strictEqual(id.type, opcua.UserTokenType.Anonymous);
  });
  it("returns Anonymous for unknown authMode", function () {
    const id = buildUserIdentity("not-a-real-mode");
    assert.strictEqual(id.type, opcua.UserTokenType.Anonymous);
  });
  it("returns UserName for authMode='username' with credentials", function () {
    const id = buildUserIdentity("username", { username: "alice", password: "s3cret" });
    assert.strictEqual(id.type, opcua.UserTokenType.UserName);
    assert.strictEqual(id.userName, "alice");
    assert.strictEqual(id.password, "s3cret");
  });
  it("handles missing credentials gracefully (empty strings)", function () {
    const id = buildUserIdentity("username");
    assert.strictEqual(id.type, opcua.UserTokenType.UserName);
    assert.strictEqual(id.userName, "");
    assert.strictEqual(id.password, "");
  });
  it("handles partial credentials", function () {
    const id = buildUserIdentity("username", { username: "alice" });
    assert.strictEqual(id.userName, "alice");
    assert.strictEqual(id.password, "");
  });
});

describe("exported metadata", function () {
  it("exports the list of known security modes", function () {
    assert.deepStrictEqual(securityModes, ["None", "Sign", "SignAndEncrypt"]);
  });
  it("exports the list of known security policies", function () {
    assert.deepStrictEqual(securityPolicies, [
      "None",
      "Basic256Sha256",
      "Aes128_Sha256_RsaOaep",
      "Aes256_Sha256_RsaPss",
    ]);
  });
});
