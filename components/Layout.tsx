import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import type { ReactNode } from 'react';
import styles from '../styles/Layout.module.css';
import { APP_NAME, CUSTOMER_INITIALS } from '../utils/brand';

const NAV = [
  { href: '/', label: 'Overview' },
  { href: '/appointments', label: 'Enrollments' },
  { href: '/call', label: 'Call Agent' },
  { href: '/voice-agent-setup', label: 'Voice Agent Setup' },
  { href: '/use-cases', label: 'Use Case Details' },
];

interface LayoutProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
}

export default function Layout({ title, subtitle, children }: LayoutProps) {
  const router = useRouter();
  return (
    <div className={styles.shell}>
      <Head>
        <title>{`${title} — ${APP_NAME}`}</title>
      </Head>
      <header className={styles.header}>
        <div className={styles.brand}>
          <span className={styles.brandMark}>{CUSTOMER_INITIALS}</span>
          <div>
            <div className={styles.brandTitle}>{APP_NAME}</div>
            <div className={styles.brandTag}>Airtable · Twilio RCS · AI voice agent</div>
          </div>
        </div>
        <nav className={styles.nav}>
          {NAV.map((item) => {
            const active = router.pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={active ? `${styles.navLink} ${styles.navLinkActive}` : styles.navLink}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>
      <main className={styles.main}>
        <div className={styles.pageHeader}>
          <h1 className={styles.pageTitle}>{title}</h1>
          {subtitle && <p className={styles.pageSubtitle}>{subtitle}</p>}
        </div>
        {children}
      </main>
    </div>
  );
}
