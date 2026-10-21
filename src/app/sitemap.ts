import { siteOrigin } from '@/lib/site-origin';
import type { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  const origin=siteOrigin();
  return origin?['/','/about'].map(path=>({url:new URL(path,origin).href})):[];
}
