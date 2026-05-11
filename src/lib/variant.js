const opcua = require("node-opcua");

function buildInputVariant(arg, idx) {
  if (!arg || typeof arg !== "object") {
    throw new Error(`inputArguments[${idx}]: must be { dataType, value }`);
  }
  const dt = typeof arg.dataType === "string"
    ? opcua.DataType[arg.dataType]
    : arg.dataType;
  if (dt == null) {
    throw new Error(`inputArguments[${idx}]: unknown dataType "${arg.dataType}"`);
  }
  const variant = { dataType: dt, value: arg.value };
  if (arg.arrayType != null) {
    const at = typeof arg.arrayType === "string"
      ? opcua.VariantArrayType[arg.arrayType]
      : arg.arrayType;
    if (at == null) {
      throw new Error(`inputArguments[${idx}]: unknown arrayType "${arg.arrayType}"`);
    }
    variant.arrayType = at;
  } else if (Array.isArray(arg.value)) {
    variant.arrayType = opcua.VariantArrayType.Array;
  }
  return variant;
}

module.exports = { buildInputVariant };
