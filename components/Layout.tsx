import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import type { ReactNode } from 'react';
import styles from '../styles/Layout.module.css';

const NAV = [
  { href: '/', label: 'Overview' },
  { href: '/appointments', label: 'Appointments' },
  { href: '/call', label: 'Call Agent' },
  { href: '/voice-agent-setup', label: 'Voice Agent Setup' },
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
        <title>{`${title} — Betwext Conversation AI Demo`}</title>
      </Head>
      <header className={styles.header}>
        <div className={styles.brand}>
          <span className={styles.brandMark}>BW</span>
          <div>
            <div className={styles.brandTitle}>Betwext Conversation AI Demo</div>
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
