"use strict";

// Unit tests for the OPC UA DataValue decoding helper.
//
// The coerce module owns the boundary between node-opcua's wrapped types
// and the plain JS values we surface on msg.payload. Most callers only
// see the post-unwrap shape, so this is the right place to lock down the
// contract: what happens with null inputs, LocalizedText/QualifiedName
// flattening, and statusCode propagation.

const assert = require("assert");
const opcua = require("node-opcua");
const { unwrapDataValue, extractValue } = require("../src/lib/coerce");

// Helper: build a fake DataValue object shaped like what node-opcua hands
// back, without needing the full constructor. Tests should be readable;
// matching node-opcua's exact constructor surface is unnecessary here.
function fakeDataValue({ value, dataType, arrayType, statusCode, statusOk, source, server }) {
  return {
    value: value !== undefined
      ? { value, dataType: opcua.DataType[dataType], arrayType: arrayType != null ? opcua.VariantArrayType[arrayType] : undefined }
      : null,
    statusCode: {
      toString: function () { return statusCode || "Good"; },
      isGood: function () { return statusOk !== false; },
    },
    sourceTimestamp: source || null,
    serverTimestamp: server || null,
  };
}

describe("unwrapDataValue()", function () {

  describe("null / missing input", function () {
    it("returns all-null defaults for null", function () {
      const out = unwrapDataValue(null);
      assert.strictEqual(out.value, null);
      assert.strictEqual(out.dataType, null);
      assert.strictEqual(out.statusOk, false);
    });
    it("returns all-null defaults for undefined", function () {
      const out = unwrapDataValue(undefined);
      assert.strictEqual(out.value, null);
      assert.strictEqual(out.statusCode, null);
    });
  });

  describe("scalar values", function () {
    it("unwraps a Double", function () {
      const out = unwrapDataValue(fakeDataValue({ value: 3.14, dataType: "Double" }));
      assert.strictEqual(out.value, 3.14);
      assert.strictEqual(out.dataType, "Double");
      assert.strictEqual(out.statusOk, true);
    });
    it("unwraps a String", function () {
      const out = unwrapDataValue(fakeDataValue({ value: "hello", dataType: "String" }));
      assert.strictEqual(out.value, "hello");
      assert.strictEqual(out.dataType, "String");
    });
    it("unwraps a Boolean", function () {
      const out = unwrapDataValue(fakeDataValue({ value: true, dataType: "Boolean" }));
      assert.strictEqual(out.value, true);
    });
    it("unwraps an Int32", function () {
      const out = unwrapDataValue(fakeDataValue({ value: -42, dataType: "Int32" }));
      assert.strictEqual(out.value, -42);
      assert.strictEqual(out.dataType, "Int32");
    });
  });

  describe("LocalizedText flattening", function () {
    it("flattens a single LocalizedText to its text field", function () {
      const out = unwrapDataValue(fakeDataValue({
        value: { text: "OK", locale: "en" },
        dataType: "LocalizedText",
      }));
      assert.strictEqual(out.value, "OK");
    });
    it("flattens an array of LocalizedText", function () {
      const out = unwrapDataValue(fakeDataValue({
        value: [{ text: "a" }, { text: "b" }, { text: null }],
        dataType: "LocalizedText",
        arrayType: "Array",
      }));
      assert.deepStrictEqual(out.value, ["a", "b", null]);
    });
  });

  describe("QualifiedName flattening", function () {
    it("flattens a single QualifiedName to its name field", function () {
      const out = unwrapDataValue(fakeDataValue({
        value: { name: "Foo", namespaceIndex: 2 },
        dataType: "QualifiedName",
      }));
      assert.strictEqual(out.value, "Foo");
    });
    it("flattens an array of QualifiedName", function () {
      const out = unwrapDataValue(fakeDataValue({
        value: [{ name: "x" }, { name: "y" }],
        dataType: "QualifiedName",
        arrayType: "Array",
      }));
      assert.deepStrictEqual(out.value, ["x", "y"]);
    });
  });

  describe("statusCode propagation", function () {
    it("reports statusOk true for Good", function () {
      const out = unwrapDataValue(fakeDataValue({ value: 1, dataType: "Int32", statusCode: "Good", statusOk: true }));
      assert.strictEqual(out.statusOk, true);
      assert.strictEqual(out.statusCode, "Good");
    });
    it("reports statusOk false for Bad", function () {
      const out = unwrapDataValue(fakeDataValue({ value: 1, dataType: "Int32", statusCode: "BadAccessDenied", statusOk: false }));
      assert.strictEqual(out.statusOk, false);
      assert.strictEqual(out.statusCode, "BadAccessDenied");
    });
  });

  describe("timestamps", function () {
    it("passes source and server timestamps through", function () {
      const t1 = new Date("2026-05-11T12:00:00Z");
      const t2 = new Date("2026-05-11T12:00:01Z");
      const out = unwrapDataValue(fakeDataValue({ value: 1, dataType: "Int32", source: t1, server: t2 }));
      assert.strictEqual(out.sourceTimestamp, t1);
      assert.strictEqual(out.serverTimestamp, t2);
    });
  });
});

describe("extractValue()", function () {
  it("returns null for null input", function () {
    assert.strictEqual(extractValue(null, "Double"), null);
  });
  it("returns undefined for undefined input", function () {
    assert.strictEqual(extractValue(undefined, "Double"), undefined);
  });
  it("passes through values of non-special types", function () {
    assert.strictEqual(extractValue(42, "Int32"), 42);
    assert.strictEqual(extractValue("hi", "String"), "hi");
    assert.strictEqual(extractValue(true, "Boolean"), true);
  });
  it("flattens LocalizedText", function () {
    assert.strictEqual(extractValue({ text: "OK" }, "LocalizedText"), "OK");
  });
  it("flattens QualifiedName", function () {
    assert.strictEqual(extractValue({ name: "Foo" }, "QualifiedName"), "Foo");
  });
  it("handles missing text/name fields gracefully", function () {
    assert.strictEqual(extractValue({}, "LocalizedText"), null);
    assert.strictEqual(extractValue({}, "QualifiedName"), null);
  });
});
