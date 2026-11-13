import { validChannels } from './prefs.mjs';
const json=(body,status=200)=>Response.json(body,{status});
export function registerRoutes(ctx, service) {
 const connection=ctx.get('connection');
 if (!connection?.fetch?.register) return false;
 connection.fetch.register({path:'/api/privacy-mode/settings',methods:['GET','POST'],requestBody:'buffered',async fetch(request) {
  if (request.method === 'GET') return json(service.status());
  let body; try { body=await request.json(); } catch { return json({code:'INVALID_BODY'},400); }
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k=>!['channels','expectedUpdatedAt'].includes(k)) || !Object.hasOwn(body,'channels') || (Object.hasOwn(body,'expectedUpdatedAt') && body.expectedUpdatedAt !== null && typeof body.expectedUpdatedAt !== 'string')) return json({code:'INVALID_BODY'},400);
  if (!validChannels(body.channels)) return json({code:'INVALID_CHANNEL'},400);
  try { return json(await service.save(body.channels,body.expectedUpdatedAt)); }
  catch(e) { const code=e.code === 'PREFS_CONFLICT' || e.code === 'PREFS_BUSY' ? e.code : 'PREFS_WRITE_FAILED'; return json({code},code === 'PREFS_WRITE_FAILED' ? 500 : 409); }
 }});
 return true;
}
