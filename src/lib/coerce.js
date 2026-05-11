const opcua = require("node-opcua");

function unwrapDataValue(dataValue) {
  if (!dataValue) {
    return {
      value: null,
      rawValue: null,
      dataType: null,
      arrayType: null,
      statusCode: null,
      statusOk: false,
      sourceTimestamp: null,
      serverTimestamp: null,
    };
  }

  const variant = dataValue.value;
  const dataTypeName = variant && variant.dataType != null
    ? opcua.DataType[variant.dataType] ?? null
    : null;
  const arrayTypeName = variant && variant.arrayType != null
    ? opcua.VariantArrayType[variant.arrayType] ?? null
    : null;

  return {
    value: extractValue(variant?.value, dataTypeName),
    rawValue: variant?.value ?? null,
    dataType: dataTypeName,
    arrayType: arrayTypeName,
    statusCode: dataValue.statusCode?.toString() ?? null,
    statusOk: typeof dataValue.statusCode?.isGood === "function"
      ? dataValue.statusCode.isGood()
      : false,
    sourceTimestamp: dataValue.sourceTimestamp ?? null,
    serverTimestamp: dataValue.serverTimestamp ?? null,
  };
}

function extractValue(v, dataTypeName) {
  if (v == null) return v;
  if (dataTypeName === "LocalizedText") {
    if (Array.isArray(v)) return v.map((x) => x?.text ?? null);
    return v.text ?? null;
  }
  if (dataTypeName === "QualifiedName") {
    if (Array.isArray(v)) return v.map((x) => x?.name ?? null);
    return v.name ?? null;
  }
  return v;
}

module.exports = { unwrapDataValue, extractValue };
