"use client";

import { useEffect } from "react";

export default function TawkToWidget() {
    useEffect(() => {
        // Set language to Korean
        (window as any).Tawk_API = (window as any).Tawk_API || {};
        (window as any).Tawk_API.locale = 'ko';

        // Move the launcher left of the bottom-right corner so it sits under the
        // center column (below 상세안내 파일 첨부) instead of overlapping the
        // '요청 보내기' button in the right panel. Must be set before the script loads.
        (window as any).Tawk_API.customStyle = {
            visibility: {
                desktop: { position: 'br', xOffset: 290, yOffset: 15 },
                mobile: { position: 'br', xOffset: 0, yOffset: 0 }
            }
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
