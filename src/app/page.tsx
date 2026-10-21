import { siteOrigin } from '@/lib/site-origin';
export const metadata={alternates:siteOrigin()?{canonical:'/'}:undefined};
import StudyGate from '@/components/study-gate';
import LandingPage from '@/components/landing-page';
export default function Page() { return <StudyGate landing={<LandingPage />} />; }
