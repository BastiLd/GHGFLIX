import { test } from "node:test";
import assert from "node:assert/strict";
import { connect } from "node:net";
import { once } from "node:events";
import { createFixtureProxy } from "./emulator-proxy.mjs";

test("isolated proxy survives reset CONNECT clients and keeps rejecting external requests", async () => {
  const proxy = createFixtureProxy();
  await new Promise(resolve => proxy.listen(0, "127.0.0.1", resolve));
  const port = proxy.address().port;
  try {
    for (let i = 0; i < 10; i++) {
      const socket = connect(port, "127.0.0.1");
      socket.on("error", () => {});
      await once(socket, "connect");
      const closed = new Promise(resolve => socket.once("close", resolve));
      socket.write("CONNECT blocked.invalid:443 HTTP/1.1\r\nHost: blocked.invalid\r\n\r\n");
      socket.resetAndDestroy();
      await closed;
    }
    const reply = await fetch(`http://127.0.0.1:${port}/blocked`);
    assert.equal(reply.status, 403);
  } finally {
    proxy.closeAllConnections();
    await new Promise(resolve => proxy.close(resolve));
  }
});
