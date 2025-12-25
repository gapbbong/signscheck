import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const url = searchParams.get('url');

    if (!url) {
        return new NextResponse('Missing URL', { status: 400 });
    }

    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch PDF: ${response.status} ${response.statusText}`);
        }

        const blob = await response.blob();

        // Forward the content type and basic headers
        const headers = new Headers();
        headers.set('Content-Type', 'application/pdf');
        headers.set('Cache-Control', 'public, max-age=3600');

        return new NextResponse(blob, {
            status: 200,
            headers
        });

    } catch (error: any) {
        console.error("Proxy Error:", error);
        return new NextResponse(error.message, { status: 500 });
    }
}
