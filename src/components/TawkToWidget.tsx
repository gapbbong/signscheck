"use client";

import { useEffect } from "react";

export default function TawkToWidget() {
    useEffect(() => {
        // Initialize Tawk API
        (window as any).Tawk_API = (window as any).Tawk_API || {};
        (window as any).Tawk_LoadStart = new Date();

        // Force Korean language
        (window as any).Tawk_API.customStyle = {
            visibility: {
                desktop: {
                    position: 'br',
                    xOffset: 20,
                    yOffset: 20
                },
                mobile: {
                    position: 'br',
                    xOffset: 10,
                    yOffset: 10
                }
            }
        };

        // Set Korean locale
        (window as any).Tawk_API.locale = 'ko';

        // Auto-send welcome message when widget loads
        (window as any).Tawk_API.onLoad = function () {
            console.log('Tawk.to 위젯 로드 완료');

            // Force show Knowledge Base
            (window as any).Tawk_API.showWidget();

            // Set visitor name if available
            const userName = localStorage.getItem('userName');
            if (userName) {
                (window as any).Tawk_API.setAttributes({
                    'name': userName,
                    'service': 'SignsCheck'
                }, function (error: any) {
                    if (error) console.error('Tawk 속성 설정 실패:', error);
                });
            }

            // Log to verify Knowledge Base is enabled
            console.log('Knowledge Base 활성화 확인');
        };

        // Auto-expand chat widget on first visit (optional)
        (window as any).Tawk_API.onChatMaximized = function () {
            console.log('채팅창 열림');
        };

        // Tawk.to script
        const script = document.createElement("script");
        script.async = true;
        script.src = "https://embed.tawk.to/694e0c4ba1f9b0197b655da6/1jdce0201";
        script.charset = "UTF-8";
        script.setAttribute("crossorigin", "*");

        document.body.appendChild(script);

        return () => {
            // Cleanup
            if (document.body.contains(script)) {
                document.body.removeChild(script);
            }
        };
    }, []);

    return null;
}
