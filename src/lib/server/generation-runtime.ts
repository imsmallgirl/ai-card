import { requireUser } from '../server-auth.ts';
import { generationDatabase } from './firestore-database.ts';
import { createGenerationHandlers } from './generation-http.ts';
export const generationHandler = createGenerationHandlers({ authenticate: requireUser, database: generationDatabase });
