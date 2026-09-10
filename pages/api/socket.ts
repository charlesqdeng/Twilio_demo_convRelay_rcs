import type { NextApiRequest, NextApiResponse } from 'next';
import type { Server as HttpServer } from 'http';
import type { Socket as NetSocket } from 'net';
import { Server as IOServer } from 'socket.io';

interface SocketWithIO extends NetSocket {
  server: HttpServer & { io?: IOServer };
}

interface NextApiResponseWithIO extends NextApiResponse {
  socket: SocketWithIO;
}

export const config = { api: { bodyParser: false } };

export default function handler(_req: NextApiRequest, res: NextApiResponseWithIO) {
  if (!res.socket.server.io) {
    const io = new IOServer(res.socket.server, {
      path: '/api/socket_io',
      cors: { origin: '*' },
    });
    io.on('connection', (socket) => {
      socket.on('join_call', (callSid: string) => {
        if (typeof callSid === 'string' && callSid) {
          socket.join(`call:${callSid}`);
        }
      });
    });
    res.socket.server.io = io;
    // stash on globalThis so other API routes can emit into the same server
    (globalThis as unknown as { __betwext_io?: IOServer }).__betwext_io = io;
  }
  res.end();
}

export function getIO(): IOServer | null {
  return (globalThis as unknown as { __betwext_io?: IOServer }).__betwext_io ?? null;
}
