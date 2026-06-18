import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'RASA PMix Dashboard — Kutlerri',
  description: 'Product Mix & Menu Engineering dashboard for RASA',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap" rel="stylesheet" />
        <link href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.24.0/dist/tabler-icons.min.css" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}
