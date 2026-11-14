import { getBudgetView } from '../server/budget.mjs';
export default function budget(req,res) {
  res.setHeader('Content-Type','application/json'); res.setHeader('Cache-Control','no-store');
  const send=(status,data)=>{res.statusCode=status;res.end(JSON.stringify(data));};
  if(req.method!=='GET'){res.setHeader('Allow','GET');return send(405,{error:'Use GET'});}
  const mode=new URL(req.url,'http://localhost').searchParams.get('period')??'plan';
  if(!['plan','history'].includes(mode)&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(mode))return send(400,{error:'Unknown budget period'});
  try{return send(200,getBudgetView(mode));}catch(error){return send(error.message==='Unknown budget period'?400:503,{error:'This month is not available.'});}
}
