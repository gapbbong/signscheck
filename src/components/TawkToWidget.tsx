"use client";

import { useEffect } from "react";

export default function TawkToWidget() {
    useEffect(() => {
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
