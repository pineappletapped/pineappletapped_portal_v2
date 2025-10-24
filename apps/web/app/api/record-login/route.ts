import { NextResponse } from 'next/server';
import {
  HttpFunctionInvocationError,
  invokeHttpFunction,
} from '@/lib/httpFunctions';
import { applyCorsHeaders, buildCorsHeaders } from '../_lib/cors';

const extractBearerToken = (header: string | null): string | null => {
  if (!header) {
    return null;
  }

  const trimmed = header.trim();
  if (!trimmed) {
    return null;
  }

  const match = /^Bearer\s+(.+)$/i.exec(trimmed);
  if (!match) {
    return null;
  }

  const token = match[1]?.trim();
  return token?.length ? token : null;
};

const parseRequestBody = async (request: Request): Promise<Record<string, unknown>> => {
  try {
    const data = await request.json();
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      return data as Record<string, unknown>;
    }
  } catch (error) {
    console.warn('record-login proxy failed to parse body', error);
  }
  return {};
};

export async function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: buildCorsHeaders(request) });
}

export async function POST(request: Request) {
  const body = await parseRequestBody(request);
  const idToken = extractBearerToken(request.headers.get('authorization'));

  try {
    const result = await invokeHttpFunction<Record<string, unknown>>('recordLogin', {
      body,
      idToken,
      includeOverrides: false,
      allowRelativeFallback: false,
    });

    const payload =
      result.payload && typeof result.payload === 'object'
        ? result.payload
        : { ok: result.ok };

    return applyCorsHeaders(
      NextResponse.json(payload, { status: result.status }),
      request,
    );
  } catch (error) {
    if (error instanceof HttpFunctionInvocationError) {
      return applyCorsHeaders(
        NextResponse.json(
          {
            error: 'recordLogin unavailable',
            code: 'http-function-error',
            attempts: error.attempts,
          },
          { status: 502 },
        ),
        request,
      );
    }

    console.error('record-login proxy request failed', error);
    return applyCorsHeaders(
      NextResponse.json({ error: 'recordLogin failed', code: 'proxy-error' }, { status: 500 }),
      request,
    );
  }
}

