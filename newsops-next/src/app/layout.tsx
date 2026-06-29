import type { Metadata } from 'next';
import './globals.css';
import AdminClientLayout from './admin-client-layout';

export const metadata: Metadata = {
  title: 'NewsOps Admin | Central Cloud Operations Console',
  description: 'Manage secrets, organizations, news ingestion feeds, and editorial approvals.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased min-h-screen bg-background text-foreground">
        <AdminClientLayout>{children}</AdminClientLayout>
      </body>
    </html>
  );
}
