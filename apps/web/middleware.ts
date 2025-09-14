import { NextResponse, type NextRequest } from 'next/server';

export function middleware(req: NextRequest) {
  if (!req.nextUrl.pathname.startsWith('/admin')) {
    return NextResponse.next();
  }
  const uid = req.cookies.get('uid')?.value;
  const isStaff = req.cookies.get('isStaff')?.value === '1';
  if (!uid) {
    return NextResponse.redirect(new URL('/login', req.url));
  }
  if (!isStaff) {
    return NextResponse.redirect(new URL('/dashboard', req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*'],
};
