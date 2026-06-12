#!/usr/bin/env node
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const SOCKET_PATH = process.env.DIANPING_BROWSER_BRIDGE_SOCKET ||
  path.join(os.tmpdir(), 'dianping-nearby-restaurants-bridge.sock');

const pending = new Map();
const clients = new Set();
let inputBuffer = Buffer.alloc(0);

function sendNativeMessage(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([header, body]));
}

function sendClientLine(socket, message) {
  socket.write(`${JSON.stringify(message)}\n`);
}

function handleNativeResponse(message) {
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  sendClientLine(request.socket, message);
}

function handleClientRequest(socket, line) {
  let message;
  try {
    message = JSON.parse(line);
  } catch (error) {
    sendClientLine(socket, { error: { message: `Invalid JSON: ${error.message}` } });
    return;
  }

  if (!message.id || !message.method) {
    sendClientLine(socket, { id: message.id || null, error: { message: 'Request requires id and method.' } });
    return;
  }

  pending.set(message.id, { socket });
  sendNativeMessage(message);
}

function startSocketServer() {
  try {
    fs.unlinkSync(SOCKET_PATH);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const server = net.createServer((socket) => {
    clients.add(socket);
    let buffer = '';

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let newlineIndex;
      while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line) handleClientRequest(socket, line);
      }
    });

    socket.on('close', () => {
      clients.delete(socket);
      for (const [id, request] of pending.entries()) {
        if (request.socket === socket) pending.delete(id);
      }
    });
  });

  server.listen(SOCKET_PATH, () => {
    fs.chmodSync(SOCKET_PATH, 0o600);
  });
}

process.stdin.on('data', (chunk) => {
  inputBuffer = Buffer.concat([inputBuffer, chunk]);
  while (inputBuffer.length >= 4) {
    const messageLength = inputBuffer.readUInt32LE(0);
    if (inputBuffer.length < 4 + messageLength) return;
    const body = inputBuffer.subarray(4, 4 + messageLength).toString('utf8');
    inputBuffer = inputBuffer.subarray(4 + messageLength);
    handleNativeResponse(JSON.parse(body));
  }
});

process.on('exit', () => {
  try {
    fs.unlinkSync(SOCKET_PATH);
  } catch {}
});

startSocketServer();
