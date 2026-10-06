'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { marketplace, type OrdersSummary } from './api-client';
import { getToken, type StoredUser } from './auth';

/** Roles with orders of their own, or (the platform admin) flagged ones to resolve. */
const HAS_ORDERS = ['buyer', 'supplier', 'hub_staff', 'hub_admin', 'platform_admin'];

/** Fired after an order step is taken, so the counts in the navigation follow. */
const ORDERS_CHANGED = 'trace:orders-changed';

export function announceOrdersChanged(): void {
  window.dispatchEvent(new Event(ORDERS_CHANGED));
}

/**
 * What the "Orders" link should show for the signed-in person: how many
 * orders wait for them, and whether anything changed since they last looked.
 * Re-read on every navigation and after every order step taken on screen.
 * Null until loaded, and for accounts with no orders; a failure shows nothing.
 */
export function useOrdersSummary(user: StoredUser | null): OrdersSummary | null {
  const pathname = usePathname();
  const [summary, setSummary] = useState<OrdersSummary | null>(null);
  const role = user?.role;

  useEffect(() => {
    const token = getToken();
    if (!token || !role || !HAS_ORDERS.includes(role)) {
      setSummary(null);
      return;
    }
    let current = true;
    const read = () => {
      marketplace
        .ordersSummary(token)
        .then((data) => {
          if (current) setSummary(data);
        })
        .catch(() => undefined);
    };
    read();
    window.addEventListener(ORDERS_CHANGED, read);
    return () => {
      current = false;
      window.removeEventListener(ORDERS_CHANGED, read);
    };
  }, [role, pathname]);

  return summary;
}
