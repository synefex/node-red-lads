function attachConnectionStatus(node, connection) {
  function apply(status) {
    const text = status.detail ? `${status.state}: ${status.detail}` : status.state;
    switch (status.state) {
      case "connected":
        node.status({ fill: "green", shape: "dot", text: "connected" });
        break;
      case "connecting":
      case "reconnecting":
      case "session-closed":
        node.status({ fill: "yellow", shape: "ring", text });
        break;
      case "error":
      case "disconnected":
        node.status({ fill: "red", shape: "ring", text });
        break;
      default:
        node.status({ fill: "grey", shape: "ring", text });
    }
  }
  return connection.onStatus(apply);
}

module.exports = { attachConnectionStatus };
