import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'OCC Sandbox — The Concurrency Lab',
  description: 'A local sandbox for optimistic concurrency control. Two React editors, a Next.js server, and SQLite.',
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
