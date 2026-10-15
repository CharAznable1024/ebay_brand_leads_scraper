export interface WebUnlockerOptions { apiKey: string; zone: string; country: string; timeoutMillis: number; maxAttempts?: number; render?: boolean }
export interface WebUnlockerResult { html: string; status_code: number; content_type: string | null; bright_data_error: string | null }
type Fetch = typeof fetch;

export async function fetchWithWebUnlocker(targetUrl: string, options: WebUnlockerOptions, fetcher: Fetch = fetch): Promise<WebUnlockerResult> {
    const maximum = Math.max(1, options.maxAttempts ?? 2);
    let lastError: unknown;
    for (let attempt = 1; attempt <= maximum; attempt += 1) {
        try {
            const response = await fetcher('https://api.brightdata.com/request', {
                method: 'POST', headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ zone: options.zone, url: targetUrl, format: 'raw', country: options.country.toLowerCase(), render: String(options.render ?? true) }),
                signal: AbortSignal.timeout(options.timeoutMillis),
            });
            const responseText = await response.text();
            if (!response.ok) throw new Error(`Web Unlocker returned HTTP ${response.status}: ${responseText.slice(0, 300)}`);
            let html = responseText; let statusCode = response.status;
            try {
                const envelope = JSON.parse(responseText) as { body?: unknown; status_code?: unknown };
                if (typeof envelope.body === 'string') { html = envelope.body; if (typeof envelope.status_code === 'number') statusCode = envelope.status_code; }
            } catch { /* raw HTML response */ }
            const result = { html, status_code: statusCode, content_type: response.headers.get('content-type'), bright_data_error: response.headers.get('x-brd-error') };
            if (result.bright_data_error) throw new Error(`Bright Data error: ${result.bright_data_error}`);
            if (!html.trim()) throw new Error(`Web Unlocker returned an empty body with HTTP ${statusCode}`);
            return result;
        } catch (error) {
            lastError = error;
            if (attempt < maximum) await new Promise((resolve) => setTimeout(resolve, attempt * 5_000));
        }
    }
    throw lastError;
}

export function htmlToVisibleText(html: string): string {
    return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/\s+/g, ' ').trim();
}

export function inspectUnlockedPage(html: string, metadata?: Partial<WebUnlockerResult>) {
    const visible = htmlToVisibleText(html);
    const europeIndex = visible.toLowerCase().indexOf('europe');
    const filterSignals = ['Item location', 'US Only', 'North America', 'Europe', 'Asia', 'LH_PrefLoc', '_salic', 'itemLocationRegion', 'LocatedIn'].flatMap((term) => {
        const index = html.toLowerCase().indexOf(term.toLowerCase());
        if (index < 0) return [];
        return [{ term, sample: html.slice(Math.max(0, index - 400), index + 800).replace(/\s+/g, ' ').slice(0, 1_200) }];
    });
    return {
        html_bytes: Buffer.byteLength(html), status_code: metadata?.status_code ?? null, content_type: metadata?.content_type ?? null,
        title: html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim() ?? null,
        contains_error_page: /Error Page \| eBay|something went wrong|access denied|verify you are human/i.test(visible),
        europe_context: europeIndex >= 0 ? visible.slice(Math.max(0, europeIndex - 250), europeIndex + 500) : null,
        filter_signals: filterSignals,
        text_preview: visible.slice(0, 800),
    };
}
