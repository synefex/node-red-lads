const opcua = require("node-opcua");

const securityModeMap = {
  None: opcua.MessageSecurityMode.None,
  Sign: opcua.MessageSecurityMode.Sign,
  SignAndEncrypt: opcua.MessageSecurityMode.SignAndEncrypt,
};

const securityPolicyMap = {
  None: opcua.SecurityPolicy.None,
  Basic256Sha256: opcua.SecurityPolicy.Basic256Sha256,
  Aes128_Sha256_RsaOaep: opcua.SecurityPolicy.Aes128_Sha256_RsaOaep,
  Aes256_Sha256_RsaPss: opcua.SecurityPolicy.Aes256_Sha256_RsaPss,
};

function resolveSecurityMode(name) {
  return securityModeMap[name] ?? opcua.MessageSecurityMode.None;
}

function resolveSecurityPolicy(name) {
  return securityPolicyMap[name] ?? opcua.SecurityPolicy.None;
}

function buildUserIdentity(authMode, credentials) {
  if (authMode === "username") {
    return {
      type: opcua.UserTokenType.UserName,
      userName: credentials?.username ?? "",
      password: credentials?.password ?? "",
    };
  }
  return { type: opcua.UserTokenType.Anonymous };
}

module.exports = {
  resolveSecurityMode,
  resolveSecurityPolicy,
  buildUserIdentity,
  securityModes: Object.keys(securityModeMap),
  securityPolicies: Object.keys(securityPolicyMap),
};
