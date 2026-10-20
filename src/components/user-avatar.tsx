'use client';

import Image from 'next/image';
import { useState } from 'react';

export default function UserAvatar({ name, photoURL, small = false }: { name: string; photoURL?: string | null; small?: boolean }) {
  const [failedURL, setFailedURL] = useState<string | null>(null);
  const photo = photoURL?.startsWith('https://') && failedURL !== photoURL ? photoURL : null;
  return <span className={`avatar${small ? ' small' : ''}`}>
    {photo ? <Image src={photo} alt={`${name} 프로필`} width={small ? 29 : 34} height={small ? 29 : 34} unoptimized referrerPolicy="no-referrer" onError={() => setFailedURL(photo)}/> : name.slice(0, 1)}
  </span>;
}
