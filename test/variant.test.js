"use strict";

// Unit tests for buildInputVariant -- the helper that converts a plain
// { dataType, value } object into a node-opcua Variant shape, for use
// with `lads-call-method` input arguments.

const assert = require("assert");
const opcua = require("node-opcua");
const { buildInputVariant } = require("../src/lib/variant");

describe("buildInputVariant()", function () {

  describe("validation", function () {
    it("throws on null", function () {
      assert.throws(() => buildInputVariant(null, 0), /must be \{ dataType, value \}/);
    });
    it("throws on undefined", function () {
      assert.throws(() => buildInputVariant(undefined, 0), /must be \{ dataType, value \}/);
    });
    it("throws on a string", function () {
      assert.throws(() => buildInputVariant("nope", 0), /must be \{ dataType, value \}/);
    });
    it("throws with the argument index in the message", function () {
      try {
        buildInputVariant(null, 7);
        assert.fail("should have thrown");
      } catch (e) {
        assert.ok(/\[7\]/.test(e.message), `expected [7] in message, got: ${e.message}`);
      }
    });
    it("throws on an unknown string dataType", function () {
      assert.throws(
        () => buildInputVariant({ dataType: "NotARealType", value: 1 }, 0),
        /unknown dataType "NotARealType"/,
      );
    });
    it("throws on an unknown arrayType", function () {
      assert.throws(
        () => buildInputVariant({ dataType: "Int32", value: [1, 2], arrayType: "NotARealArrayType" }, 0),
        /unknown arrayType "NotARealArrayType"/,
      );
    });
  });

  describe("scalar values", function () {
    it("builds a scalar Double variant", function () {
      const v = buildInputVariant({ dataType: "Double", value: 3.14 }, 0);
      assert.strictEqual(v.dataType, opcua.DataType.Double);
      assert.strictEqual(v.value, 3.14);
      assert.strictEqual(v.arrayType, undefined);
    });
    it("builds a scalar String variant", function () {
      const v = buildInputVariant({ dataType: "String", value: "hi" }, 0);
      assert.strictEqual(v.dataType, opcua.DataType.String);
      assert.strictEqual(v.value, "hi");
    });
    it("accepts numeric dataType (already an enum value)", function () {
      const v = buildInputVariant({ dataType: opcua.DataType.Int32, value: 42 }, 0);
      assert.strictEqual(v.dataType, opcua.DataType.Int32);
      assert.strictEqual(v.value, 42);
    });
  });

  describe("array values", function () {
    it("auto-sets arrayType=Array when value is an Array", function () {
      const v = buildInputVariant({ dataType: "Int32", value: [1, 2, 3] }, 0);
      assert.strictEqual(v.arrayType, opcua.VariantArrayType.Array);
      assert.deepStrictEqual(v.value, [1, 2, 3]);
    });
    it("preserves explicit arrayType=Scalar even when value is an Array", function () {
      // Pathological combo, but the contract is "explicit wins". This
      // also documents the trap.
      const v = buildInputVariant({
        dataType: "Int32",
        value: [1, 2, 3],
        arrayType: "Scalar",
      }, 0);
      assert.strictEqual(v.arrayType, opcua.VariantArrayType.Scalar);
    });
    it("accepts numeric arrayType", function () {
      const v = buildInputVariant({
        dataType: "Int32",
        value: [1],
        arrayType: opcua.VariantArrayType.Matrix,
      }, 0);
      assert.strictEqual(v.arrayType, opcua.VariantArrayType.Matrix);
    });
  });
});
