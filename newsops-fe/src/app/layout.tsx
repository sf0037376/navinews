import type { Metadata } from 'next';
import './globals.css';
import ClientLayout from './client-layout';

export const metadata: Metadata = {
  title: 'NewsOps | AI-Powered News & Digital Publishing',
  description: 'Breaking news, deep analysis, and media feeds powered by state-of-the-art Artificial Intelligence. Parent company Naveen Publications.',
  keywords: 'NewsOps, AI News, Telugu News, Hindi News, Ingestion, Digital Publishing, Naveen Publications',
  authors: [{ name: 'Naveen Publications' }],
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://newsops.cloud/',
    title: 'NewsOps | AI-Powered News',
    description: 'News powered by AI - Naveen Publications',
    siteName: 'NewsOps',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased min-h-screen flex flex-col">
        <ClientLayout>{children}</ClientLayout>
      </body>
    </html>
  );
}
