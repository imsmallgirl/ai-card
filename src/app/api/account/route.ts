import { requireUser } from '@/lib/server-auth';
import { createAccountDeleteHandler } from '@/lib/server/account-http';
import { deleteOwnAccount } from '@/lib/server/account-delete';
export const runtime='nodejs';
export const maxDuration=60;
export const POST=createAccountDeleteHandler({authenticate:requireUser,remove:deleteOwnAccount});
