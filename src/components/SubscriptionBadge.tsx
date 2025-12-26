"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { getUserSubscription, Subscription } from "@/lib/subscription-service";
import Link from "next/link";

export default function SubscriptionBadge() {
    const { user } = useAuth();
    const [subscription, setSubscription] = useState<Subscription | null>(null);

    useEffect(() => {
        if (user) {
            loadSubscription();
        }
    }, [user]);

    const loadSubscription = async () => {
        if (!user) return;
        const sub = await getUserSubscription(user.uid);
        setSubscription(sub);
    };

    if (!subscription) return null;

    const isPro = subscription.tier === 'pro';

    return (
        <Link href="/pricing" style={{ textDecoration: 'none' }}>
            <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.4rem 0.8rem',
                borderRadius: '1rem',
                background: isPro
                    ? 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)'
                    : 'rgba(255, 255, 255, 0.1)',
                border: isPro ? 'none' : '1px solid rgba(255, 255, 255, 0.2)',
                cursor: 'pointer',
                transition: 'all 0.2s',
                fontSize: '0.85rem',
                fontWeight: 600,
                color: 'white'
            }}>
                {isPro ? (
                    <>
                        <span>⭐</span>
                        <span>Pro</span>
                    </>
                ) : (
                    <>
                        <span>🆓</span>
                        <span>Free</span>
                        <span style={{ fontSize: '0.75rem', opacity: 0.7 }}>→ 업그레이드</span>
                    </>
                )}
            </div>
        </Link>
    );
}
