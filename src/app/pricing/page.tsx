"use client";

// [HOLD] Payment system temporarily disabled until business registration
// Uncomment when ready to implement payment

export default function PricingPage() {
    return (
        <div style={{
            minHeight: '100vh',
            background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
            padding: '2rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'white',
            textAlign: 'center'
        }}>
            <div>
                <h1 style={{ fontSize: '2rem', marginBottom: '1rem' }}>🚧 준비 중</h1>
                <p style={{ color: '#94a3b8' }}>
                    Pro 플랜은 곧 출시됩니다!<br />
                    사용량 분석 후 최적의 가격으로 제공할 예정입니다.
                </p>
            </div>
        </div>
    );
}

/* [ORIGINAL CODE - Commented out for now]

import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";

export default function PricingPage() {
    const { user } = useAuth();
    const router = useRouter();
    const [isLoading, setIsLoading] = useState(false);

    const handleUpgrade = async () => {
        if (!user) {
            alert("로그인이 필요합니다.");
            return;
        }

        setIsLoading(true);

        try {
            // Import PortOne SDK dynamically
            const { PortOne } = await import("@portone/browser-sdk/v2");

            // Get payment configuration
            const response = await fetch("/api/payment/prepare", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    userId: user.uid,
                    userEmail: user.email || "",
                    userName: user.displayName || "사용자"
                })
            });

            const paymentConfig = await response.json();

            // Request payment
            const paymentResponse = await PortOne.requestPayment(paymentConfig);

            if (paymentResponse.code != null) {
                // Payment failed
                alert(`결제 실패: ${paymentResponse.message}`);
                return;
            }

            // Verify payment on server
            const verifyResponse = await fetch("/api/payment/verify", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    paymentId: paymentResponse.paymentId,
                    userId: user.uid
                })
            });

            const verifyResult = await verifyResponse.json();

            if (verifyResult.success) {
                alert("Pro 구독이 활성화되었습니다! 🎉");
                router.push("/");
            } else {
                alert("결제 검증 실패. 고객센터에 문의해주세요.");
            }

        } catch (error) {
            console.error("Payment error:", error);
            alert("결제 중 오류가 발생했습니다.");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div style={{
            minHeight: '100vh',
            background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
            padding: '2rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
        }}>
            <div style={{ maxWidth: '1200px', width: '100%' }}>
                <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
                    <h1 style={{ fontSize: '2.5rem', fontWeight: 'bold', color: 'white', marginBottom: '1rem' }}>
                        SignsUp 가격 플랜
                    </h1>
                    <p style={{ fontSize: '1.1rem', color: '#94a3b8' }}>
                        필요에 맞는 플랜을 선택하세요
                    </p>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem' }}>
                    {/* Free Plan *\/}
                    <div style={{
                        background: 'rgba(255, 255, 255, 0.05)',
                        backdropFilter: 'blur(10px)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        borderRadius: '1rem',
                        padding: '2rem',
                        color: 'white'
                    }}>
                        <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>Free</h2>
                        <div style={{ fontSize: '2.5rem', fontWeight: 'bold', marginBottom: '1rem' }}>
                            ₩0
                            <span style={{ fontSize: '1rem', fontWeight: 'normal', color: '#94a3b8' }}>/월</span>
                        </div>

                        <ul style={{ listStyle: 'none', padding: 0, marginBottom: '2rem' }}>
                            <li style={{ padding: '0.5rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <span style={{ color: '#10b981' }}>✓</span> 월 5회 회의
                            </li>
                            <li style={{ padding: '0.5rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <span style={{ color: '#10b981' }}>✓</span> 회의당 최대 30명
                            </li>
                            <li style={{ padding: '0.5rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <span style={{ color: '#10b981' }}>✓</span> 기본 기능
                            </li>
                            <li style={{ padding: '0.5rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <span style={{ color: '#10b981' }}>✓</span> 실시간 서명 추적
                            </li>
                        </ul>

                        <button
                            disabled
                            style={{
                                width: '100%',
                                padding: '0.75rem',
                                background: 'rgba(255, 255, 255, 0.1)',
                                color: '#94a3b8',
                                border: '1px solid rgba(255, 255, 255, 0.2)',
                                borderRadius: '0.5rem',
                                cursor: 'not-allowed',
                                fontWeight: 600
                            }}
                        >
                            현재 플랜
                        </button>
                    </div>

                    {/* Pro Plan *\/}
                    <div style={{
                        background: 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)',
                        border: '2px solid rgba(255, 255, 255, 0.3)',
                        borderRadius: '1rem',
                        padding: '2rem',
                        color: 'white',
                        position: 'relative',
                        boxShadow: '0 20px 40px rgba(59, 130, 246, 0.3)'
                    }}>
                        <div style={{
                            position: 'absolute',
                            top: '-12px',
                            right: '20px',
                            background: '#10b981',
                            color: 'white',
                            padding: '0.25rem 0.75rem',
                            borderRadius: '1rem',
                            fontSize: '0.75rem',
                            fontWeight: 'bold'
                        }}>
                            추천
                        </div>

                        <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>Pro</h2>
                        <div style={{ fontSize: '2.5rem', fontWeight: 'bold', marginBottom: '1rem' }}>
                            ₩4,900
                            <span style={{ fontSize: '1rem', fontWeight: 'normal', opacity: 0.8 }}>/월</span>
                        </div>

                        <ul style={{ listStyle: 'none', padding: 0, marginBottom: '2rem' }}>
                            <li style={{ padding: '0.5rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <span style={{ fontSize: '1.2rem' }}>✓</span> <strong>무제한 회의</strong>
                            </li>
                            <li style={{ padding: '0.5rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <span style={{ fontSize: '1.2rem' }}>✓</span> <strong>무제한 참석자</strong>
                            </li>
                            <li style={{ padding: '0.5rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <span style={{ fontSize: '1.2rem' }}>✓</span> 템플릿 기능 (향후)
                            </li>
                            <li style={{ padding: '0.5rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <span style={{ fontSize: '1.2rem' }}>✓</span> 우선 지원
                            </li>
                        </ul>

                        <button
                            onClick={handleUpgrade}
                            disabled={isLoading}
                            style={{
                                width: '100%',
                                padding: '0.75rem',
                                background: 'white',
                                color: '#3b82f6',
                                border: 'none',
                                borderRadius: '0.5rem',
                                cursor: isLoading ? 'not-allowed' : 'pointer',
                                fontWeight: 'bold',
                                fontSize: '1rem',
                                opacity: isLoading ? 0.7 : 1
                            }}
                        >
                            {isLoading ? "처리 중..." : "Pro 시작하기 →"}
                        </button>
                    </div>
                </div>

                <div style={{ textAlign: 'center', marginTop: '3rem', color: '#94a3b8' }}>
                    <p>💳 카카오페이, 네이버페이, 토스페이, 신용카드 결제 가능</p>
                    <p style={{ fontSize: '0.9rem', marginTop: '0.5rem' }}>언제든지 구독을 취소할 수 있습니다.</p>
                </div>
            </div>
        </div>
    );
}

*/
