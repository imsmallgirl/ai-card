import type { WebTag } from './web-analytics-client.ts';

type TagWindow = Window & { dataLayer?: unknown[]; [key: `ga-disable-${string}`]: boolean };
const tags = new Map<string, WebTag>();
// One loader per document, including React effect replay. No Google script is
// requested until explicit consent AND manual-only preflight confirmation.
export function createWebTag(measurementId: string): WebTag {
  const existing = tags.get(measurementId); if (existing) return existing;
  const win = window as unknown as TagWindow;
  let active = false, generation = 0, loading: Promise<void> | undefined;
  const command = function (..._args: unknown[]) { win.dataLayer ||= []; win.dataLayer.push(arguments); };
  const tag: WebTag = {
    disable: (clearCookies = true) => {
      active = false; generation++; win[`ga-disable-${measurementId}`] = true;
      // No denied-consent/cookieless ping is sent on withdrawal.
      if (clearCookies) for (const item of document.cookie.split(';')) {
        const name = item.split('=')[0].trim();
        if (/^moa_/.test(name)) document.cookie = `${name}=; Max-Age=0; path=/; SameSite=Lax; Secure`;
      }
    },
    load: async config => {
      const run = ++generation;
      win[`ga-disable-${measurementId}`] = true;
      if (!loading) {
        if (document.querySelector('script[src*="googletagmanager.com"],script[src*="google-analytics.com"]')) throw new Error('Existing tag must be reviewed');
        win.dataLayer ||= [];
        loading = new Promise<void>((resolve, reject) => {
          const script = document.createElement('script'); script.async = true; script.dataset.moaGa4 = 'true';
          script.referrerPolicy = 'no-referrer';
          script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
          const timeout = setTimeout(() => { script.remove(); loading = undefined; reject(new Error('Tag timeout')); }, 15000);
          script.onload = () => { clearTimeout(timeout); resolve(); }; script.onerror = () => { clearTimeout(timeout); script.remove(); loading = undefined; reject(new Error('Tag unavailable')); };
          document.head.appendChild(script);
        });
      }
      await loading;
      if (run !== generation) return;
      win[`ga-disable-${measurementId}`] = false; active = true;
      command('consent', 'default', { analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
      command('js', new Date()); command('config', measurementId, config);
    },
    send: (name, params) => { if (active && !win[`ga-disable-${measurementId}`]) command('event', name, params); },
  };
  tags.set(measurementId, tag); return tag;
}
