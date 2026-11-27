// Browser document windows share one in-memory clipboard until the last closes.
let selection;
self.onconnect = ({ ports: [port] }) => {
  port.onmessage = ({ data, ports }) => {
    if (data.copy) selection = data.copy;
    else
      ports[0].postMessage(data.token === selection?.token ? selection : null);
  };
};
