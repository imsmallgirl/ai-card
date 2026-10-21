import type { ReactNode } from 'react';
import { PublicHeader, PublicFooter } from './landing-page';
import styles from './landing.module.css';
export default function PublicContent({title,intro,children}:{title:string;intro:string;children:ReactNode}) {
  return <div className={styles.shell}><div className={styles.container}><PublicHeader/><main className={styles.article}><span className={styles.eyebrow}>MOA · LEARN AT YOUR OWN PACE</span><h1>{title}</h1><p>{intro}</p>{children}</main><PublicFooter/></div></div>;
}
