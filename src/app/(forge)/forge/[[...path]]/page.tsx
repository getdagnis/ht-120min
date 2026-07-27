import { notFound } from 'next/navigation';
import { isForgeEnabled } from '../../../../server/forge-availability.js';
import { ForgeClient } from '../../../../next/ClientOnlyPublicRoutes';

export default function ForgeRoute() {
  if (!isForgeEnabled()) notFound();
  return <ForgeClient />;
}
