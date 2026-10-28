import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'OCC Sandbox — The Concurrency Lab',
  description:
    'An interactive sandbox for optimistic concurrency control, with two React editors and SQLite.',
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
