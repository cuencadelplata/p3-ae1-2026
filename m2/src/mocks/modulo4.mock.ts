import 'dotenv/config';
import express from 'express';
// Simulador de M4 con el mismo contrato que el M4 real (modulo-4): POST /api/v1/geocode {address}
// → 200 {address, latitude, longitude, provider} o 404 si no conoce la dirección.
const app=express();app.use(express.json({limit:'8kb'}));
const places=[
 {address:'Plaza 25 de Mayo, Resistencia',latitude:-27.4513,longitude:-58.9866},
 {address:'Universidad de la Cuenca del Plata, Resistencia',latitude:-27.4600,longitude:-58.9850},
 {address:'Terminal de Ómnibus, Resistencia',latitude:-27.4767,longitude:-59.0112},
];
app.get('/health',(_req,res)=>res.json({status:'ok',simulado:true}));
app.post('/api/v1/geocode',(req,res)=>{
 const address=req.body?.address;
 if(typeof address!=='string'||!address.trim()) return res.status(400).json({code:'LOCATION_VALIDATION_ERROR',message:'El campo address es obligatorio'});
 const q=address.trim().toLowerCase();
 const found=places.find(p=>p.address.toLowerCase().includes(q));
 if(!found) return res.status(404).json({code:'NOT_FOUND',message:`Dirección no encontrada por el geocodificador: ${address}`});
 return res.json({...found,provider:'SIMULATED'});
});
app.listen(Number(process.env.PORT??4004));
