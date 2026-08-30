import type { Metadata, Viewport } from 'next';
import { ToastProvider } from '@/components/ui/client';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'TradeFlow — run your entire trade business from one place',
    template: '%s · TradeFlow',
  },
  description:
    'Quotes, invoices, jobs, site reports, photos, timesheets and email for builders, ' +
    'contractors and field-service businesses. Built for Australian trades.',
  applicationName: 'TradeFlow',
  formatDetection: { telephone: true },
  appleWebApp: { capable: true, title: 'TradeFlow', statusBarStyle: 'default' },
  openGraph: {
    title: 'TradeFlow — run your entire trade business from one place',
    description:
      'Quotes, invoices, jobs, reports and email for trades and field-service businesses.',
    type: 'website',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f8fafc' },
    { media: '(prefers-color-scheme: dark)', color: '#111827' },
  ],
};

/**
 * Applied before first paint so a dark-mode user never sees a white flash.
 * Inline because a separate file would arrive too late to matter.
 */
const THEME_SCRIPT = `(function(){try{var s=localStorage.getItem('tf-theme');var d=s?s==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;if(d)document.documentElement.classList.add('dark')}catch(e){}})()`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-AU" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-screen antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-[var(--accent)] focus:px-4 focus:py-2 focus:text-[var(--accent-on)]"
        >
          Skip to content
        </a>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
