import { lookup } from "node:dns/promises";
import { createServer, request as httpRequest } from "node:http";
import { BlockList, connect, isIP } from "node:net";
import type { Socket } from "node:net";

/**
 * Addresses an agent's browser must never reach: this computer, its local
 * network and every other private or reserved range. A workspace member or
 * a page the agent reads could otherwise point the browser at a router, an
 * internal tool or a service on this machine.
 */
const blocked = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blocked.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const)
  blocked.addSubnet(network, prefix, "ipv6");
// IPv4-mapped IPv6 addresses are checked against the IPv4 ranges above.

const allowedPorts = new Set([80, 443]);

/**
 * The public address to connect to for a host, checked once and then used
 * directly, so a name can't pass the check and resolve somewhere private
 * when the connection is made. Every address the name has must be public.
 */
async function publicAddress(host: string) {
  const name = host.replace(/^\[|\]$/gu, "");
  const family = isIP(name);
  const addresses = family
    ? [{ address: name, family }]
    : await lookup(name, { all: true, verbatim: true });
  if (
    addresses.length === 0 ||
    addresses.some(({ address, family: version }) =>
      blocked.check(address, version === 6 ? "ipv6" : "ipv4"),
    )
  )
    throw new Error(`${host} isn't a public address.`);
  const [first] = addresses;
  if (!first) throw new Error(`${host} has no address.`);
  return first.address;
}

function hostAndPort(authority: string, fallbackPort: number) {
  const url = new URL(`http://${authority}`);
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : fallbackPort,
  };
}

function refuse(socket: Socket) {
  socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
}

function isString(value: unknown): value is string {
  return Object.prototype.toString.call(value) === "[object String]";
}

let running: Promise<string> | undefined;

/**
 * A forward proxy on loopback that only lets a browser reach the public web,
 * on the usual web ports. Started once per process and shared by its
 * browsers; returns the proxy's address.
 */
export function publicWebProxy() {
  running ??= new Promise<string>((resolve, reject) => {
    const server = createServer((incoming, outgoing) => {
      void (async () => {
        const url = new URL(incoming.url ?? "");
        const port = url.port ? Number(url.port) : 80;
        if (url.protocol !== "http:" || !allowedPorts.has(port))
          throw new Error("Only public web pages are allowed.");
        const address = await publicAddress(url.hostname);
        const upstream = httpRequest(
          {
            host: address,
            port,
            method: incoming.method,
            path: `${url.pathname}${url.search}`,
            headers: { ...incoming.headers, host: url.host },
          },
          (response) => {
            outgoing.writeHead(response.statusCode ?? 502, response.headers);
            response.pipe(outgoing);
          },
        );
        upstream.on("error", () => outgoing.destroy());
        incoming.pipe(upstream);
      })().catch(() => {
        outgoing.writeHead(403).end();
      });
    });
    server.on("connect", (incoming, client: Socket, head: Buffer) => {
      void (async () => {
        const { host, port } = hostAndPort(incoming.url ?? "", 443);
        if (!allowedPorts.has(port)) throw new Error("Port not allowed.");
        const address = await publicAddress(host);
        const upstream = connect({ host: address, port }, () => {
          client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          if (head.length) upstream.write(head);
          upstream.pipe(client);
          client.pipe(upstream);
        });
        upstream.on("error", () => client.destroy());
        client.on("error", () => upstream.destroy());
      })().catch(() => refuse(client));
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || isString(address))
        return reject(new Error("The browser proxy has no port."));
      server.unref();
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
  return running;
}
