import { siteOrigin } from '@/lib/site-origin';
import type { MetadataRoute } from 'next';
export default function robots():MetadataRoute.Robots {const origin=siteOrigin();return {rules:{userAgent:'*',allow:'/',disallow:'/api/'},...(origin?{sitemap:new URL('/sitemap.xml',origin).href}:{})};}
