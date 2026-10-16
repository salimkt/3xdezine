import { lazy, Suspense } from 'react';
import { useBiz } from './state';
import './business.css';

const StudioSettings = lazy(() => import('./settings/StudioSettings'));
const RateCardEditor = lazy(() => import('./ratecard/RateCardEditor'));
const Pricing = lazy(() => import('./pricing/Pricing'));

function Loading() {
  return (
    <div className="cloud-scrim">
      <div className="spinner" role="status" aria-label="Loading" />
    </div>
  );
}

/** Hosts the business dialogs above both the home screen and the studio. */
export default function BizDialogs() {
  const dialog = useBiz((s) => s.dialog);
  return (
    <Suspense fallback={<Loading />}>
      {dialog === 'settings' && <StudioSettings />}
      {dialog === 'ratecard' && <RateCardEditor />}
      {dialog === 'pricing' && <Pricing />}
    </Suspense>
  );
}

export const closeBizDialog = () => useBiz.setState({ dialog: null });
