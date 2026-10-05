import 'dotenv/config';
import express from 'express';
const app=express();
const places=[
 {direccion:'Plaza 25 de Mayo, Resistencia',latitud:-27.4513,longitud:-58.9866},
 {direccion:'Universidad de la Cuenca del Plata, Resistencia',latitud:-27.4600,longitud:-58.9850},
 {direccion:'Terminal de Ómnibus, Resistencia',latitud:-27.4767,longitud:-59.0112},
];
app.get('/health',(_req,res)=>res.json({status:'ok',simulado:true}));
app.get('/api/v1/geocodificacion',(req,res)=>{
 if(!process.env.INTEGRATION_SECRET||req.get('x-service-key')!==process.env.INTEGRATION_SECRET) return res.status(401).json({code:'UNAUTHORIZED'});
 const q=String(req.query.q??'').toLowerCase();
 return res.json({data:places.filter(p=>p.direccion.toLowerCase().includes(q))});
});
app.listen(Number(process.env.PORT??4004));
