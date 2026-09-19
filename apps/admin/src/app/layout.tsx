import type { Metadata } from 'next';
import { BRAND } from '@canteza/shared';
import './globals.css';

export const metadata: Metadata = {
  title: `${BRAND.name} Admin`,
  description: BRAND.tagline,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
