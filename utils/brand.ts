// Customer branding shown in the portal. NEXT_PUBLIC_* values are inlined at
// build time, so restart `npm run dev` after changing them in .env.local.
const DEFAULT_NAME = 'Gail';
const DEFAULT_INITIALS = 'GAIL';

const envName = process.env.NEXT_PUBLIC_CUSTOMER_NAME?.trim();
const envInitials = process.env.NEXT_PUBLIC_CUSTOMER_INITIALS?.trim();

export const CUSTOMER_NAME = envName || DEFAULT_NAME;

function deriveInitials(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? words[0][0] + words[1][0] : name.slice(0, 2);
  return letters.toUpperCase();
}

export const CUSTOMER_INITIALS =
  envInitials || (envName ? deriveInitials(envName) : DEFAULT_INITIALS);

export const APP_NAME = `${CUSTOMER_NAME} Conversation AI Demo`;
