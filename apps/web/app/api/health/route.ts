import { NextResponse } from 'next/server';

/** Liveness for compose / load balancers — no auth, no secrets. */
export function GET() {
  return NextResponse.json({ status: 'ok' });
}
