// Liveness only: no credentials, database reads or paid provider calls.
export function GET(){return Response.json({status:'ok'},{headers:{'Cache-Control':'no-store'}});}
