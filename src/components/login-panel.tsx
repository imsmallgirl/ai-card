'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from './auth-provider';
import AuthAccount from './auth-account';
export default function LoginPanel(){const {user}=useAuth();const router=useRouter();useEffect(()=>{if(user)router.replace('/');},[user,router]);return user?<p role="status">내 학습 공간으로 이동하는 중입니다.</p>:<AuthAccount variant="login"/>;}
