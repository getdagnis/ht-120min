'use client';

import dynamic from 'next/dynamic';

const ForgeApp = dynamic(() => import('../../../next/ForgeApp').then((module) => module.ForgeApp), { ssr: false });

export default function ForgeRoute() {
  return <ForgeApp />;
}
