import type { Instrumentation } from 'next';
import { operationalLog } from './lib/server/operational-log';
export const onRequestError:Instrumentation.onRequestError=()=>{operationalLog('next','REQUEST_ERROR');};
