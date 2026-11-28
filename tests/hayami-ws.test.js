import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import {
  keyPath, parseKey, b64url, unb64url, ascii, hmacSha256, wsProof, openWS, WSFailure, CLIENT_LABEL, SERVER_LABEL,
} from "../lib/hayami.js";

const sha256 = (b) => new Uint8Array(createHash("sha256").update(b).digest());
const rand = (n) => new Uint8Array(randomBytes(n));
const nodeHmac = (key, msg) => new Uint8Array(createHmac("sha256", key).update(msg).digest());
const token = () => b64url(rand(32));

test("hmacSha256 on a SHA-256 function is node's HMAC, and RFC 4231's (R3)", () => {
  const hex = (b) => Buffer.from(b).toString("hex");
  assert.equal(hex(hmacSha256(sha256, "Jefe", "what do ya want for nothing?")),
    "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
  assert.equal(hex(hmacSha256(sha256, new Uint8Array(131).fill(0xaa), "Test Using Larger Than Block-Size Key - Hash Key First")),
    "60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54");
  for (let i = 0; i < 200; i++) {
    const k = rand(1 + (i % 100)), m = rand(i * 3);
    assert.deepEqual(hmacSha256(sha256, k, m), nodeHmac(k, m));
  }
});

test("b64url both ways, and refuses what is not base64url", () => {
  for (let n = 0; n < 70; n++) {
    const b = rand(n);
    assert.equal(b64url(b), Buffer.from(b).toString("base64url"));
    assert.deepEqual(unb64url(b64url(b)), b);
  }
  for (const bad of ["a+b", "a/b", "ab==", "a", "abcde"]) assert.equal(unb64url(bad), null, bad);
  assert.deepEqual(ascii("hayami-client\nA"), new Uint8Array(Buffer.from("hayami-client\nA")));
});

test("keyPath: hayami's settings directory on each platform (R2)", () => {
  assert.equal(keyPath("linux", "/home/a"), "/home/a/.config/hayami/api-tcp.json");
  assert.equal(keyPath("macos", "/Users/a/"), "/Users/a/Library/Application Support/hayami/api-tcp.json");
  assert.equal(keyPath("windows", "C:\\Users\\a"), "C:\\Users\\a/AppData/Roaming/hayami/api-tcp.json");
});

test("parseKey: only 127.0.0.1, a port and a 32-byte token (R2)", () => {
  const t = token();
  assert.deepEqual(parseKey(JSON.stringify({ address: "127.0.0.1:47930", token: t })), { address: "127.0.0.1:47930", token: t });
  for (const bad of [
    { address: "0.0.0.0:47930", token: t }, { address: "192.0.2.1:47930", token: t }, { address: "127.0.0.1:0", token: t },
    { address: "127.0.0.1:70000", token: t }, { address: "127.0.0.1:47930", token: t.slice(0, 20) }, { address: "127.0.0.1", token: t },
  ]) assert.equal(parseKey(JSON.stringify(bad)), null, JSON.stringify(bad));
  assert.equal(parseKey("not json"), null);
});

// A scripted peer: messages to send in order, and what the client wrote.
function scripted(answer) {
  const wrote = [];
  return {
    wrote,
    connect: async () => {
      const queue = [];
      let wake = null;
      const push = (m) => { if (m instanceof Error) { queue.push(m); } else queue.push(m); if (wake) { wake(); wake = null; } };
      answer.challenge(push);
      return {
        read: async () => {
          while (!queue.length) await new Promise((r) => { wake = r; });
          const m = queue.shift();
          if (m instanceof Error) throw m;
          return m;
        },
        write: async (s) => { wrote.push(s); answer.reply(JSON.parse(s), push); },
        close: () => {},
      };
    },
  };
}

test("openWS: the proof is node's HMAC over the challenge, and the token is never sent (R3)", async () => {
  const t = token(), ns = b64url(rand(32));
  const peer = scripted({
    challenge: (push) => push(JSON.stringify({ type: "challenge", nonce: ns })),
    reply: (m, push) => {
      if (m.type !== "auth") return;
      const want = b64url(nodeHmac(unb64url(t), `${CLIENT_LABEL}\n${ns}\n${m.nonce}`));
      if (m.proof !== want) return push(new Error("closed 4401 not authenticated"));
      const proof = b64url(nodeHmac(unb64url(t), `${SERVER_LABEL}\n${m.nonce}\n${ns}`));
      push(JSON.stringify({ type: "hello", service: "hayami", version: "x", api: "1.1", sections: ["clock"], proof }));
    },
  });
  const s = await openWS({ connect: peer.connect, sha256, randomBytes: rand, key: { address: "127.0.0.1:1", token: t } });
  assert.equal(s.hello.type, "hello");
  assert.equal(peer.wrote.length, 1);
  assert.doesNotMatch(peer.wrote.join(""), new RegExp(t), "the token was sent");
});

test("openWS: a hello whose proof is wrong, missing or the client's is an impostor; 4401 is refused (R3)", async () => {
  const t = token(), ns = b64url(rand(32));
  const helloWith = (proofOf) => scripted({
    challenge: (push) => push(JSON.stringify({ type: "challenge", nonce: ns })),
    reply: (m, push) => push(JSON.stringify({ type: "hello", service: "hayami", version: "x", api: "1.1", sections: [], proof: proofOf(m) })),
  });
  const cases = {
    "another token's proof": (m) => wsProof(sha256, token(), SERVER_LABEL, m.nonce, ns),
    "no proof": () => null,
    "the client's own proof": (m) => m.proof,
    "a client-labelled proof": (m) => wsProof(sha256, t, CLIENT_LABEL, m.nonce, ns),
  };
  for (const [name, proofOf] of Object.entries(cases)) {
    await assert.rejects(openWS({ connect: helloWith(proofOf).connect, sha256, randomBytes: rand, key: { address: "127.0.0.1:1", token: t } }),
      (e) => e instanceof WSFailure && e.kind === "impostor", name);
  }
  const refusing = scripted({
    challenge: (push) => push(JSON.stringify({ type: "challenge", nonce: ns })),
    reply: (_m, push) => push(new Error("WebSocket closed: 4401 not authenticated")),
  });
  await assert.rejects(openWS({ connect: refusing.connect, sha256, randomBytes: rand, key: { address: "127.0.0.1:1", token: t } }),
    (e) => e instanceof WSFailure && e.kind === "refused");
  const noChallenge = scripted({ challenge: (push) => push(JSON.stringify({ type: "hello" })), reply: () => {} });
  await assert.rejects(openWS({ connect: noChallenge.connect, sha256, randomBytes: rand, key: { address: "127.0.0.1:1", token: t } }),
    (e) => e.kind === "impostor");
  await assert.rejects(openWS({ connect: async () => { throw new Error("ECONNREFUSED"); }, sha256, randomBytes: rand, key: { address: "127.0.0.1:1", token: t } }),
    (e) => e.kind === "no-service");
});

// connect, as herdr's WebSocket.connect, on node's own WebSocket.
function nodeConnect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const queue = [], waiters = [];
    let ended = null;
    ws.onmessage = (e) => (waiters.length ? waiters.shift().res(e.data) : queue.push(e.data));
    ws.onclose = (e) => {
      ended = new Error(`closed ${e.code} ${e.reason}`);
      while (waiters.length) waiters.shift().rej(ended);
    };
    ws.onerror = () => reject(new Error("the port does not answer"));
    ws.onopen = () => resolve({
      read: () => (queue.length ? Promise.resolve(queue.shift()) : ended ? Promise.reject(ended)
        : new Promise((res, rej) => waiters.push({ res, rej }))),
      write: async (s) => ws.send(s),
      close: () => ws.close(),
    });
  });
}

const desksKey = keyPath(process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : "linux", homedir());

test("integration: the running service's port, through the library, with this account's key (R1, R3)",
  { skip: !existsSync(desksKey) && "no api-tcp.json here: hayami's TCP port is not set up" }, async () => {
    const key = parseKey(readFileSync(desksKey, "utf8"));
    assert.ok(key, "the key is one the service serves with");
    const s = await openWS({ connect: nodeConnect, sha256, randomBytes: rand, key });
    try {
      assert.equal(s.hello.service, "hayami");
      assert.ok(s.hello.sections.includes("clock"));
      await s.subscribe(["clock"]);
      const m = await s.next();
      assert.equal(m.type, "section");
      assert.equal(m.data.key, "clock");
    } finally {
      s.close();
    }
    const wrong = { ...key, token: token() };
    await assert.rejects(openWS({ connect: nodeConnect, sha256, randomBytes: rand, key: wrong }), (e) => e.kind === "refused");
  });
